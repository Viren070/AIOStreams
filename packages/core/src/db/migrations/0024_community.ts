import type { Migration } from './types.js';

/**
 * Community-shared formatters and templates, their likes, and the upload
 * block list. Identities are keyed hashes; no raw uuid or IP is stored.
 */
export const community: Migration = {
  id: 24,
  name: 'community',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS community_items (
        id                     TEXT PRIMARY KEY,
        kind                   TEXT NOT NULL,
        status                 TEXT NOT NULL,
        owner_hash             TEXT NOT NULL,
        ip_hash                TEXT NOT NULL,
        name                   TEXT NOT NULL,
        description            TEXT NOT NULL DEFAULT '',
        author                 TEXT NOT NULL DEFAULT '',
        version                TEXT NOT NULL DEFAULT '1.0.0',
        tags                   TEXT NOT NULL DEFAULT '[]',
        payload                TEXT NOT NULL,
        review_summary         TEXT,
        draft                  TEXT,
        draft_rejection_reason TEXT,
        trusted                INTEGER NOT NULL DEFAULT 0,
        likes                  INTEGER NOT NULL DEFAULT 0,
        rejection_reason       TEXT,
        created_at             INTEGER NOT NULL,
        updated_at             INTEGER NOT NULL,
        reviewed_at            INTEGER,
        CHECK (kind IN ('formatter', 'template')),
        CHECK (status IN ('pending', 'approved', 'rejected')),
        CHECK (trusted IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS idx_community_items_kind_status
        ON community_items (kind, status, likes);
      CREATE INDEX IF NOT EXISTS idx_community_items_owner
        ON community_items (owner_hash, created_at);

      CREATE TABLE IF NOT EXISTS community_likes (
        item_id    TEXT NOT NULL REFERENCES community_items(id) ON DELETE CASCADE,
        owner_hash TEXT NOT NULL,
        ip_hash    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (item_id, owner_hash),
        UNIQUE (item_id, ip_hash)
      );

      CREATE TABLE IF NOT EXISTS community_blocks (
        hash       TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        reason     TEXT,
        created_at INTEGER NOT NULL,
        CHECK (kind IN ('owner', 'ip'))
      );
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS community_items (
        id                     TEXT PRIMARY KEY,
        kind                   TEXT NOT NULL,
        status                 TEXT NOT NULL,
        owner_hash             TEXT NOT NULL,
        ip_hash                TEXT NOT NULL,
        name                   TEXT NOT NULL,
        description            TEXT NOT NULL DEFAULT '',
        author                 TEXT NOT NULL DEFAULT '',
        version                TEXT NOT NULL DEFAULT '1.0.0',
        tags                   TEXT NOT NULL DEFAULT '[]',
        payload                TEXT NOT NULL,
        review_summary         TEXT,
        draft                  TEXT,
        draft_rejection_reason TEXT,
        trusted                SMALLINT NOT NULL DEFAULT 0,
        likes                  INTEGER NOT NULL DEFAULT 0,
        rejection_reason       TEXT,
        created_at             BIGINT NOT NULL,
        updated_at             BIGINT NOT NULL,
        reviewed_at            BIGINT,
        CHECK (kind IN ('formatter', 'template')),
        CHECK (status IN ('pending', 'approved', 'rejected')),
        CHECK (trusted IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS idx_community_items_kind_status
        ON community_items (kind, status, likes);
      CREATE INDEX IF NOT EXISTS idx_community_items_owner
        ON community_items (owner_hash, created_at);

      CREATE TABLE IF NOT EXISTS community_likes (
        item_id    TEXT NOT NULL REFERENCES community_items(id) ON DELETE CASCADE,
        owner_hash TEXT NOT NULL,
        ip_hash    TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (item_id, owner_hash),
        UNIQUE (item_id, ip_hash)
      );

      CREATE TABLE IF NOT EXISTS community_blocks (
        hash       TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        reason     TEXT,
        created_at BIGINT NOT NULL,
        CHECK (kind IN ('owner', 'ip'))
      );
    `,
  },
};
