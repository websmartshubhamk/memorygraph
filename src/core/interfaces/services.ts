/**
 * Service interfaces — pure abstractions for business logic.
 */

import type {
  Entity,
  EntityId,
  Embedding,
  Memory,
  MemoryId,
  StoreMemoryResult,
  RecallResult,
  EntityContextResult,
  Relation,
  MaintenanceResult,
  SystemStatus,
  Cluster,
} from '../models/types.js';
import type {
  StoreMemoryInput,
  RecallInput,
  RelateInput,
  ReinforceInput,
  ForgetInput,
} from '../models/schemas.js';

export interface EmbeddingProvider {
  embed(text: string): Promise<Embedding>;
  embedBatch(texts: string[]): Promise<Embedding[]>;
  isReady(): boolean;
  initialise(): Promise<void>;
}

export interface EntityResolver {
  resolve(name: string, entityType?: string): Promise<Entity>;
  findSimilar(name: string, threshold?: number): Promise<Entity[]>;
}

export interface SalienceEngine {
  calculate(memory: Memory): number;
  decay(memory: Memory, days: number): number;
  reinforce(memory: Memory, amount: number): number;
}

export interface RecallEngine {
  recall(input: RecallInput): Promise<RecallResult>;
}

export interface ClusterEngine {
  detect(): Promise<Cluster[]>;
  getForEntity(entityId: EntityId): Cluster[];
  expandRecall(memoryIds: MemoryId[], entityId: EntityId): Promise<MemoryId[]>;
}

export interface MemoryService {
  store(input: StoreMemoryInput): Promise<StoreMemoryResult>;
  recall(input: RecallInput): Promise<RecallResult>;
  context(entityName: string, limit: number, includeRelations: boolean, includeClusters: boolean): Promise<EntityContextResult>;
  relate(input: RelateInput): Promise<Relation>;
  reinforce(input: ReinforceInput): Promise<Memory>;
  forget(input: ForgetInput): Promise<void>;
  entities(query?: string, entityType?: string, limit?: number, offset?: number): Promise<Entity[]>;
  clusters(refresh: boolean): Promise<Cluster[]>;
  status(): Promise<SystemStatus>;
  maintain(pruneBelow: number, forceClusterRefresh: boolean): Promise<MaintenanceResult>;
}
