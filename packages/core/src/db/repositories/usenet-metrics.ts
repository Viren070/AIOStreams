import { getDb } from '../db.js';
import { sql } from '../sql.js';

/** A drained per-provider delta to fold into an hourly bucket. */
export interface UsenetMetricDelta {
  providerId: string;
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  sumDurationMs: number;
  wallClockMs: number;
}

/** Aggregated per-provider rollup over a window. */
export interface UsenetProviderRollup {
  providerId: string;
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  sumDurationMs: number;
  wallClockMs: number;
  /**
   * Bytes from rows that also have wall-clock time (`wall_clock_ms > 0`). Use
   * this — not `bytes` — as the average-speed numerator so legacy rows (logged
   * before wall-clock tracking) don't inflate the rate.
   */
  speedBytes: number;
}

/** One time-series bucket (optionally scoped to a provider). */
export interface UsenetMetricBucket {
  bucketMs: number;
  providerId?: string;
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  sumDurationMs: number;
  wallClockMs: number;
  /** Bytes from rows with wall-clock time (avg-speed numerator). */
  speedBytes: number;
}

interface RollupRow {
  provider_id: string;
  articles: number | string;
  bytes: number | string;
  errors: number | string;
  missing: number | string;
  sum_duration_ms: number | string;
  wall_clock_ms: number | string;
  speed_bytes: number | string;
  [k: string]: unknown;
}

interface BucketRow extends RollupRow {
  bucket_ms: number | string;
}

const HOUR_MS = 3_600_000;

function hourFloor(ts: number): number {
  return ts - (ts % HOUR_MS);
}

/**
 * Persistence for native usenet provider performance rollups
 * (`usenet_provider_metrics`). The engine accumulates deltas in memory; a
 * background task drains them here every minute into the current hour bucket.
 * The dashboard queries windowed aggregates for charts + the provider table.
 */
export class UsenetMetricsRepository {
  /** Fold drained deltas into the hour bucket containing `atMs` (defaults now). */
  static async addDeltas(
    deltas: UsenetMetricDelta[],
    atMs: number = Date.now()
  ): Promise<void> {
    if (deltas.length === 0) return;
    const hourMs = hourFloor(atMs);
    const db = getDb();
    for (const d of deltas) {
      if (!d.articles && !d.bytes && !d.errors && !d.missing) continue;
      await db.exec(
        sql`INSERT INTO usenet_provider_metrics
              (hour_ms, provider_id, articles, bytes_fetched, errors, missing, sum_duration_ms, wall_clock_ms)
            VALUES
              (${hourMs}, ${d.providerId}, ${d.articles}, ${d.bytes}, ${d.errors}, ${d.missing}, ${d.sumDurationMs}, ${d.wallClockMs})
            ON CONFLICT(hour_ms, provider_id) DO UPDATE SET
              articles = usenet_provider_metrics.articles + EXCLUDED.articles,
              bytes_fetched = usenet_provider_metrics.bytes_fetched + EXCLUDED.bytes_fetched,
              errors = usenet_provider_metrics.errors + EXCLUDED.errors,
              missing = usenet_provider_metrics.missing + EXCLUDED.missing,
              sum_duration_ms = usenet_provider_metrics.sum_duration_ms + EXCLUDED.sum_duration_ms,
              wall_clock_ms = usenet_provider_metrics.wall_clock_ms + EXCLUDED.wall_clock_ms`
      );
    }
  }

  /** Per-provider totals over [sinceMs, now]. */
  static async summaryByProvider(
    sinceMs: number
  ): Promise<UsenetProviderRollup[]> {
    const rows = await getDb().query<RollupRow>(
      sql`SELECT provider_id,
                 SUM(articles) AS articles,
                 SUM(bytes_fetched) AS bytes,
                 SUM(errors) AS errors,
                 SUM(missing) AS missing,
                 SUM(sum_duration_ms) AS sum_duration_ms,
                 SUM(wall_clock_ms) AS wall_clock_ms,
                 SUM(CASE WHEN wall_clock_ms > 0 THEN bytes_fetched ELSE 0 END) AS speed_bytes
            FROM usenet_provider_metrics
           WHERE hour_ms >= ${sinceMs}
           GROUP BY provider_id`
    );
    return rows.map((r) => ({
      providerId: r.provider_id,
      articles: Number(r.articles ?? 0),
      bytes: Number(r.bytes ?? 0),
      errors: Number(r.errors ?? 0),
      missing: Number(r.missing ?? 0),
      sumDurationMs: Number(r.sum_duration_ms ?? 0),
      wallClockMs: Number(r.wall_clock_ms ?? 0),
      speedBytes: Number(r.speed_bytes ?? 0),
    }));
  }

  /**
   * Global time-series bucketed to `bucketMs` (e.g. 1h or 1d). Buckets are
   * derived from the hour-aligned `hour_ms` via integer flooring.
   */
  static async timeSeries(
    sinceMs: number,
    bucketMs: number
  ): Promise<UsenetMetricBucket[]> {
    const bucketExpr = sql`(hour_ms - (hour_ms % ${bucketMs}))`;
    const rows = await getDb().query<BucketRow>(
      sql`SELECT ${bucketExpr} AS bucket_ms,
                 SUM(articles) AS articles,
                 SUM(bytes_fetched) AS bytes,
                 SUM(errors) AS errors,
                 SUM(missing) AS missing,
                 SUM(sum_duration_ms) AS sum_duration_ms,
                 SUM(wall_clock_ms) AS wall_clock_ms,
                 SUM(CASE WHEN wall_clock_ms > 0 THEN bytes_fetched ELSE 0 END) AS speed_bytes
            FROM usenet_provider_metrics
           WHERE hour_ms >= ${sinceMs}
           GROUP BY bucket_ms
           ORDER BY bucket_ms ASC`
    );
    return rows.map(mapBucket);
  }

  /** Per-provider time-series bucketed to `bucketMs` (for stacked/area charts). */
  static async timeSeriesByProvider(
    sinceMs: number,
    bucketMs: number
  ): Promise<UsenetMetricBucket[]> {
    const bucketExpr = sql`(hour_ms - (hour_ms % ${bucketMs}))`;
    const rows = await getDb().query<BucketRow>(
      sql`SELECT ${bucketExpr} AS bucket_ms,
                 provider_id,
                 SUM(articles) AS articles,
                 SUM(bytes_fetched) AS bytes,
                 SUM(errors) AS errors,
                 SUM(missing) AS missing,
                 SUM(sum_duration_ms) AS sum_duration_ms,
                 SUM(wall_clock_ms) AS wall_clock_ms,
                 SUM(CASE WHEN wall_clock_ms > 0 THEN bytes_fetched ELSE 0 END) AS speed_bytes
            FROM usenet_provider_metrics
           WHERE hour_ms >= ${sinceMs}
           GROUP BY bucket_ms, provider_id
           ORDER BY bucket_ms ASC`
    );
    return rows.map((r) => ({ ...mapBucket(r), providerId: r.provider_id }));
  }

  /** Earliest recorded hour (for "all time" windows + first-seen display). */
  static async firstHour(): Promise<number | undefined> {
    const row = await getDb().maybeOne<{ hour_ms: number | string }>(
      sql`SELECT MIN(hour_ms) AS hour_ms FROM usenet_provider_metrics`
    );
    const v = row?.hour_ms;
    return v == null ? undefined : Number(v);
  }

  /** Delete rollups older than the cutoff. Returns rows removed. */
  static async pruneOlderThan(cutoffMs: number): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM usenet_provider_metrics WHERE hour_ms < ${cutoffMs}`
    );
    return res.rowCount ?? 0;
  }
}

function mapBucket(r: BucketRow): UsenetMetricBucket {
  return {
    bucketMs: Number(r.bucket_ms ?? 0),
    articles: Number(r.articles ?? 0),
    bytes: Number(r.bytes ?? 0),
    errors: Number(r.errors ?? 0),
    missing: Number(r.missing ?? 0),
    sumDurationMs: Number(r.sum_duration_ms ?? 0),
    wallClockMs: Number(r.wall_clock_ms ?? 0),
    speedBytes: Number(r.speed_bytes ?? 0),
  };
}
