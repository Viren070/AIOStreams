import type { Migration } from './types.js';

const sql = `
      DROP INDEX IF EXISTS idx_users_accessed_at;
      DROP INDEX IF EXISTS idx_task_runs_at;
      DROP INDEX IF EXISTS idx_watch_state_uuid_updated;
      DROP INDEX IF EXISTS idx_watch_sessions_open;
      DROP INDEX IF EXISTS idx_watch_deliveries_sink;
      DROP INDEX IF EXISTS idx_watch_state_import_sweep;
      CREATE INDEX IF NOT EXISTS idx_watch_state_import_sweep
        ON watch_state (uuid, persona, sink_id, played);
      DROP INDEX IF EXISTS idx_watch_state_favorite_sink;
      CREATE INDEX IF NOT EXISTS idx_watch_state_favorite_sink
        ON watch_state (uuid, persona, favorite_sink_id)
        WHERE favorite_sink_id IS NOT NULL;
      DROP INDEX IF EXISTS idx_watch_state_dropped_sink;
      CREATE INDEX IF NOT EXISTS idx_watch_state_dropped_sink
        ON watch_state (uuid, persona, dropped_sink_id)
        WHERE dropped_sink_id IS NOT NULL;
      DROP INDEX IF EXISTS idx_watch_state_rating_sink;
      CREATE INDEX IF NOT EXISTS idx_watch_state_rating_sink
        ON watch_state (uuid, persona, rating_sink_id)
        WHERE rating_sink_id IS NOT NULL;
`;

export const indexTrim: Migration = {
  id: 41,
  name: 'index_trim',
  up: { sqlite: sql, postgres: sql },
};
