import type { Migration } from './types.js';

export const analyticsV2: Migration = {
  id: 5,
  name: 'analytics_v2',
  up: {
    sqlite: `
      ALTER TABLE analytics_events ADD COLUMN final_count INTEGER;
      ALTER TABLE analytics_events ADD COLUMN disposition TEXT;
      ALTER TABLE analytics_events ADD COLUMN service_breakdown TEXT;
      ALTER TABLE analytics_events ADD COLUMN addon_name TEXT;
      ALTER TABLE analytics_events ADD COLUMN feature_dim TEXT;
      ALTER TABLE analytics_events ADD COLUMN feature_key TEXT;
      CREATE INDEX IF NOT EXISTS idx_analytics_events_uuid_event_ts
        ON analytics_events (uuid_hash, event_type, ts);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_feature_day
        ON analytics_events (event_type, feature_dim, ts);
    `,
    postgres: `
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS final_count INTEGER;
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS disposition TEXT;
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS service_breakdown TEXT;
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS addon_name TEXT;
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS feature_dim TEXT;
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS feature_key TEXT;
      CREATE INDEX IF NOT EXISTS idx_analytics_events_uuid_event_ts
        ON analytics_events (uuid_hash, event_type, ts);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_feature_day
        ON analytics_events (event_type, feature_dim, ts);
    `,
  },
};
