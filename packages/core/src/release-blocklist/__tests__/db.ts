import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, closeDb, getDb } from '../../db/db.js';
import { sql } from '../../db/sql.js';
import { settingsStore } from '../../config/index.js';

/**
 * Test helper: a throwaway SQLite database with migrations applied and the
 * runtime settings store initialised against it.
 */
export async function openTestDb(): Promise<() => Promise<void>> {
  const dir = mkdtempSync(join(tmpdir(), 'aiostreams-blocklist-'));
  await initDb(`sqlite://${join(dir, 'test.db')}`);
  await settingsStore.initialise();
  return async () => {
    await closeDb();
    rmSync(dir, { recursive: true, force: true });
  };
}

/** Wipe the local verdicts, failure counts, penalties and stored settings. */
export async function resetBlocklistState(): Promise<void> {
  const db = getDb();
  await db.exec(sql`DELETE FROM release_blocklist_failures`);
  await db.exec(sql`DELETE FROM release_blocklist_group_penalties`);
  await db.exec(sql`DELETE FROM release_blocklist_entries`);
  await db.exec(sql`DELETE FROM release_blocklist_overrides`);
  for (const key of [
    'releaseBlocklist.enabled',
    'releaseBlocklist.repeatFailures',
    'releaseBlocklist.groupDemotionThreshold',
    'releaseBlocklist.groupDemotionWindowDays',
  ]) {
    await settingsStore.delete(key).catch(() => undefined);
  }
}

/** A valid `wd1:` release key for test number `n`. */
export function wd1(n: number): string {
  return `wd1:${n.toString(16).padStart(32, '0')}`;
}

/** A valid `nh1:` NZB content key for test number `n`. */
export function nh1(n: number): string {
  return `nh1:${n.toString(16).padStart(40, '0')}`;
}
