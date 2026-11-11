import type { Migration } from './types.js';

/**
 * Hourly per-indexer usenet playback attempts, across all usenet services.
 *
 *   attempt         'first' (clicked stream) | 'failover'
 *   age_bucket      'day' | 'week' | 'month' | 'year' | 'older' | 'unknown'
 *   ok              resolved to a playable URL
 *   failed          could not be resolved, incl. timeouts (account errors
 *                   aren't recorded)
 *   rescues         subset of ok: failovers that played after an earlier
 *                   attempt failed
 */
export const usenetIndexerAttempts: Migration = {
  id: 51,
  name: 'usenet_indexer_attempts',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS usenet_indexer_attempts (
        hour_ms INTEGER NOT NULL,
        indexer TEXT NOT NULL,
        attempt TEXT NOT NULL,
        age_bucket TEXT NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        rescues INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_ms, indexer, attempt, age_bucket)
      );
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS usenet_indexer_attempts (
        hour_ms BIGINT NOT NULL,
        indexer TEXT NOT NULL,
        attempt TEXT NOT NULL,
        age_bucket TEXT NOT NULL,
        ok BIGINT NOT NULL DEFAULT 0,
        failed BIGINT NOT NULL DEFAULT 0,
        rescues BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_ms, indexer, attempt, age_bucket)
      );
    `,
  },
};
