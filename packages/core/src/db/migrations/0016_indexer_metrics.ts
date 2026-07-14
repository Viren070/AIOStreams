import type { Migration } from './types.js';

/**
 * Hourly per-indexer rollups. One row per (hour, indexer instance) accumulates
 * search/result/error counts and a latency sum so the dashboard can show how
 * each configured indexer performs. `instance_id` is the addon preset id
 * (stable per configured indexer); `name` holds the latest display name.
 */
export const indexerMetrics: Migration = {
  id: 16,
  name: 'indexer_metrics',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS indexer_metrics (
        hour_ms INTEGER NOT NULL,
        instance_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        searches INTEGER NOT NULL DEFAULT 0,
        results INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        latency_ms_sum INTEGER NOT NULL DEFAULT 0,
        latency_samples INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_ms, instance_id)
      );

      CREATE INDEX IF NOT EXISTS idx_indexer_metrics_instance
        ON indexer_metrics (instance_id, hour_ms);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS indexer_metrics (
        hour_ms BIGINT NOT NULL,
        instance_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        searches BIGINT NOT NULL DEFAULT 0,
        results BIGINT NOT NULL DEFAULT 0,
        errors BIGINT NOT NULL DEFAULT 0,
        latency_ms_sum BIGINT NOT NULL DEFAULT 0,
        latency_samples BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_ms, instance_id)
      );

      CREATE INDEX IF NOT EXISTS idx_indexer_metrics_instance
        ON indexer_metrics (instance_id, hour_ms);
    `,
  },
};
