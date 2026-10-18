import type { Migration } from './types.js';

/**
 * Which configuration inherits from which. The link itself lives inside the
 * child's encrypted config, so without this the server cannot find a parent's
 * children. `parent_uuid` has no foreign key: a child may name a parent that
 * was deleted, and the row goes when the child does.
 */
const ddl = `
      CREATE TABLE IF NOT EXISTS config_parents (
        child_uuid  TEXT PRIMARY KEY NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        parent_uuid TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_config_parents_parent
        ON config_parents (parent_uuid);
`;

export const configParents: Migration = {
  id: 48,
  name: 'config_parents',
  up: { sqlite: ddl, postgres: ddl },
};
