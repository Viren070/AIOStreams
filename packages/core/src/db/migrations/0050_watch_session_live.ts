import type { Migration } from './types.js';

export const watchSessionLive: Migration = {
  id: 50,
  name: 'watch_session_live',
  up: {
    sqlite: `ALTER TABLE watch_sessions ADD COLUMN live INTEGER NOT NULL DEFAULT 0;`,
    postgres: `ALTER TABLE watch_sessions ADD COLUMN IF NOT EXISTS live SMALLINT NOT NULL DEFAULT 0;`,
  },
};
