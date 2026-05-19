import { SqlFragment } from '../sql.js';

export type Dialect = 'sqlite' | 'postgres';

export type Row = Record<string, unknown>;

export type ExecResult = { rowCount: number };

export type SqlInput = SqlFragment | string;

/**
 * Time unit accepted by `DbDriver.intervalAgo`. Plural is canonical;
 * both dialects accept plural in their interval syntax.
 */
export type IntervalUnit = 'seconds' | 'minutes' | 'hours' | 'days';

export interface DbDriver {
  readonly dialect: Dialect;

  /** Run a statement that does not return rows (INSERT/UPDATE/DELETE/DDL). */
  exec(sql: SqlInput, params?: readonly unknown[]): Promise<ExecResult>;

  /** Run a query and return all rows. */
  query<T extends Row = Row>(
    sql: SqlInput,
    params?: readonly unknown[]
  ): Promise<T[]>;

  /** Return exactly one row; throws DbError('not-found') if zero rows. */
  one<T extends Row = Row>(
    sql: SqlInput,
    params?: readonly unknown[]
  ): Promise<T>;

  /** Return zero or one row. */
  maybeOne<T extends Row = Row>(
    sql: SqlInput,
    params?: readonly unknown[]
  ): Promise<T | null>;

  /** Return the first numeric column of the first row (typically `COUNT(*)`). */
  count(sql: SqlInput, params?: readonly unknown[]): Promise<number>;

  /**
   * Run `fn` inside a transaction. The driver passed to `fn` is the
   * transaction handle — use it (not the outer driver) for all queries
   * within the callback. Nested transactions are not supported.
   */
  tx<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T>;

  // --- dialect-aware SQL fragment helpers ---
  //
  // These return fragments that are already correct for this driver's
  // dialect, letting call sites stay dialect-free:
  //   await db.exec(sql`DELETE FROM x WHERE ts < ${db.intervalAgo(7, 'days')}`);

  /**
   * SQL expression evaluating to `now - amount * unit`. Use as a
   * timestamp comparison target.
   */
  intervalAgo(amount: number, unit: IntervalUnit): SqlFragment;

  close(): Promise<void>;
  ping(): Promise<void>;
}
