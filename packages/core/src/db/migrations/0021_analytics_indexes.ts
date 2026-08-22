import type { Migration } from './types.js';

/**
 * Three of the five `analytics_events` secondary indexes were unreachable or
 * redundant.
 *
 * `feature_day` (event_type, feature_dim, ts) puts a column the rollup only
 * tests for NULL between the equality and the range, so the `ts` bound is
 * unreachable and both planners fall back to `idx_analytics_events_ts`.
 *
 * `preset_ts` leads on a column no query constrains by equality.
 *
 * The two `uuid_hash` indexes merge into one. `ts` has to stay ahead of
 * `event_type` there, or the per-user range seek is lost.
 */
export const analyticsIndexes: Migration = {
  id: 21,
  name: 'analytics_indexes',
  up: {
    sqlite: `
      DROP INDEX IF EXISTS idx_analytics_events_feature_day;
      DROP INDEX IF EXISTS idx_analytics_events_preset_ts;

      CREATE INDEX IF NOT EXISTS idx_analytics_events_uuid_ts_event
        ON analytics_events (uuid_hash, ts, event_type);
      DROP INDEX IF EXISTS idx_analytics_events_uuid_event_ts;
      DROP INDEX IF EXISTS idx_analytics_events_uuid_ts;
    `,
    postgres: `
      DROP INDEX IF EXISTS idx_analytics_events_feature_day;
      DROP INDEX IF EXISTS idx_analytics_events_preset_ts;

      CREATE INDEX IF NOT EXISTS idx_analytics_events_uuid_ts_event
        ON analytics_events (uuid_hash, ts, event_type);
      DROP INDEX IF EXISTS idx_analytics_events_uuid_event_ts;
      DROP INDEX IF EXISTS idx_analytics_events_uuid_ts;
    `,
  },
};
