import type { Migration } from './types.js';

/** Idempotency ledger for quota reservations shared by all Usenet services. */
export const torrentclawNzbReservations: Migration = {
  id: 900004,
  name: 'torrentclaw_nzb_reservations',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS torrentclaw_nzb_reservations (
        period TEXT NOT NULL,
        reservation_key TEXT NOT NULL,
        reserved_bytes INTEGER NOT NULL DEFAULT 0,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (period, reservation_key)
      );
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS torrentclaw_nzb_reservations (
        period TEXT NOT NULL,
        reservation_key TEXT NOT NULL,
        reserved_bytes BIGINT NOT NULL DEFAULT 0,
        updated_at_ms BIGINT NOT NULL,
        PRIMARY KEY (period, reservation_key)
      );
    `,
  },
};
