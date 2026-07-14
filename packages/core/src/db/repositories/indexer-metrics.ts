import { getDb } from '../db.js';
import { sql } from '../sql.js';

/** A drained per-indexer delta to fold into an hourly bucket. */
export interface IndexerMetricDelta {
  instanceId: string;
  name: string;
  searches: number;
  results: number;
  errors: number;
  latencyMsSum: number;
  latencySamples: number;
}

/** Aggregated per-indexer rollup over a window. */
export interface IndexerRollup {
  instanceId: string;
  name: string;
  searches: number;
  results: number;
  errors: number;
  latencyMsSum: number;
  latencySamples: number;
}

interface RollupRow {
  instance_id: string;
  name: string;
  searches: number | string;
  results: number | string;
  errors: number | string;
  latency_ms_sum: number | string;
  latency_samples: number | string;
  [k: string]: unknown;
}

const HOUR_MS = 3_600_000;

function hourFloor(ts: number): number {
  return ts - (ts % HOUR_MS);
}

/**
 * Persistence for per-indexer performance rollups (`indexer_metrics`). The
 * stream pipeline accumulates deltas in memory; a background task drains them
 * here into the current hour bucket. The dashboard queries windowed aggregates.
 */
export class IndexerMetricsRepository {
  /** Fold drained deltas into the hour bucket containing `atMs` (defaults now). */
  static async addDeltas(
    deltas: IndexerMetricDelta[],
    atMs: number = Date.now()
  ): Promise<void> {
    if (deltas.length === 0) return;
    const hourMs = hourFloor(atMs);
    const db = getDb();
    for (const d of deltas) {
      await db.exec(
        sql`INSERT INTO indexer_metrics
              (hour_ms, instance_id, name, searches, results, errors, latency_ms_sum, latency_samples)
            VALUES
              (${hourMs}, ${d.instanceId}, ${d.name}, ${d.searches}, ${d.results}, ${d.errors}, ${d.latencyMsSum}, ${d.latencySamples})
            ON CONFLICT(hour_ms, instance_id) DO UPDATE SET
              name = EXCLUDED.name,
              searches = indexer_metrics.searches + EXCLUDED.searches,
              results = indexer_metrics.results + EXCLUDED.results,
              errors = indexer_metrics.errors + EXCLUDED.errors,
              latency_ms_sum = indexer_metrics.latency_ms_sum + EXCLUDED.latency_ms_sum,
              latency_samples = indexer_metrics.latency_samples + EXCLUDED.latency_samples`
      );
    }
  }

  /** Per-indexer totals over [sinceMs, now]. Newest name per instance wins. */
  static async summaryByIndexer(sinceMs: number): Promise<IndexerRollup[]> {
    const rows = await getDb().query<RollupRow>(
      sql`SELECT instance_id,
                 (SELECT name FROM indexer_metrics n
                   WHERE n.instance_id = m.instance_id
                   ORDER BY hour_ms DESC LIMIT 1) AS name,
                 SUM(searches) AS searches,
                 SUM(results) AS results,
                 SUM(errors) AS errors,
                 SUM(latency_ms_sum) AS latency_ms_sum,
                 SUM(latency_samples) AS latency_samples
            FROM indexer_metrics m
           WHERE hour_ms >= ${sinceMs}
           GROUP BY instance_id`
    );
    return rows.map((r) => ({
      instanceId: r.instance_id,
      name: r.name ?? r.instance_id,
      searches: Number(r.searches ?? 0),
      results: Number(r.results ?? 0),
      errors: Number(r.errors ?? 0),
      latencyMsSum: Number(r.latency_ms_sum ?? 0),
      latencySamples: Number(r.latency_samples ?? 0),
    }));
  }

  /** Earliest recorded hour (for "all time" windows). */
  static async firstHour(): Promise<number | undefined> {
    const row = await getDb().maybeOne<{ hour_ms: number | string }>(
      sql`SELECT MIN(hour_ms) AS hour_ms FROM indexer_metrics`
    );
    const v = row?.hour_ms;
    return v == null ? undefined : Number(v);
  }

  /** Delete rollups older than the cutoff. Returns rows removed. */
  static async pruneOlderThan(cutoffMs: number): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM indexer_metrics WHERE hour_ms < ${cutoffMs}`
    );
    return res.rowCount ?? 0;
  }
}
