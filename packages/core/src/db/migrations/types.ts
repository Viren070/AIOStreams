import type { Dialect } from '../driver/types.js';

export interface Migration {
  /** Monotonic version number. The runner applies in ascending order. */
  readonly id: number;
  /** Human-readable name (used in logs and the `_migrations` table). */
  readonly name: string;
  /** DDL/DML per dialect. Both are required so missing one is a build error. */
  readonly up: Record<Dialect, string>;
}
