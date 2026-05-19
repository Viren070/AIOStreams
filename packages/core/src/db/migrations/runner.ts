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
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
  );
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
    await driver.exec(`SELECT pg_advisory_lock(${PG_ADVISORY_LOCK_KEY})`);
    try {
      return await fn();
    } finally {
      try {
        await driver.exec(`SELECT pg_advisory_unlock(${PG_ADVISORY_LOCK_KEY})`);
      } catch {
        // best-effort
      }
    }
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
    await tx.exec(`INSERT INTO _migrations (id, name) VALUES (?, ?)`, [
      migration.id,
      migration.name,
    ]);
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
 * Verify that the schema is at the expected version. Call after
 * `runMigrations` (which only adds to `_migrations`, never removes).
 * Throws if the DB has a newer schema than the running code expects —
 * the only way that happens is if a newer replica migrated first and an
 * older replica is now booting against it.
 */
export async function assertSchemaUpToDate(driver: DbDriver): Promise<void> {
  const expected = MIGRATIONS.reduce((m, x) => Math.max(m, x.id), 0);
  const row = await driver.maybeOne<{ max: number | string | null }>(
    `SELECT MAX(id) AS max FROM _migrations`
  );
  const current = Number(row?.max ?? 0);
  if (current > expected) {
    throw new Error(
      `Database is at migration ${current} but this build only knows up to ${expected}. ` +
        `Upgrade the application or roll back the database.`
    );
  }
}
