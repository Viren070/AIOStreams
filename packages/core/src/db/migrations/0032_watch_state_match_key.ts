import type { Migration } from './types.js';

/** Rows written before this have no match key and are found by their own key. */
const columns = (ine: string) => `
      ALTER TABLE watch_state ADD COLUMN ${ine}match_key TEXT;
`;

const indexes = `
      CREATE INDEX IF NOT EXISTS idx_watch_state_match
        ON watch_state (uuid, persona, match_key);
`;

export const watchStateMatchKey: Migration = {
  id: 32,
  name: 'watch_state_match_key',
  up: {
    sqlite: `${columns('')}${indexes}`,
    postgres: `${columns('IF NOT EXISTS ')}${indexes}`,
  },
};
