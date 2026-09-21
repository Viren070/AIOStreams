import type { Migration } from './types.js';

/**
 * Per-configuration watch state, the live playback sessions behind it, and the
 * two tables the Jellyfin-compatible API needs: hashed item ids that cannot be
 * rebuilt from their Stremio id, and client display preferences.
 *
 * `item_key` is `m|{baseId}`, `s|{baseId}` or `e|{videoId}`; see `itemKeyFor`.
 * `persona` is `''` for the account. NOT NULL, or the composite keys never
 * conflict in SQLite and every upsert inserts a duplicate. Times are epoch ms.
 */
export const WATCH_STATE_DDL = {
  sqlite: `
      CREATE TABLE IF NOT EXISTS watch_state (
        uuid            TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona         TEXT NOT NULL DEFAULT '',
        item_key        TEXT NOT NULL,
        kind            TEXT NOT NULL,
        media_type      TEXT NOT NULL,
        base_id         TEXT NOT NULL,
        season          INTEGER,
        episode         INTEGER,
        video_id        TEXT,
        series_key      TEXT,
        position_ms     INTEGER NOT NULL DEFAULT 0,
        duration_ms     INTEGER NOT NULL DEFAULT 0,
        played          INTEGER NOT NULL DEFAULT 0,
        play_count      INTEGER NOT NULL DEFAULT 0,
        favorite        INTEGER NOT NULL DEFAULT 0,
        last_played_at  INTEGER,
        updated_at      INTEGER NOT NULL DEFAULT 0,
        origin          TEXT NOT NULL DEFAULT 'local',
        sink_id         TEXT,
        external_at     INTEGER,
        snapshot        TEXT,
        PRIMARY KEY (uuid, persona, item_key)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_state_uuid_updated
        ON watch_state (uuid, persona, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_watch_state_uuid_series
        ON watch_state (uuid, persona, series_key);

      CREATE TABLE IF NOT EXISTS watch_sessions (
        uuid             TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona          TEXT NOT NULL DEFAULT '',
        session_key      TEXT NOT NULL,
        item_key         TEXT NOT NULL,
        kind             TEXT NOT NULL,
        media_type       TEXT NOT NULL,
        base_id          TEXT NOT NULL,
        season           INTEGER,
        episode          INTEGER,
        video_id         TEXT,
        play_session_id  TEXT,
        device_id        TEXT,
        client           TEXT,
        position_ms      INTEGER NOT NULL DEFAULT 0,
        duration_ms      INTEGER NOT NULL DEFAULT 0,
        paused           INTEGER NOT NULL DEFAULT 0,
        started_at       INTEGER NOT NULL DEFAULT 0,
        last_checkin_at  INTEGER NOT NULL DEFAULT 0,
        ended_at         INTEGER,
        PRIMARY KEY (uuid, persona, session_key)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_sessions_open
        ON watch_sessions (ended_at, last_checkin_at);

      CREATE TABLE IF NOT EXISTS jellyfin_id_map (
        id        TEXT PRIMARY KEY,
        payload   TEXT NOT NULL,
        seen_at   INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_jellyfin_id_map_seen
        ON jellyfin_id_map (seen_at);

      CREATE TABLE IF NOT EXISTS jellyfin_display_prefs (
        uuid        TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona     TEXT NOT NULL DEFAULT '',
        pref_id     TEXT NOT NULL,
        client      TEXT NOT NULL,
        payload     TEXT NOT NULL,
        updated_at  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (uuid, persona, pref_id, client)
      );
    `,
  postgres: `
      CREATE TABLE IF NOT EXISTS watch_state (
        uuid            TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona         TEXT NOT NULL DEFAULT '',
        item_key        TEXT NOT NULL,
        kind            TEXT NOT NULL,
        media_type      TEXT NOT NULL,
        base_id         TEXT NOT NULL,
        season          INTEGER,
        episode         INTEGER,
        video_id        TEXT,
        series_key      TEXT,
        position_ms     BIGINT NOT NULL DEFAULT 0,
        duration_ms     BIGINT NOT NULL DEFAULT 0,
        played          SMALLINT NOT NULL DEFAULT 0,
        play_count      INTEGER NOT NULL DEFAULT 0,
        favorite        SMALLINT NOT NULL DEFAULT 0,
        last_played_at  BIGINT,
        updated_at      BIGINT NOT NULL DEFAULT 0,
        origin          TEXT NOT NULL DEFAULT 'local',
        sink_id         TEXT,
        external_at     BIGINT,
        snapshot        TEXT,
        PRIMARY KEY (uuid, persona, item_key)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_state_uuid_updated
        ON watch_state (uuid, persona, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_watch_state_uuid_series
        ON watch_state (uuid, persona, series_key);

      CREATE TABLE IF NOT EXISTS watch_sessions (
        uuid             TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona          TEXT NOT NULL DEFAULT '',
        session_key      TEXT NOT NULL,
        item_key         TEXT NOT NULL,
        kind             TEXT NOT NULL,
        media_type       TEXT NOT NULL,
        base_id          TEXT NOT NULL,
        season           INTEGER,
        episode          INTEGER,
        video_id         TEXT,
        play_session_id  TEXT,
        device_id        TEXT,
        client           TEXT,
        position_ms      BIGINT NOT NULL DEFAULT 0,
        duration_ms      BIGINT NOT NULL DEFAULT 0,
        paused           SMALLINT NOT NULL DEFAULT 0,
        started_at       BIGINT NOT NULL DEFAULT 0,
        last_checkin_at  BIGINT NOT NULL DEFAULT 0,
        ended_at         BIGINT,
        PRIMARY KEY (uuid, persona, session_key)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_sessions_open
        ON watch_sessions (ended_at, last_checkin_at);

      CREATE TABLE IF NOT EXISTS jellyfin_id_map (
        id        TEXT PRIMARY KEY,
        payload   TEXT NOT NULL,
        seen_at   BIGINT NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_jellyfin_id_map_seen
        ON jellyfin_id_map (seen_at);

      CREATE TABLE IF NOT EXISTS jellyfin_display_prefs (
        uuid        TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona     TEXT NOT NULL DEFAULT '',
        pref_id     TEXT NOT NULL,
        client      TEXT NOT NULL,
        payload     TEXT NOT NULL,
        updated_at  BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (uuid, persona, pref_id, client)
      );
    `,
} as const;

export const watchState: Migration = {
  id: 28,
  name: 'watch_state',
  up: WATCH_STATE_DDL,
};
