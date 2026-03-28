/**
 * Core domain types for MemoryGraph.
 * Pure types — no I/O, no side effects.
 */

// ── Identifiers ──

export type EntityId = string;
export type MemoryId = string;
export type RelationId = string;
export type ClusterId = string;

// ── Enums ──

export type MemoryType = 'episodic' | 'semantic' | 'procedural';
export type EntityType = 'person' | 'organisation' | 'project' | 'concept' | 'location' | 'tool' | 'event' | 'other';
export type RelationType = 'related_to' | 'works_on' | 'part_of' | 'depends_on' | 'created_by' | 'uses' | 'knows' | 'similar_to' | 'caused_by' | 'followed_by';

// ── Core Entities ──

export interface Entity {
  id: EntityId;
  name: string;
  entityType: EntityType;
  aliases: string[];
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Memory {
  id: MemoryId;
  content: string;
  memoryType: MemoryType;
  initialSalience: number;
  currentSalience: number;
  decayRate: number;
  permanent: boolean;
  accessCount: number;
  reinforcementCount: number;
  lastAccessedAt: string;
  metadata: Record<string, unknown>;
  contentHash: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EntityMemory {
  entityId: EntityId;
  memoryId: MemoryId;
  role: string;
  createdAt: string;
}

export interface Relation {
  id: RelationId;
  sourceEntityId: EntityId;
  targetEntityId: EntityId;
  relationType: RelationType;
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Cluster {
  id: ClusterId;
  label: string;
  entityIds: EntityId[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AccessLogEntry {
  id: number;
  memoryId: MemoryId;
  accessType: 'recall' | 'reinforce' | 'context';
  timestamp: string;
}

export interface SchemaVersion {
  version: number;
  appliedAt: string;
  description: string;
}

// ── Vector Types ──

export type Embedding = Float32Array;

export interface VectorRecord {
  id: string;
  embedding: Embedding;
}

// ── Operation Result Types ──

export interface StoreMemoryResult {
  memoryId: MemoryId;
  entityIds: EntityId[];
  deduplicated: boolean;
}

export interface RecallResult {
  memories: ScoredMemory[];
  totalFound: number;
  queryEmbeddingTime: number;
  searchTime: number;
}

export interface ScoredMemory {
  memory: Memory;
  entities: Entity[];
  similarity: number;
  salience: number;
  combinedScore: number;
}

export interface EntityContextResult {
  entity: Entity;
  memories: ScoredMemory[];
  relations: RelationWithEntity[];
  clusters: Cluster[];
}

export interface RelationWithEntity {
  relation: Relation;
  entity: Entity;
  direction: 'outgoing' | 'incoming';
}

export interface MaintenanceResult {
  memoriesDecayed: number;
  memoriesPruned: number;
  clustersUpdated: number;
  durationMs: number;
}

export interface SystemStatus {
  totalEntities: number;
  totalMemories: number;
  totalRelations: number;
  totalClusters: number;
  databaseSizeBytes: number;
  oldestMemory: string | null;
  newestMemory: string | null;
  averageSalience: number;
}

// ── Configuration ──

export interface MemoryGraphConfig {
  dataDir: string;
  dbPath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  defaultDecayRate: number;
  defaultSalience: number;
  minSalienceThreshold: number;
  maxRecallResults: number;
  maintenanceIntervalMs: number;
  logLevel: string;
}
