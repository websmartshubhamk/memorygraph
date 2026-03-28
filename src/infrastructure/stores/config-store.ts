/**
 * SQLite-backed configuration store.
 * Simple key-value persistence for runtime configuration.
 */

import type Database from 'better-sqlite3';
import type { ConfigStore } from '../../core/interfaces/stores.js';
import { nowISO } from '../../utils/text.js';

export class SqliteConfigStore implements ConfigStore {
  constructor(private readonly db: Database.Database) {}

  get(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM config WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    const now = nowISO();
    this.db
      .prepare(
        `INSERT INTO config (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM config WHERE key = ?').run(key);
  }
}
