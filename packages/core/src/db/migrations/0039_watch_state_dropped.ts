import type { Migration } from './types.js';

const columns = (big: string, ine: string) => `
      ALTER TABLE watch_state ADD COLUMN ${ine}dropped INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE watch_state ADD COLUMN ${ine}dropped_sink_id TEXT;
      ALTER TABLE watch_state ADD COLUMN ${ine}dropped_at ${big};
      ALTER TABLE watch_state ADD COLUMN ${ine}dropped_seen_at ${big};
`;

const indexes = `
      CREATE INDEX IF NOT EXISTS idx_watch_state_dropped_sink
        ON watch_state (uuid, persona, dropped_sink_id);
`;

export const watchStateDropped: Migration = {
  id: 39,
  name: 'watch_state_dropped',
  up: {
    sqlite: `${columns('INTEGER', '')}${indexes}`,
    postgres: `${columns('BIGINT', 'IF NOT EXISTS ')}${indexes}`,
  },
};
