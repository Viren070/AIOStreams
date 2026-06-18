import type { Migration } from './types.js';

/**
 * Add a wall-clock busy-time column to the hourly usenet rollups so the
 * dashboard can show an honest average download speed (per provider + overall).
 *
 * `sum_duration_ms` is the *sum of per-segment fetch durations across parallel
 * connections*, so `bytes / sum_duration_ms` is per-connection speed — much
 * lower than the throughput a user reads as "download speed". `wall_clock_ms`
 * instead records each provider's *union of in-flight fetch intervals* (time
 * with ≥1 article transferring), so `bytes / (wall_clock_ms/1000)` is the
 * provider's real average throughput, independent of connection count.
 */
export const usenetSpeed: Migration = {
  id: 11,
  name: 'usenet_speed',
  up: {
    sqlite: `
      ALTER TABLE usenet_provider_metrics
        ADD COLUMN wall_clock_ms INTEGER NOT NULL DEFAULT 0;
    `,
    postgres: `
      ALTER TABLE usenet_provider_metrics
        ADD COLUMN IF NOT EXISTS wall_clock_ms BIGINT NOT NULL DEFAULT 0;
    `,
  },
};
