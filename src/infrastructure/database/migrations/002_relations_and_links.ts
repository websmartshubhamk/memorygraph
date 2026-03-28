import type Database from 'better-sqlite3';

export const version = 2;
export const description = 'Entity-memory links and relations';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_memories (
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'subject',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (entity_id, memory_id)
    );

    CREATE INDEX IF NOT EXISTS idx_entity_memories_entity ON entity_memories(entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_memories_memory ON entity_memories(memory_id);

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL DEFAULT 'related_to',
      weight REAL NOT NULL DEFAULT 0.5,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_entity_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_pair_type ON relations(source_entity_id, target_entity_id, relation_type);
  `);
}
