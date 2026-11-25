import { getDb } from '../db.js';
import type { DbDriver } from '../driver/types.js';
import { sql } from '../sql.js';

/** Bounds `ensure`'s memory; a forgotten config only costs one extra write. */
const MAX_KNOWN = 10_000;

export class ConfigParentRepository {
  /** Configurations this process has already made sure are indexed. */
  private static readonly known = new Set<string>();

  /**
   * Indexes a configuration saved before this index existed. Called on reads,
   * so it writes at most once per configuration and process, and only adds a
   * missing row: the read may be older than a save that just changed the
   * parent, and saves keep existing rows right themselves.
   */
  static async ensure(childUuid: string, parentUuid: string): Promise<void> {
    if (this.known.has(childUuid)) return;
    await getDb().exec(
      sql`INSERT INTO config_parents (child_uuid, parent_uuid)
          VALUES (${childUuid}, ${parentUuid})
          ON CONFLICT(child_uuid) DO NOTHING`
    );
    if (this.known.size >= MAX_KNOWN) {
      // Sets iterate in insertion order, so this forgets the oldest entry.
      this.known.delete(this.known.values().next().value!);
    }
    this.known.add(childUuid);
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

  /**
   * The configurations that inherit directly from `parentUuid`. A
   * configuration merges only its parent's own settings, so saving a parent
   * cannot change what its children's children build.
   */
  static async children(parentUuid: string): Promise<string[]> {
    const rows = await getDb().query<{ uuid: string }>(
      sql`SELECT child_uuid AS uuid FROM config_parents
           WHERE parent_uuid = ${parentUuid} AND child_uuid <> ${parentUuid}
           ORDER BY child_uuid`
    );
    return rows.map((row) => row.uuid);
  }
}
