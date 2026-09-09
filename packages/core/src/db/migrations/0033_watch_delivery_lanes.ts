import type { Migration } from './types.js';

const columns = (ine: string) => `
      ALTER TABLE watch_deliveries ADD COLUMN ${ine}priority INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE watch_deliveries ADD COLUMN ${ine}covers TEXT;
`;

const indexes = `
      CREATE INDEX IF NOT EXISTS idx_watch_deliveries_sink_lane
        ON watch_deliveries (sink_id, status, priority, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_watch_deliveries_sink_item
        ON watch_deliveries (sink_id, item_key, status);
`;

export const watchDeliveryLanes: Migration = {
  id: 33,
  name: 'watch_delivery_lanes',
  up: {
    sqlite: `${columns('')}${indexes}`,
    postgres: `${columns('IF NOT EXISTS ')}${indexes}`,
  },
};
