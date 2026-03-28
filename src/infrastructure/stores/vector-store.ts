/**
 * SQLite-backed vector store using sqlite-vec.
 * Provides KNN search over vec0 virtual tables for semantic similarity.
 */

import type Database from 'better-sqlite3';
import type { Embedding } from '../../core/models/types.js';
import type { VectorStore } from '../../core/interfaces/stores.js';

/** Allowed virtual table names — prevents SQL injection via table parameter. */
const ALLOWED_TABLES = new Set(['memory_vectors', 'entity_vectors']);

function assertValidTable(table: string): void {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid vector table name: "${table}". Allowed: ${[...ALLOWED_TABLES].join(', ')}`);
  }
}

function embeddingToBuffer(embedding: Embedding): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

export class SqliteVectorStore implements VectorStore {
  constructor(private readonly db: Database.Database) {}

  upsert(table: string, id: string, embedding: Embedding): void {
    assertValidTable(table);
    const buf = embeddingToBuffer(embedding);

    // sqlite-vec does not support UPDATE; use DELETE then INSERT
    const txn = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      this.db.prepare(`INSERT INTO ${table} (id, embedding) VALUES (?, ?)`).run(id, buf);
    });
    txn();
  }

  search(
    table: string,
    query: Embedding,
    limit: number,
  ): Array<{ id: string; distance: number }> {
    assertValidTable(table);
    const buf = embeddingToBuffer(query);

    const rows = this.db
      .prepare(
        `SELECT id, distance FROM ${table}
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(buf, limit) as Array<{ id: string; distance: number }>;

    return rows;
  }

  delete(table: string, id: string): void {
    assertValidTable(table);
    this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  }
}
