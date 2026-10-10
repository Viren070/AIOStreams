import type { Migration } from './types.js';

/**
 * A separate user's own sign-in address: the code in `/jellyfin/p/<code>`,
 * the configuration it opens and the one user it signs in as.
 */
const ddl = `
      CREATE TABLE IF NOT EXISTS jellyfin_user_addresses (
        code               TEXT PRIMARY KEY,
        uuid               TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona            TEXT NOT NULL,
        encrypted_password TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jellyfin_user_addresses_uuid
        ON jellyfin_user_addresses (uuid);
`;

export const jellyfinUserAddresses: Migration = {
  id: 46,
  name: 'jellyfin_user_addresses',
  up: { sqlite: ddl, postgres: ddl },
};
