import type { Migration } from './types.js';

/**
 * The merged canonical anime store, previously held entirely in memory.
 *
 * `anime_records` holds one row per canonical record; `anime_ids` is the
 * lookup index that every request probes; `anime_synonyms` holds the
 * alternative titles. `anime_build` is a single row recording which source
 * revisions the store was built from, so a boot whose sources are unchanged
 * can skip parsing altogether.
 *
 * `anime_synonyms.ord` preserves the order the merger produced. Synonyms are
 * returned to callers as-is and `getSeasonFromSynonyms` takes the first match.
 */
export const animeDatabase: Migration = {
  id: 20,
  name: 'anime_database',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS anime_records (
        rid INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        ids TEXT NOT NULL,
        title TEXT,
        season TEXT,
        year INTEGER,
        imdb TEXT,
        tvdb TEXT,
        tmdb TEXT,
        trakt TEXT,
        fanart TEXT
      );

      CREATE TABLE IF NOT EXISTS anime_ids (
        id_type TEXT NOT NULL,
        id_value TEXT NOT NULL,
        rid INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS anime_synonyms (
        rid INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        synonym TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS anime_build (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fingerprint TEXT NOT NULL,
        built_at INTEGER NOT NULL,
        records INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_anime_ids
        ON anime_ids (id_type, id_value);
      CREATE INDEX IF NOT EXISTS idx_anime_synonyms
        ON anime_synonyms (rid, ord);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS anime_records (
        rid INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        ids TEXT NOT NULL,
        title TEXT,
        season TEXT,
        year INTEGER,
        imdb TEXT,
        tvdb TEXT,
        tmdb TEXT,
        trakt TEXT,
        fanart TEXT
      );

      CREATE TABLE IF NOT EXISTS anime_ids (
        id_type TEXT NOT NULL,
        id_value TEXT NOT NULL,
        rid INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS anime_synonyms (
        rid INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        synonym TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS anime_build (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fingerprint TEXT NOT NULL,
        built_at BIGINT NOT NULL,
        records INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_anime_ids
        ON anime_ids (id_type, id_value);
      CREATE INDEX IF NOT EXISTS idx_anime_synonyms
        ON anime_synonyms (rid, ord);
    `,
  },
};
