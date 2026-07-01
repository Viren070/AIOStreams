import type { Dialect, Row } from '../driver/types.js';

/**
 * Minimal transaction handle passed to a migration's `run`. Structurally
 * satisfied by the driver's tx handle, so migrations can inspect the schema
 * (e.g. check a column exists) and stay idempotent. Kept narrow so tests can
 * supply a lightweight adapter without pulling the full driver graph.
 */
export interface MigrationContext {
  readonly dialect: Dialect;
  exec(sql: string, params?: readonly unknown[]): Promise<unknown>;
  maybeOne<T extends Row = Row>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<T | null>;
}

export interface Migration {
  /** Monotonic version number. The runner applies in ascending order. */
  readonly id: number;
  /** Human-readable name (used in logs and the `_migrations` table). */
  readonly name: string;
  /**
   * DDL/DML per dialect, run statement-by-statement. Required unless `run` is
   * provided. Both dialects are required so a missing one is a build error.
   */
  readonly up?: Record<Dialect, string>;
  /**
   * Imperative alternative to `up`, for migrations that must inspect the schema
   * before acting (e.g. a column rename that must be skipped when already
   * applied, so a re-run is a no-op instead of a hard failure). Runs inside the
   * migration transaction and takes precedence over `up`.
   */
  readonly run?: (tx: MigrationContext) => Promise<void>;
}
