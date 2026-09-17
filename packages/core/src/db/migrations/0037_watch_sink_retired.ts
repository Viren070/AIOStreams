import type { Migration } from './types.js';

const columns = (big: string, ine: string) => `
      ALTER TABLE watch_sinks ADD COLUMN ${ine}retired_at ${big};
`;

export const watchSinkRetired: Migration = {
  id: 37,
  name: 'watch_sink_retired',
  up: {
    sqlite: columns('INTEGER', ''),
    postgres: columns('BIGINT', 'IF NOT EXISTS '),
  },
};
