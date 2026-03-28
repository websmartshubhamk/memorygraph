/**
 * MCP tool definitions for MemoryGraph.
 * Each definition provides the tool name, description, and JSON Schema input.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const memoryTypeEnum = ['episodic', 'semantic', 'procedural'] as const;
const entityTypeEnum = ['person', 'organisation', 'project', 'concept', 'location', 'tool', 'event', 'other'] as const;
const relationTypeEnum = ['related_to', 'works_on', 'part_of', 'depends_on', 'created_by', 'uses', 'knows', 'similar_to', 'caused_by', 'followed_by'] as const;

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'memory_store',
    description: 'Store a memory anchored to one or more entities. Memories are the core unit of knowledge — each one is a piece of information linked to the entities it concerns. Duplicate content is detected automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The memory content to store. Can be a fact, observation, decision, procedure, or any piece of knowledge.',
          minLength: 1,
          maxLength: 50000,
        },
        entities: {
          type: 'array',
          description: 'Entity names this memory is anchored to. Entities are resolved automatically — existing ones are matched, new ones are created.',
          items: { type: 'string', minLength: 1 },
          minItems: 1,
        },
        memoryType: {
          type: 'string',
          description: 'Classification of the memory. episodic = events/experiences, semantic = facts/knowledge, procedural = how-to/processes.',
          enum: [...memoryTypeEnum],
          default: 'episodic',
        },
        salience: {
          type: 'number',
          description: 'Initial importance score from 0 (trivial) to 1 (critical). Higher salience memories decay more slowly.',
          minimum: 0,
          maximum: 1,
          default: 0.5,
        },
        permanent: {
          type: 'boolean',
          description: 'If true, the memory never decays below its initial salience. Use sparingly for truly permanent knowledge.',
          default: false,
        },
        metadata: {
          type: 'object',
          description: 'Arbitrary key-value metadata to attach to the memory.',
          additionalProperties: true,
          default: {},
        },
      },
      required: ['content', 'entities'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_recall',
    description: 'Semantic search across stored memories with salience-weighted ranking. Returns memories most relevant to the query, scored by a combination of vector similarity (60%) and salience (40%). Optionally expands results through entity cluster associations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query to search for related memories.',
          minLength: 1,
          maxLength: 10000,
        },
        entityFilter: {
          type: 'array',
          description: 'Only return memories anchored to these entities.',
          items: { type: 'string', minLength: 1 },
        },
        memoryType: {
          type: 'string',
          description: 'Filter results to a specific memory type.',
          enum: [...memoryTypeEnum],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return.',
          minimum: 1,
          maximum: 100,
          default: 10,
        },
        minSalience: {
          type: 'number',
          description: 'Minimum salience threshold. Memories below this score are excluded.',
          minimum: 0,
          maximum: 1,
          default: 0.0,
        },
        includeExpired: {
          type: 'boolean',
          description: 'Include soft-deleted memories in results.',
          default: false,
        },
        clusterExpansion: {
          type: 'boolean',
          description: 'Expand results through Louvain community clusters for associative recall.',
          default: false,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_context',
    description: 'Retrieve full context for an entity — its memories, relations to other entities, and community cluster membership. Use this to understand everything known about a specific entity.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'The entity name to retrieve context for.',
          minLength: 1,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to include.',
          minimum: 1,
          maximum: 100,
          default: 20,
        },
        includeRelations: {
          type: 'boolean',
          description: 'Include entity relations in the response.',
          default: true,
        },
        includeClusters: {
          type: 'boolean',
          description: 'Include Louvain community cluster membership.',
          default: true,
        },
      },
      required: ['entity'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_relate',
    description: 'Create or strengthen a typed relation between two entities. If the relation already exists, its weight is updated. Relations are directional (source -> target).',
    inputSchema: {
      type: 'object',
      properties: {
        sourceEntity: {
          type: 'string',
          description: 'The source entity name.',
          minLength: 1,
        },
        targetEntity: {
          type: 'string',
          description: 'The target entity name.',
          minLength: 1,
        },
        relationType: {
          type: 'string',
          description: 'The type of relation between the entities.',
          enum: [...relationTypeEnum],
          default: 'related_to',
        },
        weight: {
          type: 'number',
          description: 'Relation strength from 0 (weak) to 1 (strong).',
          minimum: 0,
          maximum: 1,
          default: 0.5,
        },
        metadata: {
          type: 'object',
          description: 'Arbitrary key-value metadata to attach to the relation.',
          additionalProperties: true,
          default: {},
        },
      },
      required: ['sourceEntity', 'targetEntity'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_reinforce',
    description: 'Boost the salience of a specific memory. Reinforcement increases the memory importance score, making it more likely to surface in recall and slower to decay.',
    inputSchema: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: 'The UUID of the memory to reinforce.',
          format: 'uuid',
        },
        amount: {
          type: 'number',
          description: 'Amount to boost salience by (0 to 1).',
          minimum: 0,
          maximum: 1,
          default: 0.1,
        },
      },
      required: ['memoryId'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_forget',
    description: 'Soft-delete a memory. The memory is marked as deleted and excluded from recall, but remains in the database for audit purposes.',
    inputSchema: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: 'The UUID of the memory to forget.',
          format: 'uuid',
        },
      },
      required: ['memoryId'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_entities',
    description: 'List known entities, optionally filtered by name query or entity type. Returns paginated results.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query to filter entities by name.',
        },
        entityType: {
          type: 'string',
          description: 'Filter to a specific entity type.',
          enum: [...entityTypeEnum],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entities to return.',
          minimum: 1,
          maximum: 500,
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Number of entities to skip for pagination.',
          minimum: 0,
          default: 0,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_clusters',
    description: 'Show Louvain community clusters — groups of entities that are closely related. Optionally force a fresh cluster detection pass.',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description: 'Force a fresh Louvain community detection pass before returning results.',
          default: false,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_status',
    description: 'Return system statistics including total entities, memories, relations, clusters, database size, and average salience.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_maintain',
    description: 'Run maintenance operations: decay stale memories, prune low-salience memories below the threshold, and optionally refresh community clusters.',
    inputSchema: {
      type: 'object',
      properties: {
        pruneBelow: {
          type: 'number',
          description: 'Prune memories with salience below this threshold.',
          minimum: 0,
          maximum: 1,
          default: 0.01,
        },
        forceClusterRefresh: {
          type: 'boolean',
          description: 'Force a fresh Louvain community detection pass during maintenance.',
          default: false,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
];
