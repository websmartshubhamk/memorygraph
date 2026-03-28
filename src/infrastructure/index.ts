/**
 * Infrastructure layer — I/O implementations for database, embeddings, stores, and configuration.
 */

export { DatabaseManager, MigrationRunner, migrations } from './database/index.js';
export { EmbeddingProviderImpl } from './embeddings/index.js';
export { loadConfig } from './config/index.js';
export {
  SqliteEntityStore,
  SqliteMemoryStore,
  SqliteEntityMemoryStore,
  SqliteRelationStore,
  SqliteClusterStore,
  SqliteAccessLogStore,
  SqliteVectorStore,
  SqliteConfigStore,
} from './stores/index.js';
