import { Pool, PoolClient } from 'pg';
import type {
  DbDriver,
  ExecResult,
  IntervalUnit,
  Row,
  SqlInput,
} from './types.js';
import { SqlFragment } from '../sql.js';
import { DbError, classifyPgError } from '../errors.js';

/**
 * Postgres `NOW() - amount * INTERVAL '1 unit'`. The unit is from a
 * typed enum (not user input), so it's safe to inline.
 */
function pgIntervalAgo(amount: number, unit: IntervalUnit): SqlFragment {
  return new SqlFragment(
    `(NOW() - (CAST(? AS INTEGER) * INTERVAL '1 ${unit}'))`,
    [amount]
  );
}

function rewriteQuestionMarks(text: string): string {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

function normalize(
  s: SqlInput,
  params?: readonly unknown[]
): { text: string; params: unknown[] } {
  if (s instanceof SqlFragment) {
    return { text: rewriteQuestionMarks(s.text), params: [...s.params] };
  }
  return { text: rewriteQuestionMarks(s), params: params ? [...params] : [] };
}

interface PgExecutor {
  query(
    text: string,
    params: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

async function runQuery<T>(
  exec: PgExecutor,
  text: string,
  params: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  try {
    const r = await exec.query(text, params);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  } catch (err) {
    throw new DbError(classifyPgError(err), (err as Error).message, err);
  }
}

function extractCount(rows: Row[]): number {
  if (!rows.length) return 0;
  const first = rows[0];
  const v =
    (first.count as unknown) ?? (first.c as unknown) ?? Object.values(first)[0];
  return Number(v ?? 0);
}

export class PostgresDriver implements DbDriver {
  readonly dialect = 'postgres' as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    // surface but don't crash on idle-client errors
    this.pool.on('error', () => {});
  }

  async exec(s: SqlInput, params?: readonly unknown[]): Promise<ExecResult> {
    const { text, params: p } = normalize(s, params);
    const r = await runQuery<Row>(this.pool, text, p);
    return { rowCount: r.rowCount };
  }

  async query<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T[]> {
    const { text, params: p } = normalize(s, params);
    const r = await runQuery<T>(this.pool, text, p);
    return r.rows;
  }

  async one<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T> {
    const rows = await this.query<T>(s, params);
    if (!rows.length) throw new DbError('not-found', 'Expected 1 row, got 0');
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
    return extractCount(await this.query<Row>(s, params));
  }

  async tx<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txDriver = new PostgresTxDriver(client);
      const r = await fn(txDriver);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // rollback failure is informational; original error wins
      }
      throw e;
    } finally {
      client.release();
    }
  }

  intervalAgo(amount: number, unit: IntervalUnit): SqlFragment {
    return pgIntervalAgo(amount, unit);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

class PostgresTxDriver implements DbDriver {
  readonly dialect = 'postgres' as const;
  constructor(private readonly client: PoolClient) {}

  async exec(s: SqlInput, params?: readonly unknown[]): Promise<ExecResult> {
    const { text, params: p } = normalize(s, params);
    const r = await runQuery<Row>(this.client, text, p);
    return { rowCount: r.rowCount };
  }

  async query<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T[]> {
    const { text, params: p } = normalize(s, params);
    const r = await runQuery<T>(this.client, text, p);
    return r.rows;
  }

  async one<T extends Row = Row>(
    s: SqlInput,
    params?: readonly unknown[]
  ): Promise<T> {
    const rows = await this.query<T>(s, params);
    if (!rows.length) throw new DbError('not-found', 'Expected 1 row, got 0');
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
    return extractCount(await this.query<Row>(s, params));
  }

  tx<T>(_fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    return Promise.reject(new Error('Nested transactions are not supported'));
  }

  intervalAgo(amount: number, unit: IntervalUnit): SqlFragment {
    return pgIntervalAgo(amount, unit);
  }

  async close(): Promise<void> {
    // owned by parent driver
  }

  async ping(): Promise<void> {
    await this.client.query('SELECT 1');
  }
}
