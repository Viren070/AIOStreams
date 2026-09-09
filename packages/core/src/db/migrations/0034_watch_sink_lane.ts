import type { Migration } from './types.js';

const columns = (ine: string) => `
      ALTER TABLE watch_sinks ADD COLUMN ${ine}delivery_lane INTEGER NOT NULL DEFAULT 0;
`;

const indexes = `
      CREATE INDEX IF NOT EXISTS idx_watch_sinks_delivery_lane
        ON watch_sinks (delivery_lane, next_delivery_at);
`;

export const watchSinkLane: Migration = {
  id: 34,
  name: 'watch_sink_lane',
  up: {
    sqlite: `${columns('')}${indexes}`,
    postgres: `${columns('IF NOT EXISTS ')}${indexes}`,
  },
};
