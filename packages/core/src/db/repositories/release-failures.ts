import { getDb } from '../db.js';
import { sql, join } from '../sql.js';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const num = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

/**
 * Soft-failure counts per release key and dead-release penalties per
 * (release group, title). See migration 0051.
 */
export class ReleaseFailuresRepository {
  /**
   * Count one more soft failure under every key and return the highest
   * count any of them has now.
   */
  static async recordFailure(keys: readonly string[]): Promise<number> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return 0;
    const now = nowSeconds();
    return getDb().tx(async (tx) => {
      let max = 0;
      for (const key of unique) {
        const row = await tx.maybeOne<{ n: number | string }>(
          sql`INSERT INTO release_blocklist_failures (k, n, last_at)
              VALUES (${key}, 1, ${now})
              ON CONFLICT (k) DO UPDATE SET
                n = release_blocklist_failures.n + 1,
                last_at = EXCLUDED.last_at
              RETURNING n`
        );
        max = Math.max(max, num(row?.n));
      }
      return max;
    });
  }

  /** Forget the soft-failure counts of these keys. */
  static async clearFailures(keys: readonly string[]): Promise<void> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return;
    await getDb().exec(
      sql`DELETE FROM release_blocklist_failures
          WHERE k IN (${join(unique.map((k) => sql`${k}`))})`
    );
  }

  /** The current soft-failure count of one key (0 when none). */
  static async failureCount(key: string): Promise<number> {
    const row = await getDb().maybeOne<{ n: number | string }>(
      sql`SELECT n FROM release_blocklist_failures WHERE k = ${key}`
    );
    return num(row?.n);
  }

  /**
   * Record that `releaseId` of release group `grp` died for the title known
   * by `titleKeys`, and prune penalties older than `windowSeconds`.
   */
  static async addGroupPenalty(
    grp: string,
    titleKeys: readonly string[],
    releaseId: string,
    windowSeconds: number
  ): Promise<void> {
    const unique = [...new Set(titleKeys)];
    if (unique.length === 0) return;
    const now = nowSeconds();
    await getDb().tx(async (tx) => {
      for (const titleKey of unique) {
        await tx.exec(
          sql`INSERT INTO release_blocklist_group_penalties (grp, title_key, release_id, dead_at)
              VALUES (${grp}, ${titleKey}, ${releaseId}, ${now})
              ON CONFLICT (grp, title_key, release_id) DO UPDATE SET
                dead_at = EXCLUDED.dead_at`
        );
      }
      await tx.exec(
        sql`DELETE FROM release_blocklist_group_penalties
            WHERE dead_at < ${now - windowSeconds}`
      );
    });
  }

  /** Lift every penalty of `grp` for the title known by `titleKeys`. */
  static async clearGroupPenalties(
    grp: string,
    titleKeys: readonly string[]
  ): Promise<void> {
    const unique = [...new Set(titleKeys)];
    if (unique.length === 0) return;
    await getDb().exec(
      sql`DELETE FROM release_blocklist_group_penalties
          WHERE grp = ${grp}
            AND title_key IN (${join(unique.map((k) => sql`${k}`))})`
    );
  }

  /**
   * Release groups with at least `threshold` distinct dead releases for the
   * title known by `titleKeys` within the last `windowSeconds`, mapped to
   * that count.
   */
  static async demotedGroups(
    titleKeys: readonly string[],
    threshold: number,
    windowSeconds: number
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const unique = [...new Set(titleKeys)];
    if (unique.length === 0 || threshold <= 0) return result;
    const rows = await getDb().query<{ grp: string; n: number | string }>(
      sql`SELECT grp, COUNT(DISTINCT release_id) AS n
          FROM release_blocklist_group_penalties
          WHERE title_key IN (${join(unique.map((k) => sql`${k}`))})
            AND dead_at >= ${nowSeconds() - windowSeconds}
          GROUP BY grp
          HAVING COUNT(DISTINCT release_id) >= ${threshold}`
    );
    for (const row of rows) result.set(row.grp, num(row.n));
    return result;
  }
}
