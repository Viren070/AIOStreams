import type { Migration } from './types.js';

export const analyticsUniqueCount: Migration = {
  id: 51,
  name: 'analytics_unique_count',
  up: {
    sqlite: `
      ALTER TABLE analytics_events ADD COLUMN kept_count INTEGER;
      ALTER TABLE analytics_events ADD COLUMN unique_count INTEGER;
    `,
    postgres: `
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS kept_count INTEGER;
      ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS unique_count INTEGER;
    `,
  },
};
