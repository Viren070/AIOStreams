import { getDb } from '../db.js';
import type { DbDriver } from '../driver/types.js';
import { sql, type SqlFragment } from '../sql.js';

/**
 * `descendants (uuid, depth)` for a `WITH RECURSIVE` clause: every configuration
 * that inherits from `parentUuid`, directly or through other configurations, at
 * most `maxDepth` levels down. The depth bound also ends a chain that loops
 * back on itself, so callers must still exclude `parentUuid`.
 */
export function descendantsCte(
  parentUuid: string,
  maxDepth: number
): SqlFragment {
  return sql`descendants (uuid, depth) AS (
      SELECT child_uuid, 1 FROM config_parents
       WHERE parent_uuid = ${parentUuid}
      UNION
      SELECT c.child_uuid, d.depth + 1 FROM config_parents c
        JOIN descendants d ON c.parent_uuid = d.uuid
       WHERE d.depth < ${maxDepth}
    )`;
}

/** Bounds `ensure`'s memory; clearing only costs one extra write per config. */
const MAX_KNOWN = 10_000;

export class ConfigParentRepository {
  /** Child to parent pairs this process has already written. */
  private static readonly known = new Map<string, string>();

  /**
   * Indexes a configuration saved before this index existed. Called on reads,
   * so it writes at most once per configuration and process.
   */
  static async ensure(childUuid: string, parentUuid: string): Promise<void> {
    if (this.known.get(childUuid) === parentUuid) return;
    await getDb().tx((tx) => this.set(tx, childUuid, parentUuid));
    if (this.known.size >= MAX_KNOWN) this.known.clear();
    this.known.set(childUuid, parentUuid);
  }

  /**
   * Records the parent a configuration inherits from, or clears it. Takes the
   * save's transaction so the index never disagrees with the stored config.
   */
  static async set(
    tx: DbDriver,
    childUuid: string,
    parentUuid: string | undefined
  ): Promise<void> {
    if (!parentUuid) {
      await tx.exec(
        sql`DELETE FROM config_parents WHERE child_uuid = ${childUuid}`
      );
      return;
    }
    await tx.exec(
      sql`INSERT INTO config_parents (child_uuid, parent_uuid)
          VALUES (${childUuid}, ${parentUuid})
          ON CONFLICT(child_uuid) DO UPDATE SET parent_uuid = EXCLUDED.parent_uuid`
    );
  }

  /** The configurations `descendantsCte` describes. */
  static async descendants(
    parentUuid: string,
    maxDepth: number
  ): Promise<string[]> {
    const rows = await getDb().query<{ uuid: string }>(
      sql`WITH RECURSIVE ${descendantsCte(parentUuid, maxDepth)}
          SELECT DISTINCT uuid FROM descendants WHERE uuid <> ${parentUuid}
          ORDER BY uuid`
    );
    return rows.map((row) => row.uuid);
  }
}
