import type { Migration } from './types.js';

/**
 * Hourly per-provider performance rollups for the native usenet engine. One row
 * per (hour, provider) accumulates the engine's drained deltas so the dashboard
 * can chart provider performance over time (24h / 7d / 30d / all). We
 * deliberately store rollups only — never raw per-segment fetch events — to keep
 * the table small. Derived metrics (avg latency, error rate, article share) are
 * computed at query time from these columns.
 *
 *   articles        successful BODY/ARTICLE fetches
 *   bytes_fetched   decoded bytes downloaded
 *   errors          transient/connection errors
 *   missing         article-not-found responses (availability signal)
 *   sum_duration_ms sum of successful fetch durations (avg = /articles)
 */
export const usenetMetrics: Migration = {
  id: 8,
  name: 'usenet_metrics',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS usenet_provider_metrics (
        hour_ms INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        articles INTEGER NOT NULL DEFAULT 0,
        bytes_fetched INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        missing INTEGER NOT NULL DEFAULT 0,
        sum_duration_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_ms, provider_id)
      );

      CREATE INDEX IF NOT EXISTS idx_usenet_metrics_hour
        ON usenet_provider_metrics (hour_ms);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS usenet_provider_metrics (
        hour_ms BIGINT NOT NULL,
        provider_id TEXT NOT NULL,
        articles BIGINT NOT NULL DEFAULT 0,
        bytes_fetched BIGINT NOT NULL DEFAULT 0,
        errors BIGINT NOT NULL DEFAULT 0,
        missing BIGINT NOT NULL DEFAULT 0,
        sum_duration_ms BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_ms, provider_id)
      );

      CREATE INDEX IF NOT EXISTS idx_usenet_metrics_hour
        ON usenet_provider_metrics (hour_ms);
    `,
  },
};
