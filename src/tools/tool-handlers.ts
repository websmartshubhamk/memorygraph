/**
 * MCP tool handler — routes tool calls to the MemoryService.
 * Validates input with Zod, calls the service, and formats MCP responses.
 */

import { ZodError } from 'zod';
import type { MemoryService } from '../core/interfaces/services.js';
import {
  storeMemorySchema,
  recallSchema,
  entityContextSchema,
  relateSchema,
  reinforceSchema,
  forgetSchema,
  entitiesListSchema,
  clustersSchema,
  statusSchema,
  maintainSchema,
} from '../core/models/schemas.js';

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export class ToolHandler {
  constructor(private readonly memoryService: MemoryService) {}

  async handle(name: string, args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      switch (name) {
        case 'memory_store':
          return await this.handleStore(args);
        case 'memory_recall':
          return await this.handleRecall(args);
        case 'memory_context':
          return await this.handleContext(args);
        case 'memory_relate':
          return await this.handleRelate(args);
        case 'memory_reinforce':
          return await this.handleReinforce(args);
        case 'memory_forget':
          return await this.handleForget(args);
        case 'memory_entities':
          return await this.handleEntities(args);
        case 'memory_clusters':
          return await this.handleClusters(args);
        case 'memory_status':
          return await this.handleStatus();
        case 'memory_maintain':
          return await this.handleMaintain(args);
        default:
          return this.errorResponse(`Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        return this.validationErrorResponse(error);
      }
      const message = error instanceof Error ? error.message : String(error);
      return this.errorResponse(message);
    }
  }

  private async handleStore(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = storeMemorySchema.parse(args);
    const result = await this.memoryService.store(input);
    return this.successResponse({
      memoryId: result.memoryId,
      entityIds: result.entityIds,
      deduplicated: result.deduplicated,
      message: result.deduplicated
        ? 'Memory already exists — returned existing record.'
        : `Memory stored successfully, anchored to ${result.entityIds.length} entity(ies).`,
    });
  }

  private async handleRecall(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = recallSchema.parse(args);
    const result = await this.memoryService.recall(input);
    return this.successResponse({
      memories: result.memories.map((scored) => ({
        memoryId: scored.memory.id,
        content: scored.memory.content,
        memoryType: scored.memory.memoryType,
        entities: scored.entities.map((e) => ({ id: e.id, name: e.name, type: e.entityType })),
        similarity: Math.round(scored.similarity * 1000) / 1000,
        salience: Math.round(scored.salience * 1000) / 1000,
        combinedScore: Math.round(scored.combinedScore * 1000) / 1000,
        permanent: scored.memory.permanent,
        createdAt: scored.memory.createdAt,
      })),
      totalFound: result.totalFound,
      timing: {
        embeddingMs: Math.round(result.queryEmbeddingTime),
        searchMs: Math.round(result.searchTime),
      },
    });
  }

  private async handleContext(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = entityContextSchema.parse(args);
    const result = await this.memoryService.context(
      input.entity,
      input.limit,
      input.includeRelations,
      input.includeClusters,
    );
    return this.successResponse({
      entity: {
        id: result.entity.id,
        name: result.entity.name,
        type: result.entity.entityType,
        aliases: result.entity.aliases,
        description: result.entity.description,
        createdAt: result.entity.createdAt,
      },
      memories: result.memories.map((scored) => ({
        memoryId: scored.memory.id,
        content: scored.memory.content,
        memoryType: scored.memory.memoryType,
        salience: Math.round(scored.salience * 1000) / 1000,
        combinedScore: Math.round(scored.combinedScore * 1000) / 1000,
        permanent: scored.memory.permanent,
        createdAt: scored.memory.createdAt,
      })),
      relations: result.relations.map((rel) => ({
        relationId: rel.relation.id,
        relationType: rel.relation.relationType,
        weight: rel.relation.weight,
        direction: rel.direction,
        entity: {
          id: rel.entity.id,
          name: rel.entity.name,
          type: rel.entity.entityType,
        },
      })),
      clusters: result.clusters.map((c) => ({
        clusterId: c.id,
        label: c.label,
        entityCount: c.entityIds.length,
      })),
    });
  }

  private async handleRelate(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = relateSchema.parse(args);
    const relation = await this.memoryService.relate(input);
    return this.successResponse({
      relationId: relation.id,
      sourceEntityId: relation.sourceEntityId,
      targetEntityId: relation.targetEntityId,
      relationType: relation.relationType,
      weight: relation.weight,
      message: `Relation '${relation.relationType}' established between entities.`,
    });
  }

  private async handleReinforce(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = reinforceSchema.parse(args);
    const memory = await this.memoryService.reinforce(input);
    return this.successResponse({
      memoryId: memory.id,
      previousSalience: Math.round(memory.currentSalience * 1000) / 1000,
      reinforcementCount: memory.reinforcementCount,
      message: `Memory reinforced. Current salience: ${Math.round(memory.currentSalience * 1000) / 1000}.`,
    });
  }

  private async handleForget(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = forgetSchema.parse(args);
    await this.memoryService.forget(input);
    return this.successResponse({
      memoryId: input.memoryId,
      message: 'Memory soft-deleted successfully.',
    });
  }

  private async handleEntities(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = entitiesListSchema.parse(args);
    const entities = await this.memoryService.entities(
      input.query,
      input.entityType,
      input.limit,
      input.offset,
    );
    return this.successResponse({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.entityType,
        aliases: e.aliases,
        description: e.description,
        createdAt: e.createdAt,
      })),
      count: entities.length,
      offset: input.offset,
      limit: input.limit,
    });
  }

  private async handleClusters(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = clustersSchema.parse(args);
    const clusters = await this.memoryService.clusters(input.refresh);
    return this.successResponse({
      clusters: clusters.map((c) => ({
        clusterId: c.id,
        label: c.label,
        entityIds: c.entityIds,
        entityCount: c.entityIds.length,
        createdAt: c.createdAt,
      })),
      totalClusters: clusters.length,
    });
  }

  private async handleStatus(): Promise<ToolResponse> {
    statusSchema.parse({});
    const status = await this.memoryService.status();
    return this.successResponse({
      totalEntities: status.totalEntities,
      totalMemories: status.totalMemories,
      totalRelations: status.totalRelations,
      totalClusters: status.totalClusters,
      databaseSizeBytes: status.databaseSizeBytes,
      oldestMemory: status.oldestMemory,
      newestMemory: status.newestMemory,
      averageSalience: Math.round(status.averageSalience * 1000) / 1000,
    });
  }

  private async handleMaintain(args: Record<string, unknown>): Promise<ToolResponse> {
    const input = maintainSchema.parse(args);
    const result = await this.memoryService.maintain(input.pruneBelow, input.forceClusterRefresh);
    return this.successResponse({
      memoriesDecayed: result.memoriesDecayed,
      memoriesPruned: result.memoriesPruned,
      clustersUpdated: result.clustersUpdated,
      durationMs: Math.round(result.durationMs),
      message: `Maintenance complete. Decayed ${result.memoriesDecayed} memories, pruned ${result.memoriesPruned}, updated ${result.clustersUpdated} clusters.`,
    });
  }

  private successResponse(data: Record<string, unknown>): ToolResponse {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  private errorResponse(message: string): ToolResponse {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }

  private validationErrorResponse(error: ZodError): ToolResponse {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: 'Validation failed',
              issues,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}
