import type { Migration } from './types.js';

/**
 * Store Screener's remote-source refresh interval in seconds rather than
 * hours, so it accepts fine-grained durations (matching the rest of the config).
 * Renames the column and scales existing values in place; `RENAME COLUMN`
 * carries the column's CHECK constraint over on both SQLite (3.25+) and Postgres.
 */
export const screenerRefreshSeconds: Migration = {
  id: 13,
  name: 'screener_refresh_seconds',
  up: {
    sqlite: `
      ALTER TABLE screener_sources RENAME COLUMN refresh_hours TO refresh_seconds;
      UPDATE screener_sources SET refresh_seconds = refresh_seconds * 3600;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_screener_sources_one_local
        ON screener_sources (kind) WHERE kind = 'local';
    `,
    postgres: `
      ALTER TABLE screener_sources RENAME COLUMN refresh_hours TO refresh_seconds;
      UPDATE screener_sources SET refresh_seconds = refresh_seconds * 3600;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_screener_sources_one_local
        ON screener_sources (kind) WHERE kind = 'local';
    `,
  },
};
