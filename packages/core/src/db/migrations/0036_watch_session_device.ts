import type { Migration } from './types.js';

const columns = (ine: string) => `
      ALTER TABLE watch_sessions ADD COLUMN ${ine}device_name TEXT;
      ALTER TABLE watch_sessions ADD COLUMN ${ine}app_version TEXT;
`;

export const watchSessionDevice: Migration = {
  id: 36,
  name: 'watch_session_device',
  up: {
    sqlite: columns(''),
    postgres: columns('IF NOT EXISTS '),
  },
};
