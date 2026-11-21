import type { Migration } from './types.js';

/**
 * Unique results: per-user per-addon counts on `addon_contribution` events,
 * and hourly per-indexer usenet search rollups for the dashboard.
 *
 *   searches        requests where the indexer returned results
 *   results         results left after filters
 *   unique_results  subset of results no other indexer returned in the
 *                   same request
 */
export const uniqueResults: Migration = {
  id: 51,
  name: 'unique_results',
  up: {
    sqlite: `
      ALTER TABLE analytics_events ADD COLUMN kept_count INTEGER;
      ALTER TABLE analytics_events ADD COLUMN unique_count INTEGER;
      CREATE TABLE IF NOT EXISTS usenet_indexer_searches (
        hour_ms INTEGER NOT NULL,
        indexer TEXT NOT NULL,
        searches INTEGER NOT NULL DEFAULT 0,
        results INTEGER NOT NULL DEFAULT 0,
        unique_results INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_ms, indexer)
      );
    `,
    postgres: `
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS kept_count INTEGER;
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS unique_count INTEGER;
      CREATE TABLE IF NOT EXISTS usenet_indexer_searches (
        hour_ms BIGINT NOT NULL,
        indexer TEXT NOT NULL,
        searches BIGINT NOT NULL DEFAULT 0,
        results BIGINT NOT NULL DEFAULT 0,
        unique_results BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_ms, indexer)
      );
    `,
  },
};
