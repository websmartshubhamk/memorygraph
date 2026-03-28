import type Database from 'better-sqlite3';

export const version = 3;
export const description = 'Clusters and access log';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clusters (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      entity_ids TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      access_type TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_access_log_memory ON access_log(memory_id);
    CREATE INDEX IF NOT EXISTS idx_access_log_timestamp ON access_log(timestamp);
  `);
}
