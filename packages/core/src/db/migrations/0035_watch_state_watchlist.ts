import type { Migration } from './types.js';

const columns = (big: string, ine: string) => `
      ALTER TABLE watch_state ADD COLUMN ${ine}favorite_sink_id TEXT;
      ALTER TABLE watch_state ADD COLUMN ${ine}favorite_at ${big};
      ALTER TABLE watch_state ADD COLUMN ${ine}favorite_seen_at ${big};
`;

const indexes = `
      CREATE INDEX IF NOT EXISTS idx_watch_state_favorite_sink
        ON watch_state (uuid, persona, favorite_sink_id);
`;

export const watchStateWatchlist: Migration = {
  id: 35,
  name: 'watch_state_watchlist',
  up: {
    sqlite: `${columns('INTEGER', '')}${indexes}`,
    postgres: `${columns('BIGINT', 'IF NOT EXISTS ')}${indexes}`,
  },
};
