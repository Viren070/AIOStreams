import type { DbDriver } from './driver/types.js';
import { createDriver } from './connect.js';
import {
  runMigrations,
  assertSchemaUpToDate,
  getMigrationStatus,
} from './migrations/runner.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('database');

let driverInstance: DbDriver | null = null;
let initPromise: Promise<DbDriver> | null = null;

/**
 * Initialise the database: open the connection, run migrations, verify
 * the schema version.
 */
export async function initDb(uri: string): Promise<DbDriver> {
  if (driverInstance) return driverInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const driver = createDriver(uri);
    try {
      await driver.ping();
      await runMigrations(driver);
      await assertSchemaUpToDate(driver);
    } catch (err) {
      await driver.close().catch(() => undefined);
      initPromise = null;
      throw err;
    }
    driverInstance = driver;
    const { applied, pending } = await getMigrationStatus(driver);

    logger.info(
      {
        dialect: driver.dialect,
        migrations: {
          applied: applied.map((m) => m.name),
          pending: pending.map((m) => m.name),
        },
      },
      'db initialised'
    );
    return driver;
  })();

  return initPromise;
}

/**
 * Get the initialised driver. Throws if `initDb` has not completed.
 * Repositories call this lazily (per-method) so module load order
 * doesn't matter.
 */
export function getDb(): DbDriver {
  if (!driverInstance) {
    throw new Error('Database not initialised. Call initDb(uri) first.');
  }
  return driverInstance;
}

export async function closeDb(): Promise<void> {
  if (!driverInstance) return;
  await driverInstance.close();
  driverInstance = null;
  initPromise = null;
}
