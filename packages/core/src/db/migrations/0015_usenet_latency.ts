import type { Migration } from './types.js';

/**
 * Add server-response-time columns to the hourly usenet rollups so the dashboard
 * can show real provider latency.
 */
export const usenetLatency: Migration = {
  id: 15,
  name: 'usenet_latency',
  up: {
    sqlite: `
      ALTER TABLE usenet_provider_metrics
        ADD COLUMN sum_ttfb_ms INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE usenet_provider_metrics
        ADD COLUMN ttfb_samples INTEGER NOT NULL DEFAULT 0;
    `,
    postgres: `
      ALTER TABLE usenet_provider_metrics
        ADD COLUMN IF NOT EXISTS sum_ttfb_ms BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE usenet_provider_metrics
        ADD COLUMN IF NOT EXISTS ttfb_samples BIGINT NOT NULL DEFAULT 0;
    `,
  },
};
