/**
 * Configuration manager for MemoryGraph.
 * Loads sensible defaults with environment variable overrides.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { MemoryGraphConfig } from '../../core/models/types.js';

/**
 * Parse a numeric environment variable with validation.
 * Returns the default if the variable is unset, empty, or not a valid number.
 */
function parseNumericEnv(envValue: string | undefined, defaultValue: number): number {
  if (envValue === undefined || envValue === '') {
    return defaultValue;
  }
  const parsed = Number(envValue);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Load the MemoryGraph configuration.
 *
 * All values have sensible defaults. Override any value via environment variables:
 *
 * - MEMORYGRAPH_DATA_DIR — Base directory for all MemoryGraph data (default: ~/.memorygraph)
 * - MEMORYGRAPH_DB_PATH — Full path to the SQLite database file
 * - MEMORYGRAPH_MODEL — Embedding model identifier (default: Xenova/all-MiniLM-L6-v2)
 * - MEMORYGRAPH_DECAY_RATE — Default memory decay rate per day (default: 0.01)
 * - MEMORYGRAPH_DEFAULT_SALIENCE — Default initial salience for new memories (default: 0.5)
 * - MEMORYGRAPH_MIN_SALIENCE — Minimum salience before a memory is prunable (default: 0.01)
 * - MEMORYGRAPH_MAX_RESULTS — Maximum recall results (default: 100)
 * - MEMORYGRAPH_MAINTENANCE_INTERVAL — Maintenance interval in milliseconds (default: 3600000)
 * - MEMORYGRAPH_LOG_LEVEL — Logging level (default: info)
 */
export function loadConfig(): MemoryGraphConfig {
  const dataDir = process.env.MEMORYGRAPH_DATA_DIR || join(homedir(), '.memorygraph');

  return {
    dataDir,
    dbPath: process.env.MEMORYGRAPH_DB_PATH || join(dataDir, 'memory.db'),
    embeddingModel: process.env.MEMORYGRAPH_MODEL || 'Xenova/all-MiniLM-L6-v2',
    embeddingDimensions: 384,
    defaultDecayRate: parseNumericEnv(process.env.MEMORYGRAPH_DECAY_RATE, 0.01),
    defaultSalience: parseNumericEnv(process.env.MEMORYGRAPH_DEFAULT_SALIENCE, 0.5),
    minSalienceThreshold: parseNumericEnv(process.env.MEMORYGRAPH_MIN_SALIENCE, 0.01),
    maxRecallResults: parseNumericEnv(process.env.MEMORYGRAPH_MAX_RESULTS, 100),
    maintenanceIntervalMs: parseNumericEnv(process.env.MEMORYGRAPH_MAINTENANCE_INTERVAL, 3600000),
    logLevel: process.env.MEMORYGRAPH_LOG_LEVEL || 'info',
  };
}
