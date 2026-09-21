import type { Migration } from './types.js';

const columns = (ine: string) => `
      ALTER TABLE watch_sessions ADD COLUMN ${ine}user_persona TEXT;
`;

export const watchSessionUser: Migration = {
  id: 38,
  name: 'watch_session_user',
  up: {
    sqlite: columns(''),
    postgres: columns('IF NOT EXISTS '),
  },
};
