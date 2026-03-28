/**
 * Cluster Engine — Louvain community detection over the entity-relation graph.
 *
 * Builds an undirected weighted graph from entities and relations,
 * runs Louvain modularity optimisation, and persists the resulting
 * clusters. Provides cluster-based recall expansion for associative memory.
 */

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { v4 as uuidv4 } from 'uuid';

import type { Cluster, EntityId, MemoryId } from '../models/types.js';
import type {
  EntityStore,
  RelationStore,
  ClusterStore,
  EntityMemoryStore,
} from '../interfaces/stores.js';
import type { Logger } from '../../utils/logger.js';
import { nowISO } from '../../utils/text.js';

// ── Interface ──

export interface ClusterEngine {
  /** Run Louvain community detection and persist clusters. */
  detect(): Promise<Cluster[]>;

  /** Get all clusters that contain the given entity. */
  getForEntity(entityId: EntityId): Cluster[];

  /** Expand a recall set with memories from cluster neighbours. */
  expandRecall(memoryIds: MemoryId[], entityId: EntityId): Promise<MemoryId[]>;
}

// ── Implementation ──

export class ClusterEngineImpl implements ClusterEngine {
  constructor(
    private readonly entityStore: EntityStore,
    private readonly relationStore: RelationStore,
    private readonly clusterStore: ClusterStore,
    private readonly entityMemoryStore: EntityMemoryStore,
    private readonly logger: Logger,
  ) {}

  /**
   * Detect communities using Louvain modularity optimisation.
   *
   * 1. Load all entities and build an undirected weighted graph.
   * 2. Add edges from relations (skip self-loops, handle duplicates).
   * 3. Run Louvain.
   * 4. Group by community, discard singletons.
   * 5. Persist and return.
   */
  async detect(): Promise<Cluster[]> {
    const startMs = Date.now();

    // 1. Fetch all entities
    const entities = this.entityStore.list(Number.MAX_SAFE_INTEGER, 0);

    if (entities.length === 0) {
      this.logger.info('Cluster detection skipped — no entities');
      this.clusterStore.deleteAll();
      return [];
    }

    // 2. Build graph
    const graph = new Graph({ type: 'undirected', allowSelfLoops: false });

    for (const entity of entities) {
      graph.addNode(entity.id);
    }

    // Track edges to handle duplicates (graphology throws on duplicate undirected edges)
    const edgeKeys = new Set<string>();

    for (const entity of entities) {
      const relations = this.relationStore.getForEntity(entity.id);

      for (const relation of relations) {
        const { sourceEntityId, targetEntityId, weight } = relation;

        // Skip self-loops
        if (sourceEntityId === targetEntityId) {
          continue;
        }

        // Skip if either node is missing (defensive — should not happen)
        if (!graph.hasNode(sourceEntityId) || !graph.hasNode(targetEntityId)) {
          this.logger.warn(
            { sourceEntityId, targetEntityId },
            'Relation references unknown entity — skipping edge',
          );
          continue;
        }

        // Canonical key for undirected edge: sorted pair
        const edgeKey =
          sourceEntityId < targetEntityId
            ? `${sourceEntityId}::${targetEntityId}`
            : `${targetEntityId}::${sourceEntityId}`;

        if (edgeKeys.has(edgeKey)) {
          // Edge already added — merge weights by taking the maximum
          const existingWeight = graph.getEdgeAttribute(
            sourceEntityId,
            targetEntityId,
            'weight',
          ) as number;
          if (weight > existingWeight) {
            graph.setEdgeAttribute(
              sourceEntityId,
              targetEntityId,
              'weight',
              weight,
            );
          }
          continue;
        }

        graph.addEdge(sourceEntityId, targetEntityId, { weight });
        edgeKeys.add(edgeKey);
      }
    }

    // 3. Run Louvain — requires at least one edge
    if (graph.size === 0) {
      this.logger.info('Cluster detection skipped — no edges in graph');
      this.clusterStore.deleteAll();
      return [];
    }

    const communities: Record<string, number> = louvain(graph, {
      getEdgeWeight: 'weight',
    });

    // 4. Group entities by community label
    const communityMap = new Map<number, EntityId[]>();

    for (const [entityId, communityLabel] of Object.entries(communities)) {
      const existing = communityMap.get(communityLabel);
      if (existing) {
        existing.push(entityId);
      } else {
        communityMap.set(communityLabel, [entityId]);
      }
    }

    // Build clusters, discarding singletons (single-entity communities are not useful)
    const now = nowISO();
    const clusters: Cluster[] = [];
    let clusterIndex = 0;

    for (const [, entityIds] of communityMap) {
      if (entityIds.length < 2) {
        continue;
      }

      clusterIndex++;
      clusters.push({
        id: uuidv4(),
        label: `cluster-${clusterIndex}`,
        entityIds,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
    }

    // 5. Persist — clear stale clusters, then upsert fresh ones
    this.clusterStore.deleteAll();

    for (const cluster of clusters) {
      this.clusterStore.upsert(cluster);
    }

    const durationMs = Date.now() - startMs;
    this.logger.info(
      {
        entityCount: entities.length,
        edgeCount: graph.size,
        clusterCount: clusters.length,
        durationMs,
      },
      'Cluster detection complete',
    );

    return clusters;
  }

  /**
   * Get clusters containing the given entity.
   * Delegates directly to the cluster store.
   */
  getForEntity(entityId: EntityId): Cluster[] {
    return this.clusterStore.getForEntity(entityId);
  }

  /**
   * Expand a recall result set with memories from cluster neighbours.
   *
   * For the given entity, finds all clusters it belongs to, collects every
   * other entity in those clusters, and gathers their memories. Returns
   * a de-duplicated superset of the original memory IDs plus the
   * cluster-expanded ones.
   */
  async expandRecall(
    memoryIds: MemoryId[],
    entityId: EntityId,
  ): Promise<MemoryId[]> {
    const clusters = this.clusterStore.getForEntity(entityId);

    if (clusters.length === 0) {
      return memoryIds;
    }

    const seen = new Set<MemoryId>(memoryIds);
    const expanded: MemoryId[] = [...memoryIds];

    for (const cluster of clusters) {
      for (const relatedEntityId of cluster.entityIds) {
        // Skip the query entity itself — its memories are already in the set
        if (relatedEntityId === entityId) {
          continue;
        }

        const entityMemories =
          this.entityMemoryStore.getMemoriesForEntity(relatedEntityId);

        for (const em of entityMemories) {
          if (!seen.has(em.memoryId)) {
            seen.add(em.memoryId);
            expanded.push(em.memoryId);
          }
        }
      }
    }

    if (expanded.length > memoryIds.length) {
      this.logger.debug(
        {
          entityId,
          originalCount: memoryIds.length,
          expandedCount: expanded.length,
          addedCount: expanded.length - memoryIds.length,
        },
        'Recall expanded via cluster neighbours',
      );
    }

    return expanded;
  }
}
