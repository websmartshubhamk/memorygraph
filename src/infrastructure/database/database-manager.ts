import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { Logger } from '../../utils/logger.js';
import { MigrationRunner } from './migration-runner.js';

/**
 * Manages the SQLite database lifecycle: open, configure, migrate, close.
 */
export class DatabaseManager {
  private db: BetterSqlite3.Database | null = null;

  constructor(
    private dbPath: string,
    private logger: Logger,
  ) {}

  /**
   * Open the database, configure WAL mode, load sqlite-vec, run migrations.
   */
  open(): BetterSqlite3.Database {
    if (this.db) return this.db;

    // Ensure data directory exists
    mkdirSync(dirname(this.dbPath), { recursive: true });

    this.logger.info('Opening database at %s', this.dbPath);
    this.db = new BetterSqlite3(this.dbPath);

    // Performance configuration
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('cache_size = -64000'); // 64MB

    // Load sqlite-vec extension
    sqliteVec.load(this.db);
    this.logger.info('sqlite-vec extension loaded');

    // Run migrations
    const runner = new MigrationRunner(this.db, this.logger);
    runner.run();

    return this.db;
  }

  /**
   * Get the open database instance.
   */
  get(): BetterSqlite3.Database {
    if (!this.db) {
      throw new Error('Database not open. Call open() first.');
    }
    return this.db;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.logger.info('Closing database');
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get database file size in bytes.
   */
  getSize(): number {
    if (!this.db) return 0;
    const row = this.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as { size: number } | undefined;
    return row?.size ?? 0;
  }
}
