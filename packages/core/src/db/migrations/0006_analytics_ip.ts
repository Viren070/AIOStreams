import type { Migration } from './types.js';

export const analyticsIp: Migration = {
  id: 6,
  name: 'analytics_ip',
  up: {
    sqlite: `
      ALTER TABLE analytics_events ADD COLUMN ip_prefix TEXT;
    `,
    postgres: `
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS ip_prefix TEXT;
    `,
  },
};
