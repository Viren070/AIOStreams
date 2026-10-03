import { getDb } from '../db.js';
import type { DbDriver } from '../driver/types.js';
import { join, sql, type SqlFragment } from '../sql.js';
import type { WatchScope } from '../../watch-state/types.js';

/** When one addon's tracker says an episode airs, keyed like a watch row. */
export interface WatchAirTime {
  itemKey: string;
  matchKey: string | null;
  seriesKey: string;
  mediaType: string;
  airsAt: number;
}

interface DbRow {
  item_key: string;
  match_key: string | null;
  series_key: string;
  media_type: string;
  airs_at: number | string;
  [k: string]: unknown;
}

const CHUNK = 200;

/* A retired addon's times are kept for its return, but say nothing meanwhile. */
function ownedInUse(scope: WatchScope): SqlFragment {
  return sql`t.uuid = ${scope.uuid} AND t.persona = ${scope.persona}
    AND t.sink_id IN (SELECT id FROM watch_sinks
                       WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
                         AND retired_at IS NULL)`;
}

function toAirTime(r: DbRow): WatchAirTime {
  return {
    itemKey: r.item_key,
    matchKey: r.match_key,
    seriesKey: r.series_key,
    mediaType: r.media_type,
    airsAt: Number(r.airs_at),
  };
}

export class WatchAirTimeRepository {
  /** An addon's whole set, as its latest `watched` read gave it. */
  static async replace(
    scope: WatchScope,
    sinkId: string,
    rows: WatchAirTime[],
    db: DbDriver = getDb()
  ): Promise<void> {
    await db.exec(
      sql`DELETE FROM watch_air_times
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND sink_id = ${sinkId}`
    );
    for (let i = 0; i < rows.length; i += CHUNK) {
      const values = rows.slice(i, i + CHUNK).map(
        (r) =>
          sql`(${scope.uuid}, ${scope.persona}, ${r.itemKey}, ${sinkId},
            ${r.matchKey}, ${r.seriesKey}, ${r.mediaType}, ${r.airsAt})`
      );
      await db.exec(
        sql`INSERT INTO watch_air_times
              (uuid, persona, item_key, sink_id, match_key, series_key,
               media_type, airs_at)
            VALUES ${join(values)}`
      );
    }
  }

  /** Times stored under any of `keys`, or matched to one of them. */
  static async among(
    scope: WatchScope,
    keys: string[]
  ): Promise<WatchAirTime[]> {
    const out: WatchAirTime[] = [];
    const wanted = [...new Set(keys.filter(Boolean))];
    const owner = ownedInUse(scope);
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const list = join(wanted.slice(i, i + CHUNK).map((k) => sql`${k}`));
      // Two branches, not an OR: SQLite only uses both indexes this way.
      const rows = await getDb().query<DbRow>(
        sql`SELECT t.* FROM watch_air_times t
             WHERE ${owner} AND t.item_key IN (${list})
            UNION
            SELECT t.* FROM watch_air_times t
             WHERE ${owner} AND t.match_key IN (${list})`
      );
      out.push(...rows.map(toAirTime));
    }
    return out;
  }

  static async between(
    scope: WatchScope,
    from: number,
    to: number
  ): Promise<WatchAirTime[]> {
    const rows = await getDb().query<DbRow>(
      sql`SELECT t.* FROM watch_air_times t
           WHERE ${ownedInUse(scope)}
             AND t.airs_at > ${from} AND t.airs_at <= ${to}`
    );
    return rows.map(toAirTime);
  }
}
