import type { Migration } from './types.js';

/**
 * Privacy-safe daily addon performance aggregates. Rows contain only counters
 * and a one-way manifest-instance hash; no media ids, titles, URLs, IPs or
 * credentials are persisted.
 */
export const addonPerformance: Migration = {
  id: 900005,
  name: 'addon_performance',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS addon_performance_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        preset_id TEXT NOT NULL,
        instance_hash TEXT NOT NULL,
        addon_name TEXT NOT NULL DEFAULT '',
        UNIQUE (preset_id, instance_hash)
      );
      CREATE TABLE IF NOT EXISTS addon_performance_daily (
        day TEXT NOT NULL,
        addon_id INTEGER NOT NULL,
        requests BIGINT NOT NULL DEFAULT 0,
        with_results BIGINT NOT NULL DEFAULT 0,
        merged BIGINT NOT NULL DEFAULT 0,
        cut_off BIGINT NOT NULL DEFAULT 0,
        not_started BIGINT NOT NULL DEFAULT 0,
        errors BIGINT NOT NULL DEFAULT 0,
        empty BIGINT NOT NULL DEFAULT 0,
        raw_sum BIGINT NOT NULL DEFAULT 0,
        final_sum BIGINT NOT NULL DEFAULT 0,
        latency_sum BIGINT NOT NULL DEFAULT 0,
        latency_count BIGINT NOT NULL DEFAULT 0,
        sized_streams BIGINT NOT NULL DEFAULT 0,
        size_sum_bytes BIGINT NOT NULL DEFAULT 0,
        max_size_bytes BIGINT NOT NULL DEFAULT 0,
        top_rank_wins BIGINT NOT NULL DEFAULT 0,
        largest_source_wins BIGINT NOT NULL DEFAULT 0,
        cached_streams BIGINT NOT NULL DEFAULT 0,
        uncached_streams BIGINT NOT NULL DEFAULT 0,
        p2p_streams BIGINT NOT NULL DEFAULT 0,
        usenet_streams BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (day, addon_id)
      );
      CREATE INDEX IF NOT EXISTS idx_addon_performance_daily_day
        ON addon_performance_daily (day);
      CREATE INDEX IF NOT EXISTS idx_addon_performance_daily_addon
        ON addon_performance_daily (addon_id, day);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS addon_performance_entities (
        id BIGSERIAL PRIMARY KEY,
        preset_id TEXT NOT NULL,
        instance_hash TEXT NOT NULL,
        addon_name TEXT NOT NULL DEFAULT '',
        UNIQUE (preset_id, instance_hash)
      );
      CREATE TABLE IF NOT EXISTS addon_performance_daily (
        day TEXT NOT NULL,
        addon_id BIGINT NOT NULL,
        requests BIGINT NOT NULL DEFAULT 0,
        with_results BIGINT NOT NULL DEFAULT 0,
        merged BIGINT NOT NULL DEFAULT 0,
        cut_off BIGINT NOT NULL DEFAULT 0,
        not_started BIGINT NOT NULL DEFAULT 0,
        errors BIGINT NOT NULL DEFAULT 0,
        empty BIGINT NOT NULL DEFAULT 0,
        raw_sum BIGINT NOT NULL DEFAULT 0,
        final_sum BIGINT NOT NULL DEFAULT 0,
        latency_sum BIGINT NOT NULL DEFAULT 0,
        latency_count BIGINT NOT NULL DEFAULT 0,
        sized_streams BIGINT NOT NULL DEFAULT 0,
        size_sum_bytes BIGINT NOT NULL DEFAULT 0,
        max_size_bytes BIGINT NOT NULL DEFAULT 0,
        top_rank_wins BIGINT NOT NULL DEFAULT 0,
        largest_source_wins BIGINT NOT NULL DEFAULT 0,
        cached_streams BIGINT NOT NULL DEFAULT 0,
        uncached_streams BIGINT NOT NULL DEFAULT 0,
        p2p_streams BIGINT NOT NULL DEFAULT 0,
        usenet_streams BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (day, addon_id)
      );
      CREATE INDEX IF NOT EXISTS idx_addon_performance_daily_day
        ON addon_performance_daily (day);
      CREATE INDEX IF NOT EXISTS idx_addon_performance_daily_addon
        ON addon_performance_daily (addon_id, day);
    `,
  },
};
