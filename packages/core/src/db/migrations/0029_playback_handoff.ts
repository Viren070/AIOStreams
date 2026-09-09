import type { Migration } from './types.js';

/**
 * One row per addon a configuration exchanges watch state with, plus a durable
 * queue of events waiting to leave. A delivery row carries the whole request,
 * because a background worker cannot decrypt a configuration to rebuild it.
 * `pull_version` is the validator the addon last answered with, sent back so it
 * can skip re-reading. A sink is per persona: two personas reaching one addon
 * under different variants may be different tracker accounts. Times are epoch ms.
 */
export const PLAYBACK_HANDOFF_DDL = {
  sqlite: `
      CREATE TABLE IF NOT EXISTS watch_sinks (
        id                TEXT PRIMARY KEY,
        uuid              TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona           TEXT NOT NULL DEFAULT '',
        addon_instance_id TEXT NOT NULL,
        addon_name        TEXT,
        base_url          TEXT NOT NULL,
        pull_url          TEXT,
        query             TEXT,
        events            TEXT,
        types             TEXT,
        id_prefixes       TEXT,
        status            TEXT NOT NULL DEFAULT 'connected',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_push_at      INTEGER,
        last_error        TEXT,
        last_error_kind   TEXT,
        pull_version      TEXT,
        last_pull_at      INTEGER,
        last_pull_error   TEXT,
        created_at        INTEGER NOT NULL DEFAULT 0,
        updated_at        INTEGER NOT NULL DEFAULT 0,
        UNIQUE (uuid, persona, addon_instance_id)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_sinks_uuid
        ON watch_sinks (uuid, persona);

      CREATE INDEX IF NOT EXISTS idx_watch_sinks_pull
        ON watch_sinks (last_pull_at);

      CREATE TABLE IF NOT EXISTS watch_deliveries (
        id              TEXT PRIMARY KEY,
        sink_id         TEXT NOT NULL REFERENCES watch_sinks(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        event           TEXT NOT NULL,
        item_key        TEXT NOT NULL,
        url             TEXT NOT NULL,
        body            TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        created_at      INTEGER NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL DEFAULT 0,
        delivered_at    INTEGER,
        UNIQUE (sink_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_deliveries_due
        ON watch_deliveries (status, next_attempt_at);

      CREATE INDEX IF NOT EXISTS idx_watch_deliveries_sink
        ON watch_deliveries (sink_id, status);
    `,
  postgres: `
      CREATE TABLE IF NOT EXISTS watch_sinks (
        id                TEXT PRIMARY KEY,
        uuid              TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona           TEXT NOT NULL DEFAULT '',
        addon_instance_id TEXT NOT NULL,
        addon_name        TEXT,
        base_url          TEXT NOT NULL,
        pull_url          TEXT,
        query             TEXT,
        events            TEXT,
        types             TEXT,
        id_prefixes       TEXT,
        status            TEXT NOT NULL DEFAULT 'connected',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_push_at      BIGINT,
        last_error        TEXT,
        last_error_kind   TEXT,
        pull_version      TEXT,
        last_pull_at      BIGINT,
        last_pull_error   TEXT,
        created_at        BIGINT NOT NULL DEFAULT 0,
        updated_at        BIGINT NOT NULL DEFAULT 0,
        UNIQUE (uuid, persona, addon_instance_id)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_sinks_uuid
        ON watch_sinks (uuid, persona);

      CREATE INDEX IF NOT EXISTS idx_watch_sinks_pull
        ON watch_sinks (last_pull_at);

      CREATE TABLE IF NOT EXISTS watch_deliveries (
        id              TEXT PRIMARY KEY,
        sink_id         TEXT NOT NULL REFERENCES watch_sinks(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        event           TEXT NOT NULL,
        item_key        TEXT NOT NULL,
        url             TEXT NOT NULL,
        body            TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        next_attempt_at BIGINT NOT NULL DEFAULT 0,
        last_error      TEXT,
        created_at      BIGINT NOT NULL DEFAULT 0,
        updated_at      BIGINT NOT NULL DEFAULT 0,
        delivered_at    BIGINT,
        UNIQUE (sink_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_deliveries_due
        ON watch_deliveries (status, next_attempt_at);

      CREATE INDEX IF NOT EXISTS idx_watch_deliveries_sink
        ON watch_deliveries (sink_id, status);
    `,
} as const;

export const playbackHandoff: Migration = {
  id: 29,
  name: 'playback_handoff',
  up: PLAYBACK_HANDOFF_DDL,
};
