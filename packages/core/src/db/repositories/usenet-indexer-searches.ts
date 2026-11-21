import { getDb } from '../db.js';
import { join, sql, type SqlFragment } from '../sql.js';

export interface UsenetIndexerSearchRollup {
  indexer: string;
  /** Requests where the indexer returned results. */
  searches: number;
  /** Results left after filters. */
  results: number;
  /** Subset of `results` no other indexer returned in the same request. */
  unique: number;
}

export interface UsenetIndexerSearchDelta extends UsenetIndexerSearchRollup {
  hourMs: number;
}

interface RollupRow {
  indexer: string;
  searches: number | string | null;
  results: number | string | null;
  unique_results: number | string | null;
  [k: string]: unknown;
}

/** An empty scope matches every row. */
export interface UsenetIndexerSearchScope {
  indexer?: string;
  /** Inclusive lower bound on `hour_ms`. */
  sinceMs?: number;
  /** Exclusive upper bound on `hour_ms`. */
  untilMs?: number;
}

function scopeWhere(s: UsenetIndexerSearchScope): SqlFragment {
  const parts: SqlFragment[] = [];
  if (s.indexer !== undefined) parts.push(sql`indexer = ${s.indexer}`);
  if (s.sinceMs !== undefined) parts.push(sql`hour_ms >= ${s.sinceMs}`);
  if (s.untilMs !== undefined) parts.push(sql`hour_ms < ${s.untilMs}`);
  return parts.length === 0 ? sql`1 = 1` : join(parts, ' AND ');
}

export class UsenetIndexerSearchesRepository {
  /** Adds deltas to their hour buckets. */
  static async addDeltas(deltas: UsenetIndexerSearchDelta[]): Promise<void> {
    if (deltas.length === 0) return;
    const values = deltas.map(
      (d) =>
        sql`(${d.hourMs}, ${d.indexer}, ${d.searches}, ${d.results}, ${d.unique})`
    );
    await getDb().exec(
      sql`INSERT INTO usenet_indexer_searches
            (hour_ms, indexer, searches, results, unique_results)
          VALUES ${join(values, ', ')}
          ON CONFLICT(hour_ms, indexer) DO UPDATE SET
            searches = usenet_indexer_searches.searches + EXCLUDED.searches,
            results = usenet_indexer_searches.results + EXCLUDED.results,
            unique_results = usenet_indexer_searches.unique_results + EXCLUDED.unique_results`
    );
  }

  static async summary(sinceMs: number): Promise<UsenetIndexerSearchRollup[]> {
    const rows = await getDb().query<RollupRow>(
      sql`SELECT indexer,
                 SUM(searches) AS searches,
                 SUM(results) AS results,
                 SUM(unique_results) AS unique_results
            FROM usenet_indexer_searches
           WHERE hour_ms >= ${sinceMs}
           GROUP BY indexer`
    );
    return rows
      .map((r) => ({
        indexer: r.indexer,
        searches: Number(r.searches ?? 0),
        results: Number(r.results ?? 0),
        unique: Number(r.unique_results ?? 0),
      }))
      .sort((a, b) => b.searches - a.searches);
  }

  /** For previewing what a reset removes. */
  static async sumScope(
    scope: UsenetIndexerSearchScope
  ): Promise<{ rows: number; searches: number }> {
    // `rows` is a reserved word in postgres; alias around it.
    const row = await getDb().maybeOne<{
      row_count: number | string;
      searches: number | string | null;
    }>(
      sql`SELECT COUNT(*) AS row_count, SUM(searches) AS searches
            FROM usenet_indexer_searches
           WHERE ${scopeWhere(scope)}`
    );
    return {
      rows: Number(row?.row_count ?? 0),
      searches: Number(row?.searches ?? 0),
    };
  }

  static async deleteScope(scope: UsenetIndexerSearchScope): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM usenet_indexer_searches WHERE ${scopeWhere(scope)}`
    );
    return res.rowCount ?? 0;
  }

  static async pruneOlderThan(cutoffMs: number): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM usenet_indexer_searches WHERE hour_ms < ${cutoffMs}`
    );
    return res.rowCount ?? 0;
  }
}
