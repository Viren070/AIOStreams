import Database from 'better-sqlite3';
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type {
  DbDriver,
  ExecResult,
  IntervalUnit,
  Row,
  SqlInput,
} from './types.js';
import { SqlFragment } from '../sql.js';
import { DbError, classifySqliteError } from '../errors.js';

/**
 * SQLite `datetime('now', '-N units')` expression. Both `datetime` and
 * the modifier string accept the plural unit names we use.
 */
function sqliteIntervalAgo(amount: number, unit: IntervalUnit): SqlFragment {
  return new SqlFragment(`datetime('now', '-' || ? || ' ${unit}')`, [amount]);
}

function normalize(
  s: SqlInput,
  params?: readonly unknown[]
): { text: string; params: unknown[] } {
  if (s instanceof SqlFragment) return { text: s.text, params: [...s.params] };
  return { text: s, params: params ? [...params] : [] };
}

/**
 * Coerce JS values into types better-sqlite3 accepts.
 * - undefined → null
 * - boolean → 0 / 1
 */
function coerce(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

/**
 * Serializes async tasks. Used to guard transactions — better-sqlite3's
 * single shared connection means a transaction must own the connection
 * for its entire lifetime, which we enforce here.
 */
class Mutex {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = this.chain;
    const next = prev.then(() => fn());
    // swallow rejections from the chain so one failure doesn't poison subsequent tasks
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function backupPath(filename: string): string {
  const ext = extname(filename);
  const base = basename(filename, ext);
  return join(dirname(filename), `${base}.backup${ext}`);
}

/**
 * Open a SQLite database, running an integrity check after open.
 * Returns the Database instance on success, throws on failure.
 */
function openDatabase(filename: string): Database.Database {
  const db = new Database(filename);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');

    // integrity_check returns rows like { integrity_check: 'ok' } when healthy.
    const rows = db.pragma('integrity_check') as { integrity_check: string }[];
    const ok = rows.length === 1 && rows[0].integrity_check === 'ok';
    if (!ok) {
      throw new Error(
        `SQLite integrity check failed: ${rows.map((r) => r.integrity_check).join(', ')}`
      );
    }
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

export class SqliteDriver implements DbDriver {
  readonly dialect = 'sqlite' as const;
  private readonly db: Database.Database;
  private readonly mutex = new Mutex();
  private backupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(filename: string) {
    const backup = backupPath(filename);
    let db: Database.Database;
    try {
      db = openDatabase(filename);
    } catch (primaryErr) {
      // Primary DB is corrupt or missing. Try the rolling backup.
      if (existsSync(backup)) {
        console.error(
          `[sqlite] Primary database failed to open (${(primaryErr as Error).message}). ` +
            `Attempting recovery from backup: ${backup}`
        );
        const restoreTmp = `${filename}.restore_tmp_${Date.now()}`;
        try {
          copyFileSync(backup, restoreTmp);
          const testDb = openDatabase(restoreTmp);
          testDb.close();
          try {
            renameSync(filename, `${filename}.corrupt_${Date.now()}`);
          } catch {
            // best-effort; primary may not exist
          }
          renameSync(restoreTmp, filename);
          db = openDatabase(filename);
          console.warn(
            '[sqlite] Database recovered from backup. ' +
              'Data may be up to 5 minutes old. Original corrupt file preserved.'
          );
        } catch (backupErr) {
          try {
            renameSync(restoreTmp, `${restoreTmp}.failed`);
          } catch {
            // ignore cleanup errors
          }
          throw new Error(
            `[sqlite] Both primary and backup databases are unreadable. ` +
              `Primary error: ${(primaryErr as Error).message}. ` +
              `Backup error: ${(backupErr as Error).message}.`
          );
        }
      } else {
        // No backup — rethrow primary error so initDb can create a fresh DB.
        throw primaryErr;
      }
    }
    this.db = db;

    // Schedule rolling backup every 5 minutes using the SQLite Online Backup
    // API via better-sqlite3's .backup(). This is atomic and non-blocking.
    const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
    this.backupTimer = setInterval(() => {
      this.db.backup(backup).catch((err: Error) => {
        console.error('[sqlite] Backup failed:', err.message);
      });
    }, BACKUP_INTERVAL_MS);
    // Don't hold the process open just for the backup timer.
    if (this.backupTimer.unref) this.backupTimer.unref();
  }

  // --- sync core; all public async methods funnel through these via the mutex.

  private execSync(text: string, params: unknown[]): ExecResult {
    try {
      const info = this.db.prepare(text).run(...coerce(params));
      return { rowCount: Number(info.changes ?? 0) };
    } catch (err) {
      throw new DbError(classifySqliteError(err), (err as Error).message, err);
    }
  }

  private querySync<T>(text: string, params: unknown[]): T[] {
    try {
      const stmt = this.db.prepare(text);
      // statements that don't return rows (e.g. DDL) blow up on .all() —
      // detect and switch to .run() in that case so a misclassified query
      // still works.
      if (!stmt.reader) {
        stmt.run(...coerce(params));
        return [];
      }
      return stmt.all(...coerce(params)) as T[];
    } catch (err) {
      throw new DbError(classifySqliteError(err), (err as Error).message, err);
    }
  }

  // --- public

  async exec(s: SqlInput, params?: readonly unknown[]): Promise<ExecResult> {
    const { text, params: p } = normalize(s, params);
    return this.mutex.run(() => this.execSync(text, p));
  }

  async query<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T[]> {
    const { text, params: p } = normalize(s, params);
    return this.mutex.run(() => this.querySync<T>(text, p));
  }

  async one<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T> {
    const rows = await this.query<T>(s, params);
    if (!rows.length) {
      throw new DbError('not-found', 'Expected 1 row, got 0');
    }
    return rows[0];
  }

  async maybeOne<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T | null> {
    const rows = await this.query<T>(s, params);
    return rows[0] ?? null;
  }

  async count(s: SqlInput, params?: readonly unknown[]): Promise<number> {
    const rows = await this.query<Row>(s, params);
    if (!rows.length) return 0;
    const first = rows[0];
    const v =
      (first.count as unknown) ??
      (first.c as unknown) ??
      Object.values(first)[0];
    return Number(v ?? 0);
  }

  async tx<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      this.db.exec('BEGIN');
      const txDriver = new SqliteTxDriver(this.db);
      try {
        const r = await fn(txDriver);
        this.db.exec('COMMIT');
        return r;
      } catch (e) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // rollback failure is informational; the original error is what matters
        }
        throw e;
      }
    });
  }

  intervalAgo(amount: number, unit: IntervalUnit): SqlFragment {
    return sqliteIntervalAgo(amount, unit);
  }

  async close(): Promise<void> {
    if (this.backupTimer !== null) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
    this.db.close();
  }

  async ping(): Promise<void> {
    this.db.prepare('SELECT 1').get();
  }
}

/**
 * Transaction-scoped driver. Shares the same native handle as the parent;
 * bypasses the parent's mutex because the parent already holds it for the
 * duration of `tx()`.
 */
class SqliteTxDriver implements DbDriver {
  readonly dialect = 'sqlite' as const;
  constructor(private readonly db: Database.Database) {}

  private execSync(text: string, params: unknown[]): ExecResult {
    try {
      const info = this.db.prepare(text).run(...coerce(params));
      return { rowCount: Number(info.changes ?? 0) };
    } catch (err) {
      throw new DbError(classifySqliteError(err), (err as Error).message, err);
    }
  }

  private querySync<T>(text: string, params: unknown[]): T[] {
    try {
      const stmt = this.db.prepare(text);
      if (!stmt.reader) {
        stmt.run(...coerce(params));
        return [];
      }
      return stmt.all(...coerce(params)) as T[];
    } catch (err) {
      throw new DbError(classifySqliteError(err), (err as Error).message, err);
    }
  }

  async exec(s: SqlInput, params?: readonly unknown[]): Promise<ExecResult> {
    const { text, params: p } = normalize(s, params);
    return this.execSync(text, p);
  }

  async query<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T[]> {
    const { text, params: p } = normalize(s, params);
    return this.querySync<T>(text, p);
  }

  async one<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T> {
    const rows = await this.query<T>(s, params);
    if (!rows.length) {
      throw new DbError('not-found', 'Expected 1 row, got 0');
    }
    return rows[0];
  }

  async maybeOne<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T | null> {
    const rows = await this.query<T>(s, params);
    return rows[0] ?? null;
  }

  async count(s: SqlInput, params?: readonly unknown[]): Promise<number> {
    const rows = await this.query<Row>(s, params);
    if (!rows.length) return 0;
    const first = rows[0];
    const v =
      (first.count as unknown) ??
      (first.c as unknown) ??
      Object.values(first)[0];
    return Number(v ?? 0);
  }

  tx<T>(_fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    return Promise.reject(new Error('Nested transactions are not supported'));
  }

  intervalAgo(amount: number, unit: IntervalUnit): SqlFragment {
    return sqliteIntervalAgo(amount, unit);
  }

  async close(): Promise<void> {
    // owned by parent driver
  }

  async ping(): Promise<void> {
    this.db.prepare('SELECT 1').get();
  }
}
