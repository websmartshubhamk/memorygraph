import type Database from 'better-sqlite3';
import type { Logger } from '../../utils/logger.js';
import { migrations } from './migrations/index.js';

/**
 * Runs pending database migrations in order within a transaction.
 */
export class MigrationRunner {
  constructor(
    private db: Database.Database,
    private logger: Logger,
  ) {}

  getCurrentVersion(): number {
    try {
      const row = this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as
        | { version: number | null }
        | undefined;
      return row?.version ?? 0;
    } catch {
      // schema_version table doesn't exist yet
      return 0;
    }
  }

  run(): void {
    const current = this.getCurrentVersion();
    const pending = migrations.filter((m) => m.version > current);

    if (pending.length === 0) {
      this.logger.debug('Database schema is up to date (version %d)', current);
      return;
    }

    this.logger.info('Running %d migration(s) from version %d', pending.length, current);

    for (const migration of pending) {
      const runMigration = this.db.transaction(() => {
        this.logger.info('Applying migration %d: %s', migration.version, migration.description);
        migration.up(this.db);

        this.db
          .prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)')
          .run(migration.version, migration.description);
      });

      runMigration();
      this.logger.info('Migration %d applied successfully', migration.version);
    }

    this.logger.info('All migrations complete. Schema now at version %d', this.getCurrentVersion());
  }
}
