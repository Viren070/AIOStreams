import type { Migration } from './types.js';

const ddl = (big: string) => `
      CREATE TABLE IF NOT EXISTS watch_air_times (
        uuid       TEXT NOT NULL,
        persona    TEXT NOT NULL DEFAULT '',
        item_key   TEXT NOT NULL,
        sink_id    TEXT NOT NULL REFERENCES watch_sinks(id) ON DELETE CASCADE,
        match_key  TEXT,
        series_key TEXT NOT NULL,
        media_type TEXT NOT NULL,
        airs_at    ${big} NOT NULL,
        PRIMARY KEY (uuid, persona, item_key, sink_id)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_air_times_match
        ON watch_air_times (uuid, persona, match_key);

      CREATE INDEX IF NOT EXISTS idx_watch_air_times_sink
        ON watch_air_times (sink_id);
`;

export const watchAirTimes: Migration = {
  id: 42,
  name: 'watch_air_times',
  up: { sqlite: ddl('INTEGER'), postgres: ddl('BIGINT') },
};
