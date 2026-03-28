/**
 * SQLite-backed memory store.
 * Handles CRUD operations for memories with salience tracking and soft-delete.
 */

import type Database from 'better-sqlite3';
import type {
  Memory,
  MemoryId,
  MemoryType,
  EntityId,
} from '../../core/models/types.js';
import type { MemoryStore } from '../../core/interfaces/stores.js';
import { nowISO } from '../../utils/text.js';

/** Row shape as stored in SQLite. */
interface MemoryRow {
  id: string;
  content: string;
  memory_type: string;
  initial_salience: number;
  current_salience: number;
  decay_rate: number;
  permanent: number;
  access_count: number;
  reinforcement_count: number;
  last_accessed_at: string;
  metadata: string;
  content_hash: string;
  deleted: number;
  created_at: string;
  updated_at: string;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    memoryType: row.memory_type as MemoryType,
    initialSalience: row.initial_salience,
    currentSalience: row.current_salience,
    decayRate: row.decay_rate,
    permanent: row.permanent === 1,
    accessCount: row.access_count,
    reinforcementCount: row.reinforcement_count,
    lastAccessedAt: row.last_accessed_at,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    contentHash: row.content_hash,
    deleted: row.deleted === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteMemoryStore implements MemoryStore {
  constructor(private readonly db: Database.Database) {}

  create(memory: Memory): void {
    this.db
      .prepare(
        `INSERT INTO memories
           (id, content, memory_type, initial_salience, current_salience,
            decay_rate, permanent, access_count, reinforcement_count,
            last_accessed_at, metadata, content_hash, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memory.id,
        memory.content,
        memory.memoryType,
        memory.initialSalience,
        memory.currentSalience,
        memory.decayRate,
        memory.permanent ? 1 : 0,
        memory.accessCount,
        memory.reinforcementCount,
        memory.lastAccessedAt,
        JSON.stringify(memory.metadata),
        memory.contentHash,
        memory.deleted ? 1 : 0,
        memory.createdAt,
        memory.updatedAt,
      );
  }

  getById(id: MemoryId): Memory | null {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  getByContentHash(hash: string): Memory | null {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE content_hash = ?')
      .get(hash) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  getByEntity(entityId: EntityId, limit: number): Memory[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM memories m
         INNER JOIN entity_memories em ON em.memory_id = m.id
         WHERE em.entity_id = ? AND m.deleted = 0
         ORDER BY m.current_salience DESC
         LIMIT ?`,
      )
      .all(entityId, limit) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  getActive(limit: number, minSalience: number): Memory[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE deleted = 0 AND current_salience >= ?
         ORDER BY current_salience DESC
         LIMIT ?`,
      )
      .all(minSalience, limit) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  update(memory: Memory): void {
    const now = nowISO();
    this.db
      .prepare(
        `UPDATE memories
         SET content = ?, memory_type = ?, initial_salience = ?,
             current_salience = ?, decay_rate = ?, permanent = ?,
             access_count = ?, reinforcement_count = ?, last_accessed_at = ?,
             metadata = ?, content_hash = ?, deleted = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        memory.content,
        memory.memoryType,
        memory.initialSalience,
        memory.currentSalience,
        memory.decayRate,
        memory.permanent ? 1 : 0,
        memory.accessCount,
        memory.reinforcementCount,
        memory.lastAccessedAt,
        JSON.stringify(memory.metadata),
        memory.contentHash,
        memory.deleted ? 1 : 0,
        now,
        memory.id,
      );
  }

  softDelete(id: MemoryId): void {
    const now = nowISO();
    this.db
      .prepare('UPDATE memories SET deleted = 1, updated_at = ? WHERE id = ?')
      .run(now, id);
  }

  count(includeDeleted = false): number {
    if (includeDeleted) {
      const row = this.db
        .prepare('SELECT COUNT(*) AS cnt FROM memories')
        .get() as { cnt: number };
      return row.cnt;
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM memories WHERE deleted = 0')
      .get() as { cnt: number };
    return row.cnt;
  }

  getOldest(): Memory | null {
    const row = this.db
      .prepare(
        'SELECT * FROM memories WHERE deleted = 0 ORDER BY created_at ASC LIMIT 1',
      )
      .get() as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  getNewest(): Memory | null {
    const row = this.db
      .prepare(
        'SELECT * FROM memories WHERE deleted = 0 ORDER BY created_at DESC LIMIT 1',
      )
      .get() as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  getAverageSalience(): number {
    const row = this.db
      .prepare(
        'SELECT AVG(current_salience) AS avg_salience FROM memories WHERE deleted = 0',
      )
      .get() as { avg_salience: number | null };
    return row.avg_salience ?? 0;
  }

  getAllActive(): Memory[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM memories WHERE deleted = 0 ORDER BY current_salience DESC',
      )
      .all() as MemoryRow[];
    return rows.map(rowToMemory);
  }

  pruneBelow(threshold: number): number {
    const now = nowISO();
    const result = this.db
      .prepare(
        `UPDATE memories
         SET deleted = 1, updated_at = ?
         WHERE deleted = 0 AND permanent = 0 AND current_salience < ?`,
      )
      .run(now, threshold);
    return result.changes;
  }
}
