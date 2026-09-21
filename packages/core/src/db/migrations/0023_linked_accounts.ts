import type { Migration } from './types.js';

/**
 * Destinations a user pushes their manifest URL to.
 */
export const linkedAccounts: Migration = {
  id: 23,
  name: 'linked_accounts',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS linked_accounts (
        id             TEXT PRIMARY KEY,
        uuid           TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        platform       TEXT NOT NULL,
        label          TEXT NOT NULL,
        identity       TEXT,
        credentials    TEXT NOT NULL,
        config         TEXT NOT NULL DEFAULT '{}',
        auto_push      INTEGER NOT NULL DEFAULT 1,
        last_synced_at INTEGER,
        last_pushed_manifest_hash TEXT,
        last_status    TEXT,
        last_error     TEXT,
        created_at     INTEGER NOT NULL DEFAULT 0,
        updated_at     INTEGER NOT NULL DEFAULT 0,
        CHECK (platform IN ('stremio', 'aiomanager')),
        CHECK (length(label) BETWEEN 1 AND 64 AND trim(label) = label)
      );

      CREATE INDEX IF NOT EXISTS idx_linked_accounts_uuid
        ON linked_accounts (uuid);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS linked_accounts (
        id             TEXT PRIMARY KEY,
        uuid           TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        platform       TEXT NOT NULL,
        label          TEXT NOT NULL,
        identity       TEXT,
        credentials    TEXT NOT NULL,
        config         TEXT NOT NULL DEFAULT '{}',
        auto_push      SMALLINT NOT NULL DEFAULT 1,
        last_synced_at BIGINT,
        last_pushed_manifest_hash TEXT,
        last_status    TEXT,
        last_error     TEXT,
        created_at     BIGINT NOT NULL DEFAULT 0,
        updated_at     BIGINT NOT NULL DEFAULT 0,
        CHECK (platform IN ('stremio', 'aiomanager')),
        CHECK (length(label) BETWEEN 1 AND 64 AND trim(label) = label)
      );

      CREATE INDEX IF NOT EXISTS idx_linked_accounts_uuid
        ON linked_accounts (uuid);
    `,
  },
};
