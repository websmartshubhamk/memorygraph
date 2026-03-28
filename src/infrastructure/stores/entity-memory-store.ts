/**
 * SQLite-backed entity-memory link store.
 * Manages the many-to-many relationship between entities and memories.
 */

import type Database from 'better-sqlite3';
import type {
  EntityId,
  EntityMemory,
  MemoryId,
} from '../../core/models/types.js';
import type { EntityMemoryStore } from '../../core/interfaces/stores.js';
import { nowISO } from '../../utils/text.js';

/** Row shape as stored in SQLite. */
interface EntityMemoryRow {
  entity_id: string;
  memory_id: string;
  role: string;
  created_at: string;
}

function rowToEntityMemory(row: EntityMemoryRow): EntityMemory {
  return {
    entityId: row.entity_id,
    memoryId: row.memory_id,
    role: row.role,
    createdAt: row.created_at,
  };
}

export class SqliteEntityMemoryStore implements EntityMemoryStore {
  constructor(private readonly db: Database.Database) {}

  link(entityId: EntityId, memoryId: MemoryId, role: string): void {
    const now = nowISO();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO entity_memories (entity_id, memory_id, role, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(entityId, memoryId, role, now);
  }

  getEntitiesForMemory(memoryId: MemoryId): EntityMemory[] {
    const rows = this.db
      .prepare('SELECT * FROM entity_memories WHERE memory_id = ?')
      .all(memoryId) as EntityMemoryRow[];
    return rows.map(rowToEntityMemory);
  }

  getMemoriesForEntity(entityId: EntityId): EntityMemory[] {
    const rows = this.db
      .prepare('SELECT * FROM entity_memories WHERE entity_id = ?')
      .all(entityId) as EntityMemoryRow[];
    return rows.map(rowToEntityMemory);
  }

  unlink(entityId: EntityId, memoryId: MemoryId): void {
    this.db
      .prepare('DELETE FROM entity_memories WHERE entity_id = ? AND memory_id = ?')
      .run(entityId, memoryId);
  }
}
