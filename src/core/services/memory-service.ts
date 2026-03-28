/**
 * Memory Service — central orchestrator for MemoryGraph.
 *
 * Ties together all stores and engines to implement the full MemoryService
 * interface: store, recall, context, relate, reinforce, forget, entities,
 * clusters, status, and maintenance.
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  Entity,
  EntityType,
  Memory,
  Relation,
  Cluster,
  ScoredMemory,
  RelationWithEntity,
  StoreMemoryResult,
  RecallResult,
  EntityContextResult,
  MaintenanceResult,
  SystemStatus,
} from '../models/types.js';
import type {
  StoreMemoryInput,
  RecallInput,
  RelateInput,
  ReinforceInput,
  ForgetInput,
} from '../models/schemas.js';
import type {
  EntityStore,
  MemoryStore,
  EntityMemoryStore,
  RelationStore,
  ClusterStore,
  AccessLogStore,
  VectorStore,
} from '../interfaces/stores.js';
import type {
  EmbeddingProvider,
  EntityResolver,
  SalienceEngine,
  RecallEngine,
  ClusterEngine,
  MemoryService,
} from '../interfaces/services.js';
import type { DatabaseManager } from '../../infrastructure/database/database-manager.js';
import type { Logger } from '../../utils/logger.js';
import { contentHash } from '../../utils/hash.js';
import { nowISO } from '../../utils/text.js';

/** Default decay rate applied to new memories. */
const DEFAULT_DECAY_RATE = 0.01;

/** Vector table name for memory embeddings. */
const MEMORY_VECTOR_TABLE = 'memory_vectors';

export class MemoryServiceImpl implements MemoryService {
  constructor(
    private readonly entityResolver: EntityResolver,
    private readonly salienceEngine: SalienceEngine,
    private readonly recallEngine: RecallEngine,
    private readonly clusterEngine: ClusterEngine,
    private readonly entityStore: EntityStore,
    private readonly memoryStore: MemoryStore,
    private readonly entityMemoryStore: EntityMemoryStore,
    private readonly relationStore: RelationStore,
    private readonly clusterStore: ClusterStore,
    private readonly accessLogStore: AccessLogStore,
    private readonly vectorStore: VectorStore,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly databaseManager: DatabaseManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Store a new memory anchored to one or more entities.
   *
   * Deduplicates by content hash. If a non-deleted memory with the same hash
   * already exists, returns the existing memory's details with deduplicated=true.
   * Otherwise creates the memory, embeds it, and links it to resolved entities.
   */
  async store(input: StoreMemoryInput): Promise<StoreMemoryResult> {
    const hash = contentHash(input.content);

    // Check for duplicate content
    const existing = this.memoryStore.getByContentHash(hash);

    if (existing && !existing.deleted) {
      const entityLinks = this.entityMemoryStore.getEntitiesForMemory(existing.id);
      const entityIds = entityLinks.map((link) => link.entityId);

      this.logger.info(
        { memoryId: existing.id, entityCount: entityIds.length },
        'Duplicate memory detected — returning existing',
      );

      return {
        memoryId: existing.id,
        entityIds,
        deduplicated: true,
      };
    }

    // Resolve all entity names to Entity records (creates new if needed)
    const resolvedEntities: Entity[] = [];
    for (const entityName of input.entities) {
      const entity = await this.entityResolver.resolve(entityName);
      resolvedEntities.push(entity);
    }

    // Build the Memory record
    const now = nowISO();
    const memory: Memory = {
      id: uuidv4(),
      content: input.content,
      memoryType: input.memoryType,
      initialSalience: input.salience,
      currentSalience: input.salience,
      decayRate: DEFAULT_DECAY_RATE,
      permanent: input.permanent,
      accessCount: 0,
      reinforcementCount: 0,
      lastAccessedAt: now,
      metadata: input.metadata,
      contentHash: hash,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };

    // Persist the memory
    this.memoryStore.create(memory);

    // Embed and store the content vector
    const embedding = await this.embeddingProvider.embed(input.content);
    this.vectorStore.upsert(MEMORY_VECTOR_TABLE, memory.id, embedding);

    // Link memory to all resolved entities
    const entityIds: string[] = [];
    for (const entity of resolvedEntities) {
      this.entityMemoryStore.link(entity.id, memory.id, 'subject');
      entityIds.push(entity.id);
    }

    this.logger.info(
      { memoryId: memory.id, entityCount: entityIds.length, memoryType: memory.memoryType },
      'Memory stored successfully',
    );

    return {
      memoryId: memory.id,
      entityIds,
      deduplicated: false,
    };
  }

  /**
   * Semantic recall — search memories by query with salience-weighted ranking.
   *
   * Delegates to the recall engine, then logs access for each returned memory.
   */
  async recall(input: RecallInput): Promise<RecallResult> {
    const result = await this.recallEngine.recall(input);

    // Log access for each recalled memory
    const now = nowISO();
    for (const scored of result.memories) {
      this.accessLogStore.log({
        memoryId: scored.memory.id,
        accessType: 'recall',
        timestamp: now,
      });
    }

    return result;
  }

  /**
   * Get full context for an entity: memories, relations, and clusters.
   *
   * The entity must already exist — this method does not create new entities.
   * Throws if the entity cannot be found by name.
   */
  async context(
    entityName: string,
    limit: number,
    includeRelations: boolean,
    includeClusters: boolean,
  ): Promise<EntityContextResult> {
    // Resolve entity — must exist, do not create
    const entity = this.entityStore.getByName(entityName);
    if (!entity) {
      throw new Error(`Entity not found: "${entityName}"`);
    }

    // Get memories linked to this entity
    const entityMemoryLinks = this.entityMemoryStore.getMemoriesForEntity(entity.id);
    const scoredMemories: ScoredMemory[] = [];

    for (const link of entityMemoryLinks) {
      const memory = this.memoryStore.getById(link.memoryId);
      if (!memory || memory.deleted) {
        continue;
      }

      const salience = this.salienceEngine.calculate(memory);

      // Resolve all entities linked to this memory
      const memoryEntityLinks = this.entityMemoryStore.getEntitiesForMemory(memory.id);
      const memoryEntities: Entity[] = [];
      for (const mel of memoryEntityLinks) {
        const linkedEntity = this.entityStore.getById(mel.entityId);
        if (linkedEntity) {
          memoryEntities.push(linkedEntity);
        }
      }

      scoredMemories.push({
        memory,
        entities: memoryEntities,
        similarity: 1.0, // Context-based retrieval — no query similarity
        salience,
        combinedScore: salience, // Ranked purely by salience in context mode
      });
    }

    // Sort by salience descending, take limit
    scoredMemories.sort((a, b) => b.salience - a.salience);
    const limitedMemories = scoredMemories.slice(0, limit);

    // Relations
    const relations: RelationWithEntity[] = [];
    if (includeRelations) {
      const entityRelations = this.relationStore.getForEntity(entity.id);

      for (const relation of entityRelations) {
        const isOutgoing = relation.sourceEntityId === entity.id;
        const relatedEntityId = isOutgoing
          ? relation.targetEntityId
          : relation.sourceEntityId;

        const relatedEntity = this.entityStore.getById(relatedEntityId);
        if (relatedEntity) {
          relations.push({
            relation,
            entity: relatedEntity,
            direction: isOutgoing ? 'outgoing' : 'incoming',
          });
        }
      }
    }

    // Clusters
    const clusters: Cluster[] = includeClusters
      ? this.clusterStore.getForEntity(entity.id)
      : [];

    // Log access for context retrieval
    const now = nowISO();
    for (const scored of limitedMemories) {
      this.accessLogStore.log({
        memoryId: scored.memory.id,
        accessType: 'context',
        timestamp: now,
      });
    }

    this.logger.info(
      {
        entityId: entity.id,
        entityName: entity.name,
        memoriesReturned: limitedMemories.length,
        relationsReturned: relations.length,
        clustersReturned: clusters.length,
      },
      'Entity context retrieved',
    );

    return {
      entity,
      memories: limitedMemories,
      relations,
      clusters,
    };
  }

  /**
   * Create or strengthen a relation between two entities.
   *
   * If a relation of the same type already exists between the source and
   * target, updates the weight to the maximum of the existing and new values.
   * Otherwise creates a new relation.
   */
  async relate(input: RelateInput): Promise<Relation> {
    const sourceEntity = await this.entityResolver.resolve(input.sourceEntity);
    const targetEntity = await this.entityResolver.resolve(input.targetEntity);

    // Check for existing relation of the same type
    const existing = this.relationStore.getByEntities(
      sourceEntity.id,
      targetEntity.id,
      input.relationType,
    );

    if (existing) {
      // Strengthen: take maximum weight
      const newWeight = Math.max(existing.weight, input.weight);
      const now = nowISO();
      const updated: Relation = {
        ...existing,
        weight: newWeight,
        metadata: { ...existing.metadata, ...input.metadata },
        updatedAt: now,
      };

      this.relationStore.update(updated);

      this.logger.info(
        {
          relationId: updated.id,
          sourceEntity: sourceEntity.name,
          targetEntity: targetEntity.name,
          previousWeight: existing.weight,
          newWeight,
        },
        'Relation strengthened',
      );

      return updated;
    }

    // Create new relation
    const now = nowISO();
    const relation: Relation = {
      id: uuidv4(),
      sourceEntityId: sourceEntity.id,
      targetEntityId: targetEntity.id,
      relationType: input.relationType,
      weight: input.weight,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };

    this.relationStore.create(relation);

    this.logger.info(
      {
        relationId: relation.id,
        sourceEntity: sourceEntity.name,
        targetEntity: targetEntity.name,
        relationType: relation.relationType,
        weight: relation.weight,
      },
      'Relation created',
    );

    return relation;
  }

  /**
   * Reinforce a memory — boost its salience and mark as recently accessed.
   *
   * Increments reinforcement count, recalculates salience via the engine,
   * and logs the access event.
   */
  async reinforce(input: ReinforceInput): Promise<Memory> {
    const memory = this.memoryStore.getById(input.memoryId);
    if (!memory) {
      throw new Error(`Memory not found: "${input.memoryId}"`);
    }

    // Calculate new salience with reinforcement applied
    const newSalience = this.salienceEngine.reinforce(memory, input.amount);
    const now = nowISO();

    const updated: Memory = {
      ...memory,
      reinforcementCount: memory.reinforcementCount + 1,
      currentSalience: newSalience,
      lastAccessedAt: now,
      updatedAt: now,
    };

    this.memoryStore.update(updated);

    // Log the reinforcement access
    this.accessLogStore.log({
      memoryId: memory.id,
      accessType: 'reinforce',
      timestamp: now,
    });

    this.logger.info(
      {
        memoryId: memory.id,
        previousSalience: memory.currentSalience,
        newSalience,
        reinforcementCount: updated.reinforcementCount,
      },
      'Memory reinforced',
    );

    return updated;
  }

  /**
   * Soft-delete a memory and remove its vector embedding.
   *
   * The memory record is retained (deleted=true) but excluded from recall.
   * The vector is permanently removed to prevent stale search results.
   */
  async forget(input: ForgetInput): Promise<void> {
    const memory = this.memoryStore.getById(input.memoryId);
    if (!memory) {
      throw new Error(`Memory not found: "${input.memoryId}"`);
    }

    this.memoryStore.softDelete(input.memoryId);
    this.vectorStore.delete(MEMORY_VECTOR_TABLE, input.memoryId);

    this.logger.info({ memoryId: input.memoryId }, 'Memory forgotten (soft-deleted)');
  }

  /**
   * List or search entities.
   *
   * If a query string is provided, performs a text search.
   * If an entity type is provided, filters by type.
   * Otherwise returns a paginated list of all entities.
   */
  async entities(
    query?: string,
    entityType?: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<Entity[]> {
    if (query) {
      return this.entityStore.search(query, limit);
    }

    if (entityType) {
      return this.entityStore.searchByType(entityType as EntityType, limit, offset);
    }

    return this.entityStore.list(limit, offset);
  }

  /**
   * List or refresh clusters.
   *
   * If refresh is true, runs Louvain community detection from scratch.
   * Otherwise returns the most recently persisted cluster set.
   */
  async clusters(refresh: boolean): Promise<Cluster[]> {
    if (refresh) {
      return this.clusterEngine.detect();
    }

    return this.clusterStore.list();
  }

  /**
   * Return system-wide statistics.
   */
  async status(): Promise<SystemStatus> {
    const oldest = this.memoryStore.getOldest();
    const newest = this.memoryStore.getNewest();

    return {
      totalEntities: this.entityStore.count(),
      totalMemories: this.memoryStore.count(),
      totalRelations: this.relationStore.count(),
      totalClusters: this.clusterStore.count(),
      databaseSizeBytes: this.databaseManager.getSize(),
      oldestMemory: oldest ? oldest.createdAt : null,
      newestMemory: newest ? newest.createdAt : null,
      averageSalience: this.memoryStore.getAverageSalience(),
    };
  }

  /**
   * Run maintenance operations: recalculate salience, prune low-salience
   * memories, and optionally refresh clusters.
   *
   * Returns a summary of what was done and how long it took.
   */
  async maintain(
    pruneBelow: number,
    forceClusterRefresh: boolean,
  ): Promise<MaintenanceResult> {
    const startMs = performance.now();

    // 1. Recalculate salience for all active memories
    const activeMemories = this.memoryStore.getAllActive();
    let memoriesDecayed = 0;

    for (const memory of activeMemories) {
      const newSalience = this.salienceEngine.calculate(memory);

      if (newSalience !== memory.currentSalience) {
        const updated: Memory = {
          ...memory,
          currentSalience: newSalience,
          updatedAt: nowISO(),
        };
        this.memoryStore.update(updated);
        memoriesDecayed++;
      }
    }

    // 2. Prune memories below the salience threshold
    const memoriesPruned = this.memoryStore.pruneBelow(pruneBelow);

    // 3. Optionally refresh clusters
    let clustersUpdated = 0;
    if (forceClusterRefresh) {
      const clusters = await this.clusterEngine.detect();
      clustersUpdated = clusters.length;
    }

    const durationMs = performance.now() - startMs;

    this.logger.info(
      {
        memoriesDecayed,
        memoriesPruned,
        clustersUpdated,
        durationMs: durationMs.toFixed(2),
      },
      'Maintenance complete',
    );

    return {
      memoriesDecayed,
      memoriesPruned,
      clustersUpdated,
      durationMs,
    };
  }
}
