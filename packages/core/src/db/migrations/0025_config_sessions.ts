import type { Migration } from './types.js';

/**
 * Remembered sign-ins to a configuration, one row per browser.
 *
 * `id` is a hash of the cookie's token, never the token. `password_hash` is a
 * snapshot taken at issuance, so a changed password stops the row resolving.
 */
export const configSessions: Migration = {
  id: 25,
  name: 'config_sessions',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS config_sessions (
        id                 TEXT PRIMARY KEY,
        uuid               TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        encrypted_password TEXT NOT NULL,
        password_hash      TEXT NOT NULL,
        remembered         INTEGER NOT NULL DEFAULT 0,
        created_at         INTEGER NOT NULL,
        last_used_at       INTEGER,
        expires_at         INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_config_sessions_uuid
        ON config_sessions (uuid);

      CREATE INDEX IF NOT EXISTS idx_config_sessions_expires
        ON config_sessions (expires_at);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS config_sessions (
        id                 TEXT PRIMARY KEY,
        uuid               TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        encrypted_password TEXT NOT NULL,
        password_hash      TEXT NOT NULL,
        remembered         SMALLINT NOT NULL DEFAULT 0,
        created_at         BIGINT NOT NULL,
        last_used_at       BIGINT,
        expires_at         BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_config_sessions_uuid
        ON config_sessions (uuid);

      CREATE INDEX IF NOT EXISTS idx_config_sessions_expires
        ON config_sessions (expires_at);
    `,
  },
};
