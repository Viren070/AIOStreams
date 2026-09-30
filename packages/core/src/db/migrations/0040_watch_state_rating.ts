import type { Migration } from './types.js';

const columns = (big: string, real: string, ine: string) => `
      ALTER TABLE watch_state ADD COLUMN ${ine}rating ${real};
      ALTER TABLE watch_state ADD COLUMN ${ine}rating_sink_id TEXT;
      ALTER TABLE watch_state ADD COLUMN ${ine}rating_at ${big};
      ALTER TABLE watch_state ADD COLUMN ${ine}rating_seen_at ${big};
      ALTER TABLE watch_state ADD COLUMN ${ine}likes INTEGER;
`;

const indexes = `
      CREATE INDEX IF NOT EXISTS idx_watch_state_rating_sink
        ON watch_state (uuid, persona, rating_sink_id);
`;

export const watchStateRating: Migration = {
  id: 40,
  name: 'watch_state_rating',
  up: {
    sqlite: `${columns('INTEGER', 'REAL', '')}${indexes}`,
    postgres: `${columns('BIGINT', 'DOUBLE PRECISION', 'IF NOT EXISTS ')}${indexes}`,
  },
};
