import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

export { version as v1Version, description as v1Description, up as v1Up } from './001_initial_schema.js';
export { version as v2Version, description as v2Description, up as v2Up } from './002_relations_and_links.js';
export { version as v3Version, description as v3Description, up as v3Up } from './003_clusters_and_access_log.js';
export { version as v4Version, description as v4Description, up as v4Up } from './004_vector_tables.js';

import * as m1 from './001_initial_schema.js';
import * as m2 from './002_relations_and_links.js';
import * as m3 from './003_clusters_and_access_log.js';
import * as m4 from './004_vector_tables.js';

export const migrations: Migration[] = [
  { version: m1.version, description: m1.description, up: m1.up },
  { version: m2.version, description: m2.description, up: m2.up },
  { version: m3.version, description: m3.description, up: m3.up },
  { version: m4.version, description: m4.description, up: m4.up },
];
