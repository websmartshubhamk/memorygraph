import type Database from 'better-sqlite3';

export const version = 4;
export const description = 'Vector tables for semantic search (sqlite-vec)';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[384]
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS entity_vectors USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[384]
    );
  `);
}
