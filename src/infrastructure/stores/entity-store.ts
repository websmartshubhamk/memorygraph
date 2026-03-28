/**
 * SQLite-backed entity store.
 * Handles CRUD operations for entities with JSON alias/metadata fields.
 */

import type Database from 'better-sqlite3';
import type {
  Entity,
  EntityId,
  EntityType,
} from '../../core/models/types.js';
import type { EntityStore } from '../../core/interfaces/stores.js';
import { nowISO } from '../../utils/text.js';

/** Row shape as stored in SQLite (snake_case, JSON strings, no booleans). */
interface EntityRow {
  id: string;
  name: string;
  entity_type: string;
  aliases: string;
  description: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    name: row.name,
    entityType: row.entity_type as EntityType,
    aliases: JSON.parse(row.aliases) as string[],
    description: row.description,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteEntityStore implements EntityStore {
  constructor(private readonly db: Database.Database) {}

  create(entity: Entity): void {
    this.db
      .prepare(
        `INSERT INTO entities (id, name, entity_type, aliases, description, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entity.id,
        entity.name,
        entity.entityType,
        JSON.stringify(entity.aliases),
        entity.description,
        JSON.stringify(entity.metadata),
        entity.createdAt,
        entity.updatedAt,
      );
  }

  getById(id: EntityId): Entity | null {
    const row = this.db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(id) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  getByName(name: string): Entity | null {
    const row = this.db
      .prepare('SELECT * FROM entities WHERE lower(name) = lower(?)')
      .get(name) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  getByAlias(alias: string): Entity | null {
    const row = this.db
      .prepare(
        `SELECT e.* FROM entities e, json_each(e.aliases) AS j
         WHERE lower(j.value) = lower(?)
         LIMIT 1`,
      )
      .get(alias) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  search(query: string, limit: number): Entity[] {
    const pattern = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM entities
         WHERE name LIKE ? OR description LIKE ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(pattern, pattern, limit) as EntityRow[];
    return rows.map(rowToEntity);
  }

  searchByType(entityType: EntityType, limit: number, offset: number): Entity[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entities
         WHERE entity_type = ?
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(entityType, limit, offset) as EntityRow[];
    return rows.map(rowToEntity);
  }

  list(limit: number, offset: number): Entity[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entities
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as EntityRow[];
    return rows.map(rowToEntity);
  }

  update(entity: Entity): void {
    const now = nowISO();
    this.db
      .prepare(
        `UPDATE entities
         SET name = ?, entity_type = ?, aliases = ?, description = ?,
             metadata = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        entity.name,
        entity.entityType,
        JSON.stringify(entity.aliases),
        entity.description,
        JSON.stringify(entity.metadata),
        now,
        entity.id,
      );
  }

  delete(id: EntityId): void {
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(id);
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM entities')
      .get() as { cnt: number };
    return row.cnt;
  }
}
