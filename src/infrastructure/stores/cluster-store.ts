/**
 * SQLite-backed cluster store.
 * Manages Louvain community clusters with entity membership stored as JSON.
 */

import type Database from 'better-sqlite3';
import type {
  Cluster,
  ClusterId,
  EntityId,
} from '../../core/models/types.js';
import type { ClusterStore } from '../../core/interfaces/stores.js';
import { nowISO } from '../../utils/text.js';

/** Row shape as stored in SQLite. */
interface ClusterRow {
  id: string;
  label: string;
  entity_ids: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToCluster(row: ClusterRow): Cluster {
  return {
    id: row.id,
    label: row.label,
    entityIds: JSON.parse(row.entity_ids) as EntityId[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteClusterStore implements ClusterStore {
  constructor(private readonly db: Database.Database) {}

  upsert(cluster: Cluster): void {
    const now = nowISO();
    this.db
      .prepare(
        `INSERT INTO clusters (id, label, entity_ids, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           entity_ids = excluded.entity_ids,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
      )
      .run(
        cluster.id,
        cluster.label,
        JSON.stringify(cluster.entityIds),
        JSON.stringify(cluster.metadata),
        cluster.createdAt,
        now,
      );
  }

  getById(id: ClusterId): Cluster | null {
    const row = this.db
      .prepare('SELECT * FROM clusters WHERE id = ?')
      .get(id) as ClusterRow | undefined;
    return row ? rowToCluster(row) : null;
  }

  getForEntity(entityId: EntityId): Cluster[] {
    // Search JSON array for entity membership using json_each
    const rows = this.db
      .prepare(
        `SELECT c.* FROM clusters c, json_each(c.entity_ids) AS j
         WHERE j.value = ?`,
      )
      .all(entityId) as ClusterRow[];
    return rows.map(rowToCluster);
  }

  list(): Cluster[] {
    const rows = this.db
      .prepare('SELECT * FROM clusters ORDER BY label ASC')
      .all() as ClusterRow[];
    return rows.map(rowToCluster);
  }

  deleteAll(): void {
    this.db.prepare('DELETE FROM clusters').run();
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM clusters')
      .get() as { cnt: number };
    return row.cnt;
  }
}
