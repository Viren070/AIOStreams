import type { DbDriver } from '../driver/types.js';
import { createLogger } from '../../logging/logger.js';
import { MIGRATIONS, type Migration } from './index.js';

const logger = createLogger('database');

/**
 * Advisory lock key for the migration runner (Postgres).
 * Arbitrary stable 64-bit integer.
 */
const PG_ADVISORY_LOCK_KEY = 0x4149_4f53_4d49_4752n; // "AIOSMIGR" in hex-ish

async function ensureMigrationsTable(driver: DbDriver): Promise<void> {
  // Idempotent. Both dialects support the same DDL here.
  await driver.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        backward_compatible INTEGER NOT NULL DEFAULT 0,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
  );
  // Add to databases created before this column existed (0 = breaking).
  if (!(await columnExists(driver, '_migrations', 'backward_compatible'))) {
    await driver.exec(
      `ALTER TABLE _migrations ADD COLUMN backward_compatible INTEGER NOT NULL DEFAULT 0`
    );
  }
}

async function tableExists(driver: DbDriver, table: string): Promise<boolean> {
  if (driver.dialect === 'sqlite') {
    const row = await driver.maybeOne(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [table]
    );
    return row !== null;
  }
  const row = await driver.maybeOne(`SELECT to_regclass(?) AS reg`, [
    `public.${table}`,
  ]);
  return !!row && (row as { reg: unknown }).reg !== null;
}

async function columnExists(
  driver: DbDriver,
  table: string,
  column: string
): Promise<boolean> {
  if (driver.dialect === 'sqlite') {
    // `table` is an internal literal, never user input, so interpolation is safe.
    const rows = await driver.query<{ name: string }>(
      `PRAGMA table_info(${table})`
    );
    return rows.some((r) => r.name === column);
  }
  const row = await driver.maybeOne(
    `SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
    [table, column]
  );
  return row !== null;
}

async function getAppliedIds(driver: DbDriver): Promise<Set<number>> {
  const rows = await driver.query<{ id: number | string }>(
    `SELECT id FROM _migrations`
  );
  return new Set(rows.map((r) => Number(r.id)));
}

async function withMigrationLock<T>(
  driver: DbDriver,
  fn: () => Promise<T>
): Promise<T> {
  if (driver.dialect === 'postgres') {
    // `pg_advisory_xact_lock` is auto-released by Postgres on COMMIT or
    // ROLLBACK of the transaction's pinned connection, so its lifecycle
    // is tied to the tx and cannot leak across pool checkouts. The
    // earlier `driver.exec(pg_advisory_lock) … driver.exec(pg_advisory_unlock)`
    // pair sent lock and unlock through `pool.query()`, which checks
    // out a fresh connection per call — so the unlock no-oped on a
    // different session while the original connection returned to the
    // pool still holding the session-level lock. See #975.
    return driver.tx(async (tx) => {
      await tx.exec(`SELECT pg_advisory_xact_lock(${PG_ADVISORY_LOCK_KEY})`);
      return fn();
    });
  }
  // SQLite: the driver's internal mutex already serializes writes; in
  // practice multi-replica + SQLite is not a supported deployment.
  return fn();
}

function splitStatements(sql: string): string[] {
  // Naive but sufficient: split on `;` at statement boundaries, ignore
  // trailing whitespace-only chunks. Migration SQL is hand-written and
  // does not contain inline `;` literals in our case.
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigration(
  driver: DbDriver,
  migration: Migration
): Promise<void> {
  const sql = migration.up[driver.dialect];
  const statements = splitStatements(sql);
  await driver.tx(async (tx) => {
    for (const stmt of statements) {
      await tx.exec(stmt);
    }
    await tx.exec(
      `INSERT INTO _migrations (id, name, backward_compatible) VALUES (?, ?, ?)`,
      [migration.id, migration.name, migration.backwardCompatible ? 1 : 0]
    );
  });
}

export async function getMigrationStatus(driver: DbDriver): Promise<{
  applied: Migration[];
  pending: Migration[];
}> {
  const appliedIds = await getAppliedIds(driver);
  const applied = MIGRATIONS.filter((m) => appliedIds.has(m.id));
  const pending = MIGRATIONS.filter((m) => !appliedIds.has(m.id));
  return { applied, pending };
}

/**
 * Run all pending migrations. Idempotent — safe to call on every boot.
 *
 * Detects v2 databases (where `users` exists but `_migrations` does not)
 * and marks the baseline as applied without executing it. Subsequent
 * migrations then run normally.
 */
export async function runMigrations(driver: DbDriver): Promise<void> {
  return withMigrationLock(driver, async () => {
    await ensureMigrationsTable(driver);

    const applied = await getAppliedIds(driver);

    // v2 detection: if baseline isn't marked applied but the v2 tables
    // are already present, mark it applied without re-running.
    const baseline = MIGRATIONS[0];
    if (!applied.has(baseline.id) && (await tableExists(driver, 'users'))) {
      logger.info(
        `Detected pre-existing v2 schema; marking baseline migration as applied`
      );
      await driver.exec(`INSERT INTO _migrations (id, name) VALUES (?, ?)`, [
        baseline.id,
        baseline.name,
      ]);
      applied.add(baseline.id);
    }

    const pending = MIGRATIONS.filter((m) => !applied.has(m.id));
    if (pending.length === 0) {
      logger.debug('No pending migrations');
      return;
    }

    for (const m of pending) {
      logger.info(`Applying migration ${m.id} (${m.name})`);
      await applyMigration(driver, m);
    }
    logger.info(`Applied ${pending.length} migration(s)`);
  });
}

/**
 * After a rollback the DB may carry migrations this build doesn't know. Boot only
 * if every newer one is backward-compatible; else throw. Call after runMigrations.
 */
export async function assertSchemaUpToDate(driver: DbDriver): Promise<void> {
  const expected = MIGRATIONS.reduce((m, x) => Math.max(m, x.id), 0);
  const ahead = await driver.query<{
    id: number | string;
    backward_compatible: number | string;
  }>(`SELECT id, backward_compatible FROM _migrations WHERE id > ?`, [expected]);
  if (ahead.length === 0) return;

  const newest = Math.max(...ahead.map((r) => Number(r.id)));
  const breaking = ahead.filter((r) => Number(r.backward_compatible) !== 1);
  if (breaking.length === 0) {
    logger.warn(
      `Database is ahead of this build (migration ${newest} vs ${expected}); ` +
        `all newer migrations are backward-compatible, booting and ignoring them.`
    );
    return;
  }
  throw new Error(
    `Database is at migration ${newest} but this build only knows up to ${expected}, ` +
      `and a newer migration changes existing tables in a way it can't safely use. ` +
      `Upgrade or roll back the database.`
  );
}
