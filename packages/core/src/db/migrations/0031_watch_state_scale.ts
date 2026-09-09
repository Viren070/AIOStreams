import type { Migration } from './types.js';

/**
 * Turns both watch-state background jobs from global scans into index lookups,
 * so they can run on every replica instead of one.
 *
 * The scheduling columns are due pointers: `next_delivery_at` and
 * `next_pull_at` say when a sink next has work, and the claim pairs lease it to
 * one replica for the length of a pass. A sink is the claim unit rather than a
 * delivery row because one in-flight request per sink is what keeps a `stop`
 * from overtaking its `start`.
 *
 * The rest are there to stop writes nothing asked for: `routing_hash` lets a
 * sink upsert be skipped when its routing has not changed, `status_at` gives
 * the error-probe window a column no upsert touches, `active_at` is the "this
 * configuration is still being used" signal the pull scheduler filters on, and
 * `watch_state.seen_at` separates "the import still lists this" from "this
 * changed", which is what ends the delete/re-import flip-flop.
 */
/** SQLite has no `ADD COLUMN IF NOT EXISTS`; Postgres takes it, as in 0027. */
const columns = (big: string, ine: string) => `
      ALTER TABLE watch_sinks ADD COLUMN ${ine}routing_hash TEXT;
      ALTER TABLE watch_sinks ADD COLUMN ${ine}status_at ${big} NOT NULL DEFAULT 0;
      ALTER TABLE watch_sinks ADD COLUMN ${ine}active_at ${big} NOT NULL DEFAULT 0;
      ALTER TABLE watch_sinks ADD COLUMN ${ine}next_delivery_at ${big};
      ALTER TABLE watch_sinks ADD COLUMN ${ine}next_pull_at ${big};
      ALTER TABLE watch_sinks ADD COLUMN ${ine}delivery_claimed_by TEXT;
      ALTER TABLE watch_sinks ADD COLUMN ${ine}delivery_claim_expires_at ${big};
      ALTER TABLE watch_sinks ADD COLUMN ${ine}pull_claimed_by TEXT;
      ALTER TABLE watch_sinks ADD COLUMN ${ine}pull_claim_expires_at ${big};
      ALTER TABLE watch_sinks ADD COLUMN ${ine}pull_failures INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE watch_state ADD COLUMN ${ine}seen_at ${big};
      ALTER TABLE watch_state ADD COLUMN ${ine}sort_at ${big} NOT NULL DEFAULT 0;
`;

/*
 * `seen_at` is deliberately not backfilled: the sweep reads
 * `COALESCE(seen_at, updated_at)`, so a pre-migration row keeps its old
 * meaning until the next pull touches it.
 */
const backfill = `
      UPDATE watch_sinks SET status_at = updated_at, active_at = updated_at;
      UPDATE watch_sinks SET next_pull_at = COALESCE(last_pull_at, 0) WHERE pull_url IS NOT NULL;
      UPDATE watch_sinks SET next_delivery_at = (
        SELECT MIN(d.next_attempt_at) FROM watch_deliveries d
         WHERE d.sink_id = watch_sinks.id AND d.status = 'pending');
      UPDATE watch_state SET sort_at = COALESCE(last_played_at, updated_at);
`;

/*
 * The two superseded delivery indexes are kept: a replica still running the
 * previous release reads through them until it drains.
 */
const indexes = `
      CREATE INDEX IF NOT EXISTS idx_watch_sinks_delivery_due
        ON watch_sinks (next_delivery_at, delivery_claim_expires_at);
      CREATE INDEX IF NOT EXISTS idx_watch_sinks_pull_due
        ON watch_sinks (next_pull_at, active_at);
      CREATE INDEX IF NOT EXISTS idx_watch_deliveries_sink_pending
        ON watch_deliveries (sink_id, status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_watch_deliveries_prune
        ON watch_deliveries (status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_watch_state_prune
        ON watch_state (updated_at);
      CREATE INDEX IF NOT EXISTS idx_watch_state_import_sweep
        ON watch_state (uuid, persona, sink_id, played, seen_at);
      CREATE INDEX IF NOT EXISTS idx_watch_state_sort
        ON watch_state (uuid, persona, sort_at DESC);
`;

export const watchStateScale: Migration = {
  id: 31,
  name: 'watch_state_scale',
  up: {
    sqlite: `${columns('INTEGER', '')}${backfill}${indexes}`,
    postgres: `${columns('BIGINT', 'IF NOT EXISTS ')}${backfill}${indexes}`,
  },
};
