/**
 * SQLite-backed access log store.
 * Records memory access events for recency/frequency tracking.
 */

import type Database from 'better-sqlite3';
import type {
  AccessLogEntry,
  MemoryId,
} from '../../core/models/types.js';
import type { AccessLogStore } from '../../core/interfaces/stores.js';

/** Row shape as stored in SQLite. */
interface AccessLogRow {
  id: number;
  memory_id: string;
  access_type: string;
  timestamp: string;
}

function rowToEntry(row: AccessLogRow): AccessLogEntry {
  return {
    id: row.id,
    memoryId: row.memory_id,
    accessType: row.access_type as AccessLogEntry['accessType'],
    timestamp: row.timestamp,
  };
}

export class SqliteAccessLogStore implements AccessLogStore {
  constructor(private readonly db: Database.Database) {}

  log(entry: Omit<AccessLogEntry, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO access_log (memory_id, access_type, timestamp)
         VALUES (?, ?, ?)`,
      )
      .run(entry.memoryId, entry.accessType, entry.timestamp);
  }

  getForMemory(memoryId: MemoryId, limit: number): AccessLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM access_log
         WHERE memory_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(memoryId, limit) as AccessLogRow[];
    return rows.map(rowToEntry);
  }

  getLastAccessTime(memoryId: MemoryId): string | null {
    const row = this.db
      .prepare(
        `SELECT timestamp FROM access_log
         WHERE memory_id = ?
         ORDER BY timestamp DESC
         LIMIT 1`,
      )
      .get(memoryId) as { timestamp: string } | undefined;
    return row?.timestamp ?? null;
  }
}
