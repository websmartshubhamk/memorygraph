/**
 * Integration tests for DatabaseManager and MigrationRunner.
 *
 * Validates database lifecycle: open, configure, migrate, close, reopen.
 * Uses temporary files to avoid polluting the real data directory.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { DatabaseManager } from '../../src/infrastructure/database/database-manager.js';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.js';
import { migrations } from '../../src/infrastructure/database/migrations/index.js';
import type { Logger } from '../../src/utils/logger.js';

// ── Helpers ──

/** Silent logger that swallows all output during tests. */
function createSilentLogger(): Logger {
  const noop = () => {};
  return {
    info: noop,
    debug: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => createSilentLogger(),
    level: 'silent',
  } as unknown as Logger;
}

/** Generate a unique temp directory for each test run. */
function createTempDbPath(): string {
  const dir = join(tmpdir(), 'memorygraph-test', randomUUID());
  mkdirSync(dir, { recursive: true });
  return join(dir, 'test.db');
}

/** Remove temp directory tree. */
function cleanupTempDir(dbPath: string): void {
  const dir = join(dbPath, '..');
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup — Windows may hold file locks briefly
  }
}

// ── Test Suites ──

describe('DatabaseManager', () => {
  let dbPath: string;
  let logger: Logger;

  beforeEach(() => {
    dbPath = createTempDbPath();
    logger = createSilentLogger();
  });

  afterEach(() => {
    cleanupTempDir(dbPath);
  });

  it('opens a database at the specified path', () => {
    const manager = new DatabaseManager(dbPath, logger);
    const db = manager.open();

    expect(db).toBeDefined();
    expect(existsSync(dbPath)).toBe(true);

    manager.close();
  });

  it('returns the same database instance when open() is called twice', () => {
    const manager = new DatabaseManager(dbPath, logger);
    const db1 = manager.open();
    const db2 = manager.open();

    expect(db1).toBe(db2);

    manager.close();
  });

  it('creates all expected tables after migrations', () => {
    const manager = new DatabaseManager(dbPath, logger);
    manager.open();
    const db = manager.get();

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);

    // Core tables from migrations
    expect(tableNames).toContain('schema_version');
    expect(tableNames).toContain('config');
    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('memories');
    expect(tableNames).toContain('entity_memories');
    expect(tableNames).toContain('relations');
    expect(tableNames).toContain('clusters');
    expect(tableNames).toContain('access_log');

    manager.close();
  });

  it('creates vector virtual tables after migrations', () => {
    const manager = new DatabaseManager(dbPath, logger);
    manager.open();
    const db = manager.get();

    // vec0 virtual tables appear in sqlite_master as type 'table'
    // but we can verify by attempting a query against them
    const memoryVecInfo = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'memory_vectors'`,
      )
      .get();
    const entityVecInfo = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'entity_vectors'`,
      )
      .get();

    expect(memoryVecInfo).toBeDefined();
    expect(entityVecInfo).toBeDefined();

    manager.close();
  });

  it('enables WAL journal mode', () => {
    const manager = new DatabaseManager(dbPath, logger);
    manager.open();
    const db = manager.get();

    const row = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(row[0].journal_mode).toBe('wal');

    manager.close();
  });

  it('enables foreign keys', () => {
    const manager = new DatabaseManager(dbPath, logger);
    manager.open();
    const db = manager.get();

    const row = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(row[0].foreign_keys).toBe(1);

    manager.close();
  });

  it('getSize() returns a positive number for a populated database', () => {
    const manager = new DatabaseManager(dbPath, logger);
    manager.open();

    const size = manager.getSize();
    expect(size).toBeGreaterThan(0);

    manager.close();
  });

  it('getSize() returns 0 when database is not open', () => {
    const manager = new DatabaseManager(dbPath, logger);
    expect(manager.getSize()).toBe(0);
  });

  it('get() throws when database is not open', () => {
    const manager = new DatabaseManager(dbPath, logger);
    expect(() => manager.get()).toThrow('Database not open');
  });

  it('close() and reopen works correctly', () => {
    const manager = new DatabaseManager(dbPath, logger);
    manager.open();

    // Insert a test row to verify data persists
    const db = manager.get();
    db.prepare("INSERT INTO config (key, value, updated_at) VALUES ('test_key', 'test_value', datetime('now'))").run();

    manager.close();

    // Reopen and verify data survived
    const manager2 = new DatabaseManager(dbPath, logger);
    const db2 = manager2.open();

    const row = db2.prepare("SELECT value FROM config WHERE key = 'test_key'").get() as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.value).toBe('test_value');

    manager2.close();
  });

  it('close() is safe to call multiple times', () => {
    const manager = new DatabaseManager(dbPath, logger);
    manager.open();

    expect(() => {
      manager.close();
      manager.close();
      manager.close();
    }).not.toThrow();
  });
});

describe('MigrationRunner', () => {
  let dbPath: string;
  let logger: Logger;

  beforeEach(() => {
    dbPath = createTempDbPath();
    logger = createSilentLogger();
  });

  afterEach(() => {
    cleanupTempDir(dbPath);
  });

  it('reports version 0 before any migrations', () => {
    const db = new BetterSqlite3(dbPath);
    sqliteVec.load(db);

    const runner = new MigrationRunner(db, logger);
    expect(runner.getCurrentVersion()).toBe(0);

    db.close();
  });

  it('runs all migrations successfully', () => {
    const db = new BetterSqlite3(dbPath);
    db.pragma('foreign_keys = ON');
    sqliteVec.load(db);

    const runner = new MigrationRunner(db, logger);
    runner.run();

    expect(runner.getCurrentVersion()).toBe(migrations.length);

    db.close();
  });

  it('is idempotent — running twice does not fail or duplicate', () => {
    const db = new BetterSqlite3(dbPath);
    db.pragma('foreign_keys = ON');
    sqliteVec.load(db);

    const runner = new MigrationRunner(db, logger);
    runner.run();
    const versionAfterFirst = runner.getCurrentVersion();

    // Run again — should be a no-op
    runner.run();
    const versionAfterSecond = runner.getCurrentVersion();

    expect(versionAfterSecond).toBe(versionAfterFirst);

    // Verify schema_version table has exactly the expected number of rows
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM schema_version').get() as { cnt: number };
    expect(row.cnt).toBe(migrations.length);

    db.close();
  });

  it('records each migration version in schema_version', () => {
    const db = new BetterSqlite3(dbPath);
    db.pragma('foreign_keys = ON');
    sqliteVec.load(db);

    const runner = new MigrationRunner(db, logger);
    runner.run();

    const rows = db
      .prepare('SELECT version, description FROM schema_version ORDER BY version')
      .all() as Array<{ version: number; description: string }>;

    expect(rows.length).toBe(migrations.length);
    for (let i = 0; i < migrations.length; i++) {
      expect(rows[i].version).toBe(migrations[i].version);
      expect(rows[i].description).toBe(migrations[i].description);
    }

    db.close();
  });

  it('only runs pending migrations when partially migrated', () => {
    const db = new BetterSqlite3(dbPath);
    db.pragma('foreign_keys = ON');
    sqliteVec.load(db);

    // Run only the first migration manually
    migrations[0].up(db);
    db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
      migrations[0].version,
      migrations[0].description,
    );

    expect(new MigrationRunner(db, logger).getCurrentVersion()).toBe(1);

    // Now run the full migration suite — should only apply the remaining
    const runner = new MigrationRunner(db, logger);
    runner.run();

    expect(runner.getCurrentVersion()).toBe(migrations.length);

    db.close();
  });
});
