/**
 * Integration tests for all SQLite store implementations.
 *
 * Each store is tested against a real in-memory SQLite database with
 * all migrations applied and sqlite-vec loaded. Foreign key constraints
 * are enforced, so test data must be created in the correct order.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { migrations } from '../../src/infrastructure/database/migrations/index.js';
import { SqliteEntityStore } from '../../src/infrastructure/stores/entity-store.js';
import { SqliteMemoryStore } from '../../src/infrastructure/stores/memory-store.js';
import { SqliteEntityMemoryStore } from '../../src/infrastructure/stores/entity-memory-store.js';
import { SqliteRelationStore } from '../../src/infrastructure/stores/relation-store.js';
import { SqliteClusterStore } from '../../src/infrastructure/stores/cluster-store.js';
import { SqliteAccessLogStore } from '../../src/infrastructure/stores/access-log-store.js';
import { SqliteVectorStore } from '../../src/infrastructure/stores/vector-store.js';
import { SqliteConfigStore } from '../../src/infrastructure/stores/config-store.js';
import type {
  Entity,
  Memory,
  Relation,
  Cluster,
  Embedding,
} from '../../src/core/models/types.js';

// ── Helpers ──

function createTestDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL'); // WAL may fallback to 'memory' for :memory: — that is fine
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);
  for (const migration of migrations) {
    migration.up(db);
  }
  return db;
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: `Test Entity ${randomUUID().slice(0, 8)}`,
    entityType: 'concept',
    aliases: [],
    description: 'A test entity for integration testing.',
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    content: `Test memory content ${randomUUID().slice(0, 8)}`,
    memoryType: 'episodic',
    initialSalience: 0.5,
    currentSalience: 0.5,
    decayRate: 0.01,
    permanent: false,
    accessCount: 0,
    reinforcementCount: 0,
    lastAccessedAt: now,
    metadata: {},
    contentHash: randomUUID(), // Unique hash per test memory
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRelation(
  sourceEntityId: string,
  targetEntityId: string,
  overrides: Partial<Relation> = {},
): Relation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    sourceEntityId,
    targetEntityId,
    relationType: 'related_to',
    weight: 0.5,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCluster(overrides: Partial<Cluster> = {}): Cluster {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    label: `Cluster ${randomUUID().slice(0, 8)}`,
    entityIds: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Create a random 384-dimension embedding (Float32Array). */
function makeEmbedding(): Embedding {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = Math.random() * 2 - 1; // Range [-1, 1]
  }
  return arr;
}

/** Create an embedding biased towards a specific direction for predictable similarity. */
function makeBiasedEmbedding(bias: number): Embedding {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = bias + (Math.random() * 0.01); // Tight cluster around bias
  }
  return arr;
}

// ── EntityStore ──

describe('SqliteEntityStore', () => {
  let db: BetterSqlite3.Database;
  let store: SqliteEntityStore;

  beforeEach(() => {
    db = createTestDb();
    store = new SqliteEntityStore(db);
  });

  afterAll(() => {
    // Databases are :memory: so they clean up on GC, but be explicit
  });

  it('creates an entity and retrieves it by ID', () => {
    const entity = makeEntity();
    store.create(entity);

    const result = store.getById(entity.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(entity.id);
    expect(result!.name).toBe(entity.name);
    expect(result!.entityType).toBe(entity.entityType);
    expect(result!.description).toBe(entity.description);
    expect(result!.aliases).toEqual(entity.aliases);
    expect(result!.metadata).toEqual(entity.metadata);
  });

  it('returns null for a non-existent entity ID', () => {
    expect(store.getById(randomUUID())).toBeNull();
  });

  it('retrieves entity by name (case-insensitive)', () => {
    const entity = makeEntity({ name: 'TypeScript Compiler' });
    store.create(entity);

    // Exact case
    expect(store.getByName('TypeScript Compiler')).not.toBeNull();
    // Lower case
    expect(store.getByName('typescript compiler')).not.toBeNull();
    // Upper case
    expect(store.getByName('TYPESCRIPT COMPILER')).not.toBeNull();
    // Mixed case
    expect(store.getByName('typeScript COMPILER')).not.toBeNull();
  });

  it('returns null when name does not match', () => {
    expect(store.getByName('Non-existent Entity')).toBeNull();
  });

  it('retrieves entity by alias (case-insensitive)', () => {
    const entity = makeEntity({
      name: 'MemoryGraph',
      aliases: ['MG', 'memory-graph', 'MemGraph'],
    });
    store.create(entity);

    expect(store.getByAlias('mg')).not.toBeNull();
    expect(store.getByAlias('MG')).not.toBeNull();
    expect(store.getByAlias('Memory-Graph')).not.toBeNull();
    expect(store.getByAlias('MEMGRAPH')).not.toBeNull();
  });

  it('returns null when alias does not match', () => {
    const entity = makeEntity({ aliases: ['alpha'] });
    store.create(entity);

    expect(store.getByAlias('beta')).toBeNull();
  });

  it('searches entities by name', () => {
    store.create(makeEntity({ name: 'SQLite Database' }));
    store.create(makeEntity({ name: 'PostgreSQL Database' }));
    store.create(makeEntity({ name: 'Redis Cache' }));

    const results = store.search('Database', 10);
    expect(results.length).toBe(2);
    expect(results.every((e) => e.name.includes('Database'))).toBe(true);
  });

  it('searches entities by description', () => {
    store.create(
      makeEntity({
        name: 'Alpha',
        description: 'Handles vector embeddings for semantic search.',
      }),
    );
    store.create(
      makeEntity({
        name: 'Beta',
        description: 'Manages user authentication tokens.',
      }),
    );

    const results = store.search('vector', 10);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Alpha');
  });

  it('respects search limit', () => {
    for (let i = 0; i < 5; i++) {
      store.create(makeEntity({ name: `Searchable Item ${i}` }));
    }

    const results = store.search('Searchable', 3);
    expect(results.length).toBe(3);
  });

  it('lists entities with pagination', () => {
    const entities = Array.from({ length: 5 }, (_, i) =>
      makeEntity({ name: `Entity ${i}` }),
    );
    for (const e of entities) {
      store.create(e);
    }

    const page1 = store.list(2, 0);
    expect(page1.length).toBe(2);

    const page2 = store.list(2, 2);
    expect(page2.length).toBe(2);

    const page3 = store.list(2, 4);
    expect(page3.length).toBe(1);

    // No overlap between pages
    const allIds = [...page1, ...page2, ...page3].map((e) => e.id);
    expect(new Set(allIds).size).toBe(5);
  });

  it('updates an entity', () => {
    const entity = makeEntity({
      name: 'Original Name',
      description: 'Original description.',
      updatedAt: '2020-01-01T00:00:00.000Z',
    });
    store.create(entity);

    const updated = {
      ...entity,
      name: 'Updated Name',
      description: 'Updated description.',
      aliases: ['alias-one'],
      metadata: { version: 2 },
    };
    store.update(updated);

    const result = store.getById(entity.id);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Updated Name');
    expect(result!.description).toBe('Updated description.');
    expect(result!.aliases).toEqual(['alias-one']);
    expect(result!.metadata).toEqual({ version: 2 });
    // updatedAt should be refreshed by the store to a newer timestamp
    expect(result!.updatedAt).not.toBe(entity.updatedAt);
  });

  it('deletes an entity', () => {
    const entity = makeEntity();
    store.create(entity);
    expect(store.getById(entity.id)).not.toBeNull();

    store.delete(entity.id);
    expect(store.getById(entity.id)).toBeNull();
  });

  it('counts entities accurately', () => {
    expect(store.count()).toBe(0);

    store.create(makeEntity());
    store.create(makeEntity());
    store.create(makeEntity());

    expect(store.count()).toBe(3);
  });

  it('count decreases after deletion', () => {
    const entity = makeEntity();
    store.create(entity);
    store.create(makeEntity());
    expect(store.count()).toBe(2);

    store.delete(entity.id);
    expect(store.count()).toBe(1);
  });

  it('preserves JSON metadata with nested structures', () => {
    const entity = makeEntity({
      metadata: {
        tags: ['backend', 'database'],
        config: { retries: 3, timeout: 5000 },
        active: true,
      },
    });
    store.create(entity);

    const result = store.getById(entity.id);
    expect(result!.metadata).toEqual({
      tags: ['backend', 'database'],
      config: { retries: 3, timeout: 5000 },
      active: true,
    });
  });

  it('searchByType filters correctly', () => {
    store.create(makeEntity({ entityType: 'person', name: 'Alice' }));
    store.create(makeEntity({ entityType: 'person', name: 'Bob' }));
    store.create(makeEntity({ entityType: 'project', name: 'MemoryGraph' }));

    const people = store.searchByType('person', 10, 0);
    expect(people.length).toBe(2);
    expect(people.every((e) => e.entityType === 'person')).toBe(true);

    const projects = store.searchByType('project', 10, 0);
    expect(projects.length).toBe(1);
    expect(projects[0].name).toBe('MemoryGraph');
  });
});

// ── MemoryStore ──

describe('SqliteMemoryStore', () => {
  let db: BetterSqlite3.Database;
  let store: SqliteMemoryStore;

  beforeEach(() => {
    db = createTestDb();
    store = new SqliteMemoryStore(db);
  });

  it('creates a memory and retrieves it by ID', () => {
    const memory = makeMemory();
    store.create(memory);

    const result = store.getById(memory.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(memory.id);
    expect(result!.content).toBe(memory.content);
    expect(result!.memoryType).toBe(memory.memoryType);
    expect(result!.initialSalience).toBe(memory.initialSalience);
    expect(result!.currentSalience).toBe(memory.currentSalience);
    expect(result!.decayRate).toBe(memory.decayRate);
    expect(result!.permanent).toBe(false);
    expect(result!.deleted).toBe(false);
    expect(result!.accessCount).toBe(0);
    expect(result!.reinforcementCount).toBe(0);
  });

  it('returns null for a non-existent memory ID', () => {
    expect(store.getById(randomUUID())).toBeNull();
  });

  it('retrieves memory by content hash', () => {
    const hash = 'sha256-abc123';
    const memory = makeMemory({ contentHash: hash });
    store.create(memory);

    const result = store.getByContentHash(hash);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(memory.id);
  });

  it('returns null for non-existent content hash', () => {
    expect(store.getByContentHash('nonexistent-hash')).toBeNull();
  });

  it('retrieves memories by entity via entity_memories join', () => {
    const entityStore = new SqliteEntityStore(db);
    const emStore = new SqliteEntityMemoryStore(db);

    const entity = makeEntity();
    entityStore.create(entity);

    const mem1 = makeMemory({ currentSalience: 0.9 });
    const mem2 = makeMemory({ currentSalience: 0.3 });
    const mem3 = makeMemory({ currentSalience: 0.6 });
    store.create(mem1);
    store.create(mem2);
    store.create(mem3);

    emStore.link(entity.id, mem1.id, 'subject');
    emStore.link(entity.id, mem2.id, 'subject');
    emStore.link(entity.id, mem3.id, 'context');

    const results = store.getByEntity(entity.id, 10);
    expect(results.length).toBe(3);
    // Should be ordered by current_salience DESC
    expect(results[0].currentSalience).toBeGreaterThanOrEqual(results[1].currentSalience);
    expect(results[1].currentSalience).toBeGreaterThanOrEqual(results[2].currentSalience);
  });

  it('getByEntity excludes soft-deleted memories', () => {
    const entityStore = new SqliteEntityStore(db);
    const emStore = new SqliteEntityMemoryStore(db);

    const entity = makeEntity();
    entityStore.create(entity);

    const mem1 = makeMemory();
    const mem2 = makeMemory();
    store.create(mem1);
    store.create(mem2);

    emStore.link(entity.id, mem1.id, 'subject');
    emStore.link(entity.id, mem2.id, 'subject');

    store.softDelete(mem1.id);

    const results = store.getByEntity(entity.id, 10);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(mem2.id);
  });

  it('getActive filters by minimum salience', () => {
    store.create(makeMemory({ currentSalience: 0.9 }));
    store.create(makeMemory({ currentSalience: 0.5 }));
    store.create(makeMemory({ currentSalience: 0.2 }));
    store.create(makeMemory({ currentSalience: 0.1 }));

    const highSalience = store.getActive(10, 0.5);
    expect(highSalience.length).toBe(2);
    expect(highSalience.every((m) => m.currentSalience >= 0.5)).toBe(true);

    const allActive = store.getActive(10, 0.0);
    expect(allActive.length).toBe(4);
  });

  it('getActive excludes soft-deleted memories', () => {
    const mem = makeMemory({ currentSalience: 0.9 });
    store.create(mem);
    store.softDelete(mem.id);

    const results = store.getActive(10, 0.0);
    expect(results.length).toBe(0);
  });

  it('softDelete marks memory as deleted without removing row', () => {
    const memory = makeMemory();
    store.create(memory);

    store.softDelete(memory.id);

    const result = store.getById(memory.id);
    expect(result).not.toBeNull();
    expect(result!.deleted).toBe(true);
  });

  it('count excludes deleted by default', () => {
    store.create(makeMemory());
    store.create(makeMemory());
    const toDelete = makeMemory();
    store.create(toDelete);

    store.softDelete(toDelete.id);

    expect(store.count()).toBe(2);
    expect(store.count(false)).toBe(2);
    expect(store.count(true)).toBe(3);
  });

  it('getOldest returns the earliest created memory', () => {
    const old = makeMemory({ createdAt: '2024-01-01T00:00:00.000Z' });
    const recent = makeMemory({ createdAt: '2025-06-15T12:00:00.000Z' });

    store.create(old);
    store.create(recent);

    const oldest = store.getOldest();
    expect(oldest).not.toBeNull();
    expect(oldest!.id).toBe(old.id);
  });

  it('getNewest returns the most recently created memory', () => {
    const old = makeMemory({ createdAt: '2024-01-01T00:00:00.000Z' });
    const recent = makeMemory({ createdAt: '2025-06-15T12:00:00.000Z' });

    store.create(old);
    store.create(recent);

    const newest = store.getNewest();
    expect(newest).not.toBeNull();
    expect(newest!.id).toBe(recent.id);
  });

  it('getOldest and getNewest return null when no active memories exist', () => {
    expect(store.getOldest()).toBeNull();
    expect(store.getNewest()).toBeNull();
  });

  it('getOldest and getNewest skip deleted memories', () => {
    const mem = makeMemory({ createdAt: '2024-01-01T00:00:00.000Z' });
    store.create(mem);
    store.softDelete(mem.id);

    expect(store.getOldest()).toBeNull();
    expect(store.getNewest()).toBeNull();
  });

  it('getAverageSalience calculates correctly', () => {
    store.create(makeMemory({ currentSalience: 0.4 }));
    store.create(makeMemory({ currentSalience: 0.6 }));
    store.create(makeMemory({ currentSalience: 0.8 }));

    const avg = store.getAverageSalience();
    expect(avg).toBeCloseTo(0.6, 5);
  });

  it('getAverageSalience returns 0 for empty database', () => {
    expect(store.getAverageSalience()).toBe(0);
  });

  it('getAverageSalience excludes deleted memories', () => {
    store.create(makeMemory({ currentSalience: 1.0 }));
    const toDelete = makeMemory({ currentSalience: 0.0 });
    store.create(toDelete);
    store.softDelete(toDelete.id);

    expect(store.getAverageSalience()).toBeCloseTo(1.0, 5);
  });

  it('pruneBelow soft-deletes memories below threshold', () => {
    store.create(makeMemory({ currentSalience: 0.8 }));
    store.create(makeMemory({ currentSalience: 0.3 }));
    store.create(makeMemory({ currentSalience: 0.1 }));

    const pruned = store.pruneBelow(0.5);
    expect(pruned).toBe(2);
    expect(store.count()).toBe(1); // Only the 0.8 memory survives
    expect(store.count(true)).toBe(3); // All three still exist as rows
  });

  it('pruneBelow excludes permanent memories', () => {
    store.create(makeMemory({ currentSalience: 0.1, permanent: true }));
    store.create(makeMemory({ currentSalience: 0.1, permanent: false }));

    const pruned = store.pruneBelow(0.5);
    expect(pruned).toBe(1); // Only the non-permanent one gets pruned
    expect(store.count()).toBe(1); // The permanent one survives
  });

  it('pruneBelow does not re-delete already deleted memories', () => {
    const mem = makeMemory({ currentSalience: 0.1 });
    store.create(mem);
    store.softDelete(mem.id);

    const pruned = store.pruneBelow(0.5);
    expect(pruned).toBe(0); // Already deleted, not counted
  });

  it('update modifies memory fields', () => {
    const memory = makeMemory({ updatedAt: '2020-01-01T00:00:00.000Z' });
    store.create(memory);

    const updated: Memory = {
      ...memory,
      currentSalience: 0.95,
      accessCount: 5,
      reinforcementCount: 2,
      metadata: { boosted: true },
    };
    store.update(updated);

    const result = store.getById(memory.id);
    expect(result!.currentSalience).toBe(0.95);
    expect(result!.accessCount).toBe(5);
    expect(result!.reinforcementCount).toBe(2);
    expect(result!.metadata).toEqual({ boosted: true });
    // updatedAt should be refreshed by the store to a newer timestamp
    expect(result!.updatedAt).not.toBe(memory.updatedAt);
  });

  it('handles permanent flag correctly', () => {
    const memory = makeMemory({ permanent: true });
    store.create(memory);

    const result = store.getById(memory.id);
    expect(result!.permanent).toBe(true);
  });

  it('getAllActive returns all non-deleted memories ordered by salience', () => {
    store.create(makeMemory({ currentSalience: 0.3 }));
    store.create(makeMemory({ currentSalience: 0.9 }));
    store.create(makeMemory({ currentSalience: 0.6 }));
    const deleted = makeMemory({ currentSalience: 1.0 });
    store.create(deleted);
    store.softDelete(deleted.id);

    const all = store.getAllActive();
    expect(all.length).toBe(3);
    expect(all[0].currentSalience).toBe(0.9);
    expect(all[2].currentSalience).toBe(0.3);
  });
});

// ── EntityMemoryStore ──

describe('SqliteEntityMemoryStore', () => {
  let db: BetterSqlite3.Database;
  let entityStore: SqliteEntityStore;
  let memoryStore: SqliteMemoryStore;
  let store: SqliteEntityMemoryStore;

  beforeEach(() => {
    db = createTestDb();
    entityStore = new SqliteEntityStore(db);
    memoryStore = new SqliteMemoryStore(db);
    store = new SqliteEntityMemoryStore(db);
  });

  it('links an entity to a memory and retrieves the link', () => {
    const entity = makeEntity();
    const memory = makeMemory();
    entityStore.create(entity);
    memoryStore.create(memory);

    store.link(entity.id, memory.id, 'subject');

    const entities = store.getEntitiesForMemory(memory.id);
    expect(entities.length).toBe(1);
    expect(entities[0].entityId).toBe(entity.id);
    expect(entities[0].memoryId).toBe(memory.id);
    expect(entities[0].role).toBe('subject');
    expect(entities[0].createdAt).toBeDefined();
  });

  it('retrieves all entities for a given memory', () => {
    const entity1 = makeEntity();
    const entity2 = makeEntity();
    const memory = makeMemory();
    entityStore.create(entity1);
    entityStore.create(entity2);
    memoryStore.create(memory);

    store.link(entity1.id, memory.id, 'subject');
    store.link(entity2.id, memory.id, 'context');

    const entities = store.getEntitiesForMemory(memory.id);
    expect(entities.length).toBe(2);
    const entityIds = entities.map((e) => e.entityId);
    expect(entityIds).toContain(entity1.id);
    expect(entityIds).toContain(entity2.id);
  });

  it('retrieves all memories for a given entity', () => {
    const entity = makeEntity();
    const mem1 = makeMemory();
    const mem2 = makeMemory();
    entityStore.create(entity);
    memoryStore.create(mem1);
    memoryStore.create(mem2);

    store.link(entity.id, mem1.id, 'subject');
    store.link(entity.id, mem2.id, 'context');

    const memories = store.getMemoriesForEntity(entity.id);
    expect(memories.length).toBe(2);
    const memoryIds = memories.map((m) => m.memoryId);
    expect(memoryIds).toContain(mem1.id);
    expect(memoryIds).toContain(mem2.id);
  });

  it('unlinks an entity from a memory', () => {
    const entity = makeEntity();
    const memory = makeMemory();
    entityStore.create(entity);
    memoryStore.create(memory);

    store.link(entity.id, memory.id, 'subject');
    expect(store.getEntitiesForMemory(memory.id).length).toBe(1);

    store.unlink(entity.id, memory.id);
    expect(store.getEntitiesForMemory(memory.id).length).toBe(0);
  });

  it('link with INSERT OR IGNORE does not fail on duplicate', () => {
    const entity = makeEntity();
    const memory = makeMemory();
    entityStore.create(entity);
    memoryStore.create(memory);

    store.link(entity.id, memory.id, 'subject');
    // Linking again should not throw
    expect(() => store.link(entity.id, memory.id, 'subject')).not.toThrow();

    // Should still be exactly one link
    expect(store.getEntitiesForMemory(memory.id).length).toBe(1);
  });

  it('returns empty arrays when no links exist', () => {
    expect(store.getEntitiesForMemory(randomUUID())).toEqual([]);
    expect(store.getMemoriesForEntity(randomUUID())).toEqual([]);
  });
});

// ── RelationStore ──

describe('SqliteRelationStore', () => {
  let db: BetterSqlite3.Database;
  let entityStore: SqliteEntityStore;
  let store: SqliteRelationStore;

  beforeEach(() => {
    db = createTestDb();
    entityStore = new SqliteEntityStore(db);
    store = new SqliteRelationStore(db);
  });

  it('creates a relation and retrieves it by ID', () => {
    const source = makeEntity();
    const target = makeEntity();
    entityStore.create(source);
    entityStore.create(target);

    const relation = makeRelation(source.id, target.id, {
      relationType: 'works_on',
      weight: 0.75,
    });
    store.create(relation);

    const result = store.getById(relation.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(relation.id);
    expect(result!.sourceEntityId).toBe(source.id);
    expect(result!.targetEntityId).toBe(target.id);
    expect(result!.relationType).toBe('works_on');
    expect(result!.weight).toBe(0.75);
  });

  it('returns null for non-existent relation ID', () => {
    expect(store.getById(randomUUID())).toBeNull();
  });

  it('getByEntities finds relation without type filter', () => {
    const source = makeEntity();
    const target = makeEntity();
    entityStore.create(source);
    entityStore.create(target);

    const relation = makeRelation(source.id, target.id);
    store.create(relation);

    const result = store.getByEntities(source.id, target.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(relation.id);
  });

  it('getByEntities finds relation with type filter', () => {
    const source = makeEntity();
    const target = makeEntity();
    entityStore.create(source);
    entityStore.create(target);

    store.create(makeRelation(source.id, target.id, { relationType: 'works_on' }));
    store.create(makeRelation(source.id, target.id, { relationType: 'knows' }));

    const worksOn = store.getByEntities(source.id, target.id, 'works_on');
    expect(worksOn).not.toBeNull();
    expect(worksOn!.relationType).toBe('works_on');

    const knows = store.getByEntities(source.id, target.id, 'knows');
    expect(knows).not.toBeNull();
    expect(knows!.relationType).toBe('knows');
  });

  it('getByEntities returns null when no match', () => {
    expect(store.getByEntities(randomUUID(), randomUUID())).toBeNull();
  });

  it('getByEntities with type returns null when type does not match', () => {
    const source = makeEntity();
    const target = makeEntity();
    entityStore.create(source);
    entityStore.create(target);

    store.create(makeRelation(source.id, target.id, { relationType: 'works_on' }));

    expect(store.getByEntities(source.id, target.id, 'knows')).toBeNull();
  });

  it('getForEntity returns relations in both directions', () => {
    const entityA = makeEntity();
    const entityB = makeEntity();
    const entityC = makeEntity();
    entityStore.create(entityA);
    entityStore.create(entityB);
    entityStore.create(entityC);

    // A -> B
    store.create(makeRelation(entityA.id, entityB.id, { relationType: 'works_on' }));
    // C -> A
    store.create(makeRelation(entityC.id, entityA.id, { relationType: 'knows' }));

    const relationsForA = store.getForEntity(entityA.id);
    expect(relationsForA.length).toBe(2);

    const sourceIds = relationsForA.map((r) => r.sourceEntityId);
    const targetIds = relationsForA.map((r) => r.targetEntityId);
    // A is source in one, target in another
    expect(sourceIds).toContain(entityA.id);
    expect(targetIds).toContain(entityA.id);
  });

  it('getForEntity returns results ordered by weight DESC', () => {
    const entityA = makeEntity();
    const entityB = makeEntity();
    const entityC = makeEntity();
    entityStore.create(entityA);
    entityStore.create(entityB);
    entityStore.create(entityC);

    store.create(makeRelation(entityA.id, entityB.id, { weight: 0.3 }));
    store.create(makeRelation(entityA.id, entityC.id, { weight: 0.9 }));

    const relations = store.getForEntity(entityA.id);
    expect(relations[0].weight).toBeGreaterThanOrEqual(relations[1].weight);
  });

  it('updates a relation', () => {
    const source = makeEntity();
    const target = makeEntity();
    entityStore.create(source);
    entityStore.create(target);

    const relation = makeRelation(source.id, target.id, {
      weight: 0.5,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });
    store.create(relation);

    const updated = { ...relation, weight: 0.95, metadata: { strengthened: true } };
    store.update(updated);

    const result = store.getById(relation.id);
    expect(result!.weight).toBe(0.95);
    expect(result!.metadata).toEqual({ strengthened: true });
    // updatedAt should be refreshed by the store to a newer timestamp
    expect(result!.updatedAt).not.toBe(relation.updatedAt);
  });

  it('deletes a relation', () => {
    const source = makeEntity();
    const target = makeEntity();
    entityStore.create(source);
    entityStore.create(target);

    const relation = makeRelation(source.id, target.id);
    store.create(relation);
    expect(store.getById(relation.id)).not.toBeNull();

    store.delete(relation.id);
    expect(store.getById(relation.id)).toBeNull();
  });

  it('counts relations accurately', () => {
    expect(store.count()).toBe(0);

    const source = makeEntity();
    const target = makeEntity();
    entityStore.create(source);
    entityStore.create(target);

    store.create(makeRelation(source.id, target.id, { relationType: 'works_on' }));
    store.create(makeRelation(source.id, target.id, { relationType: 'knows' }));

    expect(store.count()).toBe(2);
  });
});

// ── ClusterStore ──

describe('SqliteClusterStore', () => {
  let db: BetterSqlite3.Database;
  let store: SqliteClusterStore;

  beforeEach(() => {
    db = createTestDb();
    store = new SqliteClusterStore(db);
  });

  it('upserts a new cluster (insert)', () => {
    const cluster = makeCluster({
      label: 'Backend Services',
      entityIds: ['entity-1', 'entity-2'],
    });
    store.upsert(cluster);

    const result = store.getById(cluster.id);
    expect(result).not.toBeNull();
    expect(result!.label).toBe('Backend Services');
    expect(result!.entityIds).toEqual(['entity-1', 'entity-2']);
  });

  it('upserts an existing cluster (update)', () => {
    const cluster = makeCluster({
      label: 'Version 1',
      entityIds: ['a'],
    });
    store.upsert(cluster);

    const updatedCluster = {
      ...cluster,
      label: 'Version 2',
      entityIds: ['a', 'b', 'c'],
      metadata: { updated: true },
    };
    store.upsert(updatedCluster);

    const result = store.getById(cluster.id);
    expect(result!.label).toBe('Version 2');
    expect(result!.entityIds).toEqual(['a', 'b', 'c']);
    expect(result!.metadata).toEqual({ updated: true });
  });

  it('getForEntity finds clusters containing a given entity ID', () => {
    const entityId = randomUUID();
    const otherEntityId = randomUUID();

    store.upsert(makeCluster({ entityIds: [entityId, otherEntityId], label: 'Cluster A' }));
    store.upsert(makeCluster({ entityIds: [otherEntityId], label: 'Cluster B' }));
    store.upsert(makeCluster({ entityIds: [entityId], label: 'Cluster C' }));

    const results = store.getForEntity(entityId);
    expect(results.length).toBe(2);
    const labels = results.map((c) => c.label);
    expect(labels).toContain('Cluster A');
    expect(labels).toContain('Cluster C');
  });

  it('getForEntity returns empty array when entity is not in any cluster', () => {
    store.upsert(makeCluster({ entityIds: ['other-id'] }));
    expect(store.getForEntity('nonexistent-id')).toEqual([]);
  });

  it('list returns all clusters ordered by label', () => {
    store.upsert(makeCluster({ label: 'Zeta' }));
    store.upsert(makeCluster({ label: 'Alpha' }));
    store.upsert(makeCluster({ label: 'Mu' }));

    const all = store.list();
    expect(all.length).toBe(3);
    expect(all[0].label).toBe('Alpha');
    expect(all[1].label).toBe('Mu');
    expect(all[2].label).toBe('Zeta');
  });

  it('deleteAll removes all clusters', () => {
    store.upsert(makeCluster());
    store.upsert(makeCluster());
    store.upsert(makeCluster());
    expect(store.count()).toBe(3);

    store.deleteAll();
    expect(store.count()).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it('count returns accurate cluster count', () => {
    expect(store.count()).toBe(0);

    store.upsert(makeCluster());
    expect(store.count()).toBe(1);

    store.upsert(makeCluster());
    expect(store.count()).toBe(2);
  });

  it('returns null for non-existent cluster ID', () => {
    expect(store.getById(randomUUID())).toBeNull();
  });
});

// ── AccessLogStore ──

describe('SqliteAccessLogStore', () => {
  let db: BetterSqlite3.Database;
  let memoryStore: SqliteMemoryStore;
  let store: SqliteAccessLogStore;

  beforeEach(() => {
    db = createTestDb();
    memoryStore = new SqliteMemoryStore(db);
    store = new SqliteAccessLogStore(db);
  });

  it('logs an access entry and retrieves it for a memory', () => {
    const memory = makeMemory();
    memoryStore.create(memory);

    const now = new Date().toISOString();
    store.log({ memoryId: memory.id, accessType: 'recall', timestamp: now });

    const entries = store.getForMemory(memory.id, 10);
    expect(entries.length).toBe(1);
    expect(entries[0].memoryId).toBe(memory.id);
    expect(entries[0].accessType).toBe('recall');
    expect(entries[0].timestamp).toBe(now);
    expect(entries[0].id).toBeGreaterThan(0);
  });

  it('retrieves entries ordered by timestamp DESC', () => {
    const memory = makeMemory();
    memoryStore.create(memory);

    store.log({ memoryId: memory.id, accessType: 'recall', timestamp: '2025-01-01T00:00:00.000Z' });
    store.log({ memoryId: memory.id, accessType: 'reinforce', timestamp: '2025-06-15T12:00:00.000Z' });
    store.log({ memoryId: memory.id, accessType: 'context', timestamp: '2025-03-10T06:00:00.000Z' });

    const entries = store.getForMemory(memory.id, 10);
    expect(entries.length).toBe(3);
    // Most recent first
    expect(entries[0].timestamp).toBe('2025-06-15T12:00:00.000Z');
    expect(entries[1].timestamp).toBe('2025-03-10T06:00:00.000Z');
    expect(entries[2].timestamp).toBe('2025-01-01T00:00:00.000Z');
  });

  it('respects the limit parameter', () => {
    const memory = makeMemory();
    memoryStore.create(memory);

    for (let i = 0; i < 5; i++) {
      store.log({
        memoryId: memory.id,
        accessType: 'recall',
        timestamp: new Date(2025, 0, i + 1).toISOString(),
      });
    }

    const entries = store.getForMemory(memory.id, 2);
    expect(entries.length).toBe(2);
  });

  it('getLastAccessTime returns the most recent timestamp', () => {
    const memory = makeMemory();
    memoryStore.create(memory);

    store.log({ memoryId: memory.id, accessType: 'recall', timestamp: '2025-01-01T00:00:00.000Z' });
    store.log({ memoryId: memory.id, accessType: 'recall', timestamp: '2025-12-31T23:59:59.000Z' });
    store.log({ memoryId: memory.id, accessType: 'recall', timestamp: '2025-06-15T12:00:00.000Z' });

    const lastAccess = store.getLastAccessTime(memory.id);
    expect(lastAccess).toBe('2025-12-31T23:59:59.000Z');
  });

  it('getLastAccessTime returns null when no entries exist', () => {
    expect(store.getLastAccessTime(randomUUID())).toBeNull();
  });

  it('returns empty array when no entries exist for a memory', () => {
    expect(store.getForMemory(randomUUID(), 10)).toEqual([]);
  });

  it('isolates entries between different memories', () => {
    const mem1 = makeMemory();
    const mem2 = makeMemory();
    memoryStore.create(mem1);
    memoryStore.create(mem2);

    store.log({ memoryId: mem1.id, accessType: 'recall', timestamp: new Date().toISOString() });
    store.log({ memoryId: mem1.id, accessType: 'reinforce', timestamp: new Date().toISOString() });
    store.log({ memoryId: mem2.id, accessType: 'context', timestamp: new Date().toISOString() });

    expect(store.getForMemory(mem1.id, 10).length).toBe(2);
    expect(store.getForMemory(mem2.id, 10).length).toBe(1);
  });
});

// ── VectorStore ──

describe('SqliteVectorStore', () => {
  let db: BetterSqlite3.Database;
  let store: SqliteVectorStore;

  beforeEach(() => {
    db = createTestDb();
    store = new SqliteVectorStore(db);
  });

  it('upserts a vector and finds it via search', () => {
    const id = randomUUID();
    const embedding = makeEmbedding();

    store.upsert('memory_vectors', id, embedding);

    const results = store.search('memory_vectors', embedding, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(id);
    // Distance to itself should be 0 or very close
    expect(results[0].distance).toBeCloseTo(0, 3);
  });

  it('upsert replaces an existing vector', () => {
    const id = randomUUID();
    const embedding1 = makeBiasedEmbedding(1.0);
    const embedding2 = makeBiasedEmbedding(-1.0);

    store.upsert('memory_vectors', id, embedding1);
    store.upsert('memory_vectors', id, embedding2);

    // Search with embedding2 — should find the id close to it
    const results = store.search('memory_vectors', embedding2, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(id);
    expect(results[0].distance).toBeCloseTo(0, 3);
  });

  it('delete removes a vector from search results', () => {
    const id = randomUUID();
    const embedding = makeEmbedding();

    store.upsert('memory_vectors', id, embedding);

    // Confirm it exists
    const before = store.search('memory_vectors', embedding, 5);
    expect(before.some((r) => r.id === id)).toBe(true);

    store.delete('memory_vectors', id);

    // Confirm it is gone
    const after = store.search('memory_vectors', embedding, 5);
    expect(after.some((r) => r.id === id)).toBe(false);
  });

  it('search returns results ordered by distance (ascending)', () => {
    const queryEmbedding = makeBiasedEmbedding(0.5);
    const closeEmbedding = makeBiasedEmbedding(0.51); // Very close to query
    const farEmbedding = makeBiasedEmbedding(-0.5);   // Far from query

    const closeId = randomUUID();
    const farId = randomUUID();

    store.upsert('memory_vectors', closeId, closeEmbedding);
    store.upsert('memory_vectors', farId, farEmbedding);

    const results = store.search('memory_vectors', queryEmbedding, 10);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe(closeId);
    expect(results[1].id).toBe(farId);
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it('search respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      store.upsert('memory_vectors', randomUUID(), makeEmbedding());
    }

    const results = store.search('memory_vectors', makeEmbedding(), 2);
    expect(results.length).toBe(2);
  });

  it('works with entity_vectors table', () => {
    const id = randomUUID();
    const embedding = makeEmbedding();

    store.upsert('entity_vectors', id, embedding);

    const results = store.search('entity_vectors', embedding, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(id);
  });

  it('rejects invalid table names', () => {
    const embedding = makeEmbedding();
    const id = randomUUID();

    expect(() => store.upsert('malicious_table', id, embedding)).toThrow('Invalid vector table name');
    expect(() => store.search('malicious_table', embedding, 5)).toThrow('Invalid vector table name');
    expect(() => store.delete('malicious_table', id)).toThrow('Invalid vector table name');
  });

  it('search returns empty array when no vectors exist', () => {
    const results = store.search('memory_vectors', makeEmbedding(), 5);
    expect(results).toEqual([]);
  });
});

// ── ConfigStore ──

describe('SqliteConfigStore', () => {
  let db: BetterSqlite3.Database;
  let store: SqliteConfigStore;

  beforeEach(() => {
    db = createTestDb();
    store = new SqliteConfigStore(db);
  });

  it('sets and gets a configuration value', () => {
    store.set('embeddingModel', 'all-MiniLM-L6-v2');

    const result = store.get('embeddingModel');
    expect(result).toBe('all-MiniLM-L6-v2');
  });

  it('returns null for a non-existent key', () => {
    expect(store.get('nonexistent-key')).toBeNull();
  });

  it('updates an existing key via upsert', () => {
    store.set('logLevel', 'info');
    expect(store.get('logLevel')).toBe('info');

    store.set('logLevel', 'debug');
    expect(store.get('logLevel')).toBe('debug');
  });

  it('deletes a configuration key', () => {
    store.set('tempKey', 'tempValue');
    expect(store.get('tempKey')).toBe('tempValue');

    store.delete('tempKey');
    expect(store.get('tempKey')).toBeNull();
  });

  it('delete is safe for non-existent keys', () => {
    expect(() => store.delete('nonexistent')).not.toThrow();
  });

  it('handles special characters in values', () => {
    const jsonValue = JSON.stringify({ nested: { key: 'value' }, arr: [1, 2, 3] });
    store.set('jsonConfig', jsonValue);
    expect(store.get('jsonConfig')).toBe(jsonValue);
  });

  it('handles empty string values', () => {
    store.set('emptyKey', '');
    expect(store.get('emptyKey')).toBe('');
  });

  it('multiple keys coexist independently', () => {
    store.set('key1', 'value1');
    store.set('key2', 'value2');
    store.set('key3', 'value3');

    expect(store.get('key1')).toBe('value1');
    expect(store.get('key2')).toBe('value2');
    expect(store.get('key3')).toBe('value3');

    store.delete('key2');
    expect(store.get('key1')).toBe('value1');
    expect(store.get('key2')).toBeNull();
    expect(store.get('key3')).toBe('value3');
  });
});
