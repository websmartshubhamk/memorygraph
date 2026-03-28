/**
 * SQLite-backed relation store.
 * Manages directed relationships between entities with type and weight.
 */

import type Database from 'better-sqlite3';
import type {
  EntityId,
  Relation,
  RelationId,
  RelationType,
} from '../../core/models/types.js';
import type { RelationStore } from '../../core/interfaces/stores.js';
import { nowISO } from '../../utils/text.js';

/** Row shape as stored in SQLite. */
interface RelationRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  weight: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToRelation(row: RelationRow): Relation {
  return {
    id: row.id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    relationType: row.relation_type as RelationType,
    weight: row.weight,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteRelationStore implements RelationStore {
  constructor(private readonly db: Database.Database) {}

  create(relation: Relation): void {
    this.db
      .prepare(
        `INSERT INTO relations
           (id, source_entity_id, target_entity_id, relation_type, weight, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        relation.id,
        relation.sourceEntityId,
        relation.targetEntityId,
        relation.relationType,
        relation.weight,
        JSON.stringify(relation.metadata),
        relation.createdAt,
        relation.updatedAt,
      );
  }

  getById(id: RelationId): Relation | null {
    const row = this.db
      .prepare('SELECT * FROM relations WHERE id = ?')
      .get(id) as RelationRow | undefined;
    return row ? rowToRelation(row) : null;
  }

  getByEntities(
    sourceId: EntityId,
    targetId: EntityId,
    relationType?: RelationType,
  ): Relation | null {
    if (relationType) {
      const row = this.db
        .prepare(
          `SELECT * FROM relations
           WHERE source_entity_id = ? AND target_entity_id = ? AND relation_type = ?`,
        )
        .get(sourceId, targetId, relationType) as RelationRow | undefined;
      return row ? rowToRelation(row) : null;
    }

    const row = this.db
      .prepare(
        `SELECT * FROM relations
         WHERE source_entity_id = ? AND target_entity_id = ?
         LIMIT 1`,
      )
      .get(sourceId, targetId) as RelationRow | undefined;
    return row ? rowToRelation(row) : null;
  }

  getForEntity(entityId: EntityId): Relation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM relations
         WHERE source_entity_id = ? OR target_entity_id = ?
         ORDER BY weight DESC`,
      )
      .all(entityId, entityId) as RelationRow[];
    return rows.map(rowToRelation);
  }

  update(relation: Relation): void {
    const now = nowISO();
    this.db
      .prepare(
        `UPDATE relations
         SET source_entity_id = ?, target_entity_id = ?, relation_type = ?,
             weight = ?, metadata = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        relation.sourceEntityId,
        relation.targetEntityId,
        relation.relationType,
        relation.weight,
        JSON.stringify(relation.metadata),
        now,
        relation.id,
      );
  }

  delete(id: RelationId): void {
    this.db.prepare('DELETE FROM relations WHERE id = ?').run(id);
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM relations')
      .get() as { cnt: number };
    return row.cnt;
  }
}
