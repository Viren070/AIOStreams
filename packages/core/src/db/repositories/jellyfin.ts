import { getDb } from '../db.js';
import { join, sql } from '../sql.js';
import type { WatchScope } from '../../watch-state/types.js';

const CHUNK = 200;

/**
 * Jellyfin item ids that cannot be rebuilt from their Stremio id, keyed by
 * the 32-hex id the client saw. Rows are refreshed whenever the id is
 * emitted again, so anything a client still browses stays resolvable.
 */
export class JellyfinRepository {
  static async rememberIds(
    entries: { id: string; payload: unknown }[]
  ): Promise<void> {
    if (!entries.length) return;
    const now = Date.now();
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const values = join(
        slice.map((e) => sql`(${e.id}, ${JSON.stringify(e.payload)}, ${now})`)
      );
      await getDb().exec(
        sql`INSERT INTO jellyfin_id_map (id, payload, seen_at)
            VALUES ${values}
            ON CONFLICT(id) DO UPDATE SET seen_at = excluded.seen_at`
      );
    }
  }

  static async lookupId<T = unknown>(id: string): Promise<T | null> {
    const row = await getDb().maybeOne<{ payload: string }>(
      sql`SELECT payload FROM jellyfin_id_map WHERE id = ${id}`
    );
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as T;
    } catch {
      return null;
    }
  }

  static async pruneIds(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const res = await getDb().exec(
      sql`DELETE FROM jellyfin_id_map WHERE seen_at < ${cutoff}`
    );
    return res.rowCount ?? 0;
  }

  static async getDisplayPrefs(
    scope: WatchScope,
    prefId: string,
    client: string
  ): Promise<Record<string, unknown> | null> {
    const row = await getDb().maybeOne<{ payload: string }>(
      sql`SELECT payload FROM jellyfin_display_prefs
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND pref_id = ${prefId} AND client = ${client}`
    );
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  static async setDisplayPrefs(
    scope: WatchScope,
    prefId: string,
    client: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await getDb().exec(
      sql`INSERT INTO jellyfin_display_prefs
            (uuid, persona, pref_id, client, payload, updated_at)
          VALUES (${scope.uuid}, ${scope.persona}, ${prefId}, ${client},
                  ${JSON.stringify(payload)}, ${Date.now()})
          ON CONFLICT(uuid, persona, pref_id, client) DO UPDATE SET
            payload = excluded.payload, updated_at = excluded.updated_at`
    );
  }
}
