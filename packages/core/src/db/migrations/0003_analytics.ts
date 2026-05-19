import type { Migration } from './types.js';

export const analytics: Migration = {
  id: 3,
  name: 'analytics',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts BIGINT NOT NULL,
        event_type TEXT NOT NULL,
        resource TEXT,
        uuid_hash TEXT,
        addon_id TEXT,
        addon_instance_hash TEXT,
        preset_id TEXT,
        url_overridden INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        error_stage TEXT,
        error_kind TEXT,
        latency_ms INTEGER,
        result_count INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_events_ts ON analytics_events (ts);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_preset_ts ON analytics_events (preset_id, ts);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_uuid_ts ON analytics_events (uuid_hash, ts);

      CREATE TABLE IF NOT EXISTS analytics_daily (
        day TEXT NOT NULL,
        dimension TEXT NOT NULL,
        key TEXT NOT NULL,
        count BIGINT NOT NULL DEFAULT 0,
        latency_sum BIGINT NOT NULL DEFAULT 0,
        latency_count BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (day, dimension, key)
      );
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        ts BIGINT NOT NULL,
        event_type TEXT NOT NULL,
        resource TEXT,
        uuid_hash TEXT,
        addon_id TEXT,
        addon_instance_hash TEXT,
        preset_id TEXT,
        url_overridden BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT,
        error_stage TEXT,
        error_kind TEXT,
        latency_ms INTEGER,
        result_count INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_events_ts ON analytics_events (ts);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_preset_ts ON analytics_events (preset_id, ts);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_uuid_ts ON analytics_events (uuid_hash, ts);

      CREATE TABLE IF NOT EXISTS analytics_daily (
        day TEXT NOT NULL,
        dimension TEXT NOT NULL,
        key TEXT NOT NULL,
        count BIGINT NOT NULL DEFAULT 0,
        latency_sum BIGINT NOT NULL DEFAULT 0,
        latency_count BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (day, dimension, key)
      );
    `,
  },
};
