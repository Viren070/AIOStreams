import type { Migration } from './types.js';

/**
 * Store Screener's remote-source refresh interval in seconds rather than
 * hours, so it accepts fine-grained durations (matching the rest of the config).
 * Renames the column and scales existing values in place; `RENAME COLUMN`
 * carries the column's CHECK constraint over on both SQLite (3.25+) and Postgres.
 *
 * Idempotent: the rename runs only while the pre-rename column is still present,
 * so re-applying this migration (after a restore, or if migration bookkeeping is
 * ever out of step with the schema) is a no-op instead of failing on a column
 * that no longer exists.
 */
const HAS_REFRESH_HOURS = {
  sqlite: `SELECT 1 AS x FROM pragma_table_info('screener_sources') WHERE name = 'refresh_hours'`,
  postgres: `SELECT 1 AS x FROM information_schema.columns WHERE table_name = 'screener_sources' AND column_name = 'refresh_hours'`,
} as const;

export const screenerRefreshSeconds: Migration = {
  id: 14,
  name: 'screener_refresh_seconds',
  run: async (tx) => {
    const hasOldColumn = await tx.maybeOne(HAS_REFRESH_HOURS[tx.dialect]);
    if (hasOldColumn) {
      await tx.exec(
        `ALTER TABLE screener_sources RENAME COLUMN refresh_hours TO refresh_seconds`
      );
      await tx.exec(
        `UPDATE screener_sources SET refresh_seconds = refresh_seconds * 3600`
      );
    }
    await tx.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_screener_sources_one_local ON screener_sources (kind) WHERE kind = 'local'`
    );
  },
};
