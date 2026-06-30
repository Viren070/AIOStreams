import type { Migration } from './types.js';

/**
 * Screener: aiostreams' community-shareable filter of bad releases. Two tables,
 * both instance-global (one shared store per instance; per-user toggles live in
 * UserData):
 *
 *   screener_sources  configured lists a verdict can come from. Always seeded
 *                     with the 'local' source, which auto-fills from this
 *                     instance's own playback failures / STAT dead-aborts.
 *                     Remote sources are URL subscriptions; imported sources are
 *                     one-off file imports. trust = full | corroborate | observe.
 *
 *   screener_entries  one verdict per (source, release key). `k` is a
 *                     self-describing release key (`btih:<hash>` for torrents,
 *                     `wd1:<fingerprint>` for usenet, the latter
 *                     wire-compatible with nzbdavex). `kind` is derived from the
 *                     prefix so usenet entries can be exported in davex format
 *                     and torrent/usenet filtering can be scoped independently.
 *
 * Unix-second columns use sqlite INTEGER (64-bit) / postgres BIGINT to stay
 * 2038-safe.
 */
export const screener: Migration = {
  id: 12,
  name: 'screener',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS screener_sources (
        id            TEXT PRIMARY KEY,
        kind          TEXT NOT NULL,
        name          TEXT NOT NULL,
        url           TEXT,
        enabled       INTEGER NOT NULL DEFAULT 1,
        trust         TEXT NOT NULL DEFAULT 'corroborate',
        refresh_hours INTEGER NOT NULL DEFAULT 24,
        last_checked  INTEGER NOT NULL DEFAULT 0,
        last_updated  INTEGER NOT NULL DEFAULT 0,
        etag          TEXT,
        status        TEXT,
        sort          INTEGER NOT NULL DEFAULT 0,
        CHECK (kind IN ('local', 'remote', 'imported')),
        CHECK (enabled IN (0, 1)),
        CHECK (trust IN ('full', 'corroborate', 'observe')),
        CHECK (refresh_hours > 0),
        CHECK (kind <> 'remote' OR (url IS NOT NULL AND url <> ''))
      );

      CREATE TABLE IF NOT EXISTS screener_entries (
        source_id TEXT NOT NULL REFERENCES screener_sources(id) ON DELETE CASCADE,
        k         TEXT NOT NULL,
        kind      TEXT NOT NULL,
        verdict   TEXT NOT NULL,
        n         INTEGER NOT NULL DEFAULT 1,
        last_at   INTEGER NOT NULL DEFAULT 0,
        backbones TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (source_id, k),
        CHECK ((kind = 'torrent' AND k LIKE 'btih:%') OR (kind = 'usenet' AND k LIKE 'wd1:%')),
        CHECK (verdict IN ('dead', 'fake', 'mislabeled')),
        CHECK (n >= 0),
        CHECK (last_at >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_screener_entries_k
        ON screener_entries (k);

      INSERT OR IGNORE INTO screener_sources
        (id, kind, name, url, enabled, trust, refresh_hours)
        VALUES ('local', 'local', 'This instance', NULL, 1, 'full', 24);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS screener_sources (
        id            TEXT PRIMARY KEY,
        kind          TEXT NOT NULL,
        name          TEXT NOT NULL,
        url           TEXT,
        enabled       INTEGER NOT NULL DEFAULT 1,
        trust         TEXT NOT NULL DEFAULT 'corroborate',
        refresh_hours INTEGER NOT NULL DEFAULT 24,
        last_checked  BIGINT NOT NULL DEFAULT 0,
        last_updated  BIGINT NOT NULL DEFAULT 0,
        etag          TEXT,
        status        TEXT,
        sort          INTEGER NOT NULL DEFAULT 0,
        CHECK (kind IN ('local', 'remote', 'imported')),
        CHECK (enabled IN (0, 1)),
        CHECK (trust IN ('full', 'corroborate', 'observe')),
        CHECK (refresh_hours > 0),
        CHECK (kind <> 'remote' OR (url IS NOT NULL AND url <> ''))
      );

      CREATE TABLE IF NOT EXISTS screener_entries (
        source_id TEXT NOT NULL REFERENCES screener_sources(id) ON DELETE CASCADE,
        k         TEXT NOT NULL,
        kind      TEXT NOT NULL,
        verdict   TEXT NOT NULL,
        n         BIGINT NOT NULL DEFAULT 1,
        last_at   BIGINT NOT NULL DEFAULT 0,
        backbones TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (source_id, k),
        CHECK ((kind = 'torrent' AND k LIKE 'btih:%') OR (kind = 'usenet' AND k LIKE 'wd1:%')),
        CHECK (verdict IN ('dead', 'fake', 'mislabeled')),
        CHECK (n >= 0),
        CHECK (last_at >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_screener_entries_k
        ON screener_entries (k);

      INSERT INTO screener_sources
        (id, kind, name, url, enabled, trust, refresh_hours)
        VALUES ('local', 'local', 'This instance', NULL, 1, 'full', 24)
        ON CONFLICT (id) DO NOTHING;
    `,
  },
};
