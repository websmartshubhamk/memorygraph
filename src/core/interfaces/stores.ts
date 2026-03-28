/**
 * Store interfaces — pure abstractions for data access.
 * Infrastructure layer implements these.
 */

import type {
  Entity,
  EntityId,
  EntityMemory,
  Memory,
  MemoryId,
  Relation,
  RelationId,
  Cluster,
  ClusterId,
  EntityType,
  RelationType,
  Embedding,
  AccessLogEntry,
} from '../models/types.js';

export interface EntityStore {
  create(entity: Entity): void;
  getById(id: EntityId): Entity | null;
  getByName(name: string): Entity | null;
  getByAlias(alias: string): Entity | null;
  search(query: string, limit: number): Entity[];
  searchByType(entityType: EntityType, limit: number, offset: number): Entity[];
  list(limit: number, offset: number): Entity[];
  update(entity: Entity): void;
  delete(id: EntityId): void;
  count(): number;
}

export interface MemoryStore {
  create(memory: Memory): void;
  getById(id: MemoryId): Memory | null;
  getByContentHash(hash: string): Memory | null;
  getByEntity(entityId: EntityId, limit: number): Memory[];
  getActive(limit: number, minSalience: number): Memory[];
  update(memory: Memory): void;
  softDelete(id: MemoryId): void;
  count(includeDeleted?: boolean): number;
  getOldest(): Memory | null;
  getNewest(): Memory | null;
  getAverageSalience(): number;
  getAllActive(): Memory[];
  pruneBelow(threshold: number): number;
}

export interface EntityMemoryStore {
  link(entityId: EntityId, memoryId: MemoryId, role: string): void;
  getEntitiesForMemory(memoryId: MemoryId): EntityMemory[];
  getMemoriesForEntity(entityId: EntityId): EntityMemory[];
  unlink(entityId: EntityId, memoryId: MemoryId): void;
}

export interface RelationStore {
  create(relation: Relation): void;
  getById(id: RelationId): Relation | null;
  getByEntities(sourceId: EntityId, targetId: EntityId, relationType?: RelationType): Relation | null;
  getForEntity(entityId: EntityId): Relation[];
  update(relation: Relation): void;
  delete(id: RelationId): void;
  count(): number;
}

export interface ClusterStore {
  upsert(cluster: Cluster): void;
  getById(id: ClusterId): Cluster | null;
  getForEntity(entityId: EntityId): Cluster[];
  list(): Cluster[];
  deleteAll(): void;
  count(): number;
}

export interface AccessLogStore {
  log(entry: Omit<AccessLogEntry, 'id'>): void;
  getForMemory(memoryId: MemoryId, limit: number): AccessLogEntry[];
  getLastAccessTime(memoryId: MemoryId): string | null;
}

export interface VectorStore {
  upsert(table: string, id: string, embedding: Embedding): void;
  search(table: string, query: Embedding, limit: number): Array<{ id: string; distance: number }>;
  delete(table: string, id: string): void;
}

export interface ConfigStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}
