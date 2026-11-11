import { getDb } from '../db.js';
import { join, sql, type SqlFragment } from '../sql.js';
import type { USENET_AGE_BUCKETS } from '../../debrid/base.js';

export type UsenetAttemptKind = 'first' | 'failover';
export type UsenetAgeBucket = (typeof USENET_AGE_BUCKETS)[number] | 'unknown';

export interface UsenetIndexerAttemptDelta {
  indexer: string;
  attempt: UsenetAttemptKind;
  ageBucket: UsenetAgeBucket;
  ok?: number;
  failed?: number;
  /** Subset of `ok`: failovers that played after an earlier attempt failed. */
  rescues?: number;
}

export interface UsenetIndexerAttemptRollup {
  indexer: string;
  attempt: UsenetAttemptKind;
  ageBucket: UsenetAgeBucket;
  ok: number;
  failed: number;
  rescues: number;
}

interface RollupRow {
  indexer: string;
  attempt: string;
  age_bucket: string;
  ok: number | string | null;
  failed: number | string | null;
  rescues: number | string | null;
  [k: string]: unknown;
}

/** An empty scope matches every row. */
export interface UsenetIndexerAttemptScope {
  indexer?: string;
  /** Inclusive lower bound on `hour_ms`. */
  sinceMs?: number;
  /** Exclusive upper bound on `hour_ms`. */
  untilMs?: number;
}

const HOUR_MS = 3_600_000;

function hourFloor(ts: number): number {
  return ts - (ts % HOUR_MS);
}

function scopeWhere(s: UsenetIndexerAttemptScope): SqlFragment {
  const parts: SqlFragment[] = [];
  if (s.indexer !== undefined) parts.push(sql`indexer = ${s.indexer}`);
  if (s.sinceMs !== undefined) parts.push(sql`hour_ms >= ${s.sinceMs}`);
  if (s.untilMs !== undefined) parts.push(sql`hour_ms < ${s.untilMs}`);
  return parts.length === 0 ? sql`1 = 1` : join(parts, ' AND ');
}

export class UsenetIndexerAttemptsRepository {
  /** Adds one attempt to the hour bucket containing `atMs`. */
  static async record(
    d: UsenetIndexerAttemptDelta,
    atMs: number = Date.now()
  ): Promise<void> {
    const hourMs = hourFloor(atMs);
    await getDb().exec(
      sql`INSERT INTO usenet_indexer_attempts
            (hour_ms, indexer, attempt, age_bucket, ok, failed, rescues)
          VALUES
            (${hourMs}, ${d.indexer}, ${d.attempt}, ${d.ageBucket}, ${d.ok ?? 0}, ${d.failed ?? 0}, ${d.rescues ?? 0})
          ON CONFLICT(hour_ms, indexer, attempt, age_bucket) DO UPDATE SET
            ok = usenet_indexer_attempts.ok + EXCLUDED.ok,
            failed = usenet_indexer_attempts.failed + EXCLUDED.failed,
            rescues = usenet_indexer_attempts.rescues + EXCLUDED.rescues`
    );
  }

  static async summary(sinceMs: number): Promise<UsenetIndexerAttemptRollup[]> {
    const rows = await getDb().query<RollupRow>(
      sql`SELECT indexer, attempt, age_bucket,
                 SUM(ok) AS ok,
                 SUM(failed) AS failed,
                 SUM(rescues) AS rescues
            FROM usenet_indexer_attempts
           WHERE hour_ms >= ${sinceMs}
           GROUP BY indexer, attempt, age_bucket`
    );
    return rows.map((r) => ({
      indexer: r.indexer,
      attempt: r.attempt as UsenetAttemptKind,
      ageBucket: r.age_bucket as UsenetAgeBucket,
      ok: Number(r.ok ?? 0),
      failed: Number(r.failed ?? 0),
      rescues: Number(r.rescues ?? 0),
    }));
  }

  /** For previewing what a reset removes. */
  static async sumScope(
    scope: UsenetIndexerAttemptScope
  ): Promise<{ rows: number; attempts: number }> {
    // `rows` is a reserved word in postgres; alias around it.
    const row = await getDb().maybeOne<{
      row_count: number | string;
      attempts: number | string | null;
    }>(
      sql`SELECT COUNT(*) AS row_count,
                 SUM(ok + failed) AS attempts
            FROM usenet_indexer_attempts
           WHERE ${scopeWhere(scope)}`
    );
    return {
      rows: Number(row?.row_count ?? 0),
      attempts: Number(row?.attempts ?? 0),
    };
  }

  static async deleteScope(scope: UsenetIndexerAttemptScope): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM usenet_indexer_attempts WHERE ${scopeWhere(scope)}`
    );
    return res.rowCount ?? 0;
  }

  static async pruneOlderThan(cutoffMs: number): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM usenet_indexer_attempts WHERE hour_ms < ${cutoffMs}`
    );
    return res.rowCount ?? 0;
  }
}
