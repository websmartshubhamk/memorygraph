import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './infrastructure/config/index.js';
import { DatabaseManager } from './infrastructure/database/index.js';
import { EmbeddingProviderImpl } from './infrastructure/embeddings/index.js';
import {
  SqliteEntityStore,
  SqliteMemoryStore,
  SqliteEntityMemoryStore,
  SqliteRelationStore,
  SqliteClusterStore,
  SqliteAccessLogStore,
  SqliteVectorStore,
  SqliteConfigStore,
} from './infrastructure/stores/index.js';
import { EntityResolverImpl } from './core/services/entity-resolver.js';
import { SalienceEngineImpl } from './core/services/salience-engine.js';
import { RecallEngineImpl } from './core/services/recall-engine.js';
import { ClusterEngineImpl } from './core/services/cluster-engine.js';
import { MemoryServiceImpl } from './core/services/memory-service.js';
import { toolDefinitions } from './tools/tool-definitions.js';
import { ToolHandler } from './tools/tool-handlers.js';
import { resourceDefinitions } from './resources/index.js';
import { createLogger } from './utils/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info('MemoryGraph starting...');

  // Database
  const dbManager = new DatabaseManager(config.dbPath, logger);
  const db = dbManager.open();

  // Stores
  const entityStore = new SqliteEntityStore(db);
  const memoryStore = new SqliteMemoryStore(db);
  const entityMemoryStore = new SqliteEntityMemoryStore(db);
  const relationStore = new SqliteRelationStore(db);
  const clusterStore = new SqliteClusterStore(db);
  const accessLogStore = new SqliteAccessLogStore(db);
  const vectorStore = new SqliteVectorStore(db);
  new SqliteConfigStore(db); // Available for future key-value config storage

  // Embedding provider
  const embeddingProvider = new EmbeddingProviderImpl(config.embeddingModel, logger);

  // Core engines
  const salienceEngine = new SalienceEngineImpl(logger);
  const entityResolver = new EntityResolverImpl(entityStore, vectorStore, embeddingProvider, logger);
  const recallEngine = new RecallEngineImpl(
    memoryStore,
    entityMemoryStore,
    entityStore,
    vectorStore,
    embeddingProvider,
    salienceEngine,
    logger,
  );
  const clusterEngine = new ClusterEngineImpl(entityStore, relationStore, clusterStore, entityMemoryStore, logger);

  // Memory service
  const memoryService = new MemoryServiceImpl(
    entityResolver,
    salienceEngine,
    recallEngine,
    clusterEngine,
    entityStore,
    memoryStore,
    entityMemoryStore,
    relationStore,
    clusterStore,
    accessLogStore,
    vectorStore,
    embeddingProvider,
    dbManager,
    logger,
  );

  // Tool handler
  const toolHandler = new ToolHandler(memoryService);

  // MCP Server
  const server = new Server(
    {
      name: 'memorygraph',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info('Tool call: %s', name);
    const result = await toolHandler.handle(name, (args as Record<string, unknown>) ?? {});
    return result as { content: Array<{ type: 'text'; text: string }> } & Record<string, unknown>;
  });

  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resourceDefinitions,
  }));

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'memorygraph://status') {
      const status = await memoryService.status();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // Auto-maintenance timer
  const maintenanceInterval = setInterval(async () => {
    try {
      logger.info('Running scheduled maintenance...');
      const result = await memoryService.maintain(config.minSalienceThreshold, false);
      logger.info('Maintenance complete: %d decayed, %d pruned', result.memoriesDecayed, result.memoriesPruned);
    } catch (err) {
      logger.error({ err }, 'Maintenance failed');
    }
  }, config.maintenanceIntervalMs);

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info('Shutting down...');
    clearInterval(maintenanceInterval);
    dbManager.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MemoryGraph MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
