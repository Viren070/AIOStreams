import type { Migration } from './types.js';

/**
 * Release blocklist publish targets: outbound destinations (GitHub gist,
 * GitHub repository, generic HTTP PUT/POST) the instance pushes its list
 * to on an interval. `config_enc` is the whole provider config as JSON
 * encrypted with the instance secret (it carries credentials); `artifacts`
 * is the JSON list of format/scope combinations to upload and `state`
 * tracks the per-artifact content hash, published URL and push time.
 * `provider` is deliberately not CHECK-constrained: new providers register
 * in-process and must not require a migration.
 */
export const releaseBlocklistPublish: Migration = {
  id: 14,
  name: 'release_blocklist_publish',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS release_blocklist_publish_targets (
        rid              INTEGER PRIMARY KEY,
        id               TEXT NOT NULL UNIQUE,
        provider         TEXT NOT NULL,
        name             TEXT NOT NULL,
        enabled          INTEGER NOT NULL DEFAULT 1,
        interval_seconds INTEGER NOT NULL DEFAULT 21600,
        config_enc       TEXT NOT NULL,
        artifacts        TEXT NOT NULL DEFAULT '[]',
        state            TEXT NOT NULL DEFAULT '{}',
        last_pushed      INTEGER NOT NULL DEFAULT 0,
        last_checked     INTEGER NOT NULL DEFAULT 0,
        status           TEXT,
        sort             INTEGER NOT NULL DEFAULT 0,
        CHECK (provider <> ''),
        CHECK (enabled IN (0,1)),
        CHECK (interval_seconds >= 900)
      );
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS release_blocklist_publish_targets (
        rid              BIGSERIAL PRIMARY KEY,
        id               TEXT NOT NULL UNIQUE,
        provider         TEXT NOT NULL,
        name             TEXT NOT NULL,
        enabled          INTEGER NOT NULL DEFAULT 1,
        interval_seconds BIGINT NOT NULL DEFAULT 21600,
        config_enc       TEXT NOT NULL,
        artifacts        TEXT NOT NULL DEFAULT '[]',
        state            TEXT NOT NULL DEFAULT '{}',
        last_pushed      BIGINT NOT NULL DEFAULT 0,
        last_checked     BIGINT NOT NULL DEFAULT 0,
        status           TEXT,
        sort             INTEGER NOT NULL DEFAULT 0,
        CHECK (provider <> ''),
        CHECK (enabled IN (0,1)),
        CHECK (interval_seconds >= 900)
      );
    `,
  },
};
