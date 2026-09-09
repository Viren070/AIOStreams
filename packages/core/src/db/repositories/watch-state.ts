import { getDb } from '../db.js';
import { join, sql } from '../sql.js';
import type { WatchScope } from '../../watch-state/types.js';

/** What a list row needs to render without a metadata call. */
export interface WatchSnapshot {
  name?: string;
  seriesName?: string;
  poster?: string;
  backdrop?: string;
  thumb?: string;
  indexNumber?: number;
  parentIndexNumber?: number;
  runtimeMs?: number;
}

export type WatchKind = 'movie' | 'series' | 'episode';

/** Who wrote the row. An import may replace an import, never a recent local. */
export type WatchOrigin = 'local' | 'import';

/** Content identity of one row. `itemKey` is the primary key with the scope. */
export interface WatchIdentity {
  itemKey: string;
  kind: WatchKind;
  mediaType: string;
  baseId: string;
  season?: number | null;
  episode?: number | null;
  videoId?: string | null;
  seriesKey?: string | null;
}

export interface WatchStateRow extends WatchIdentity {
  uuid: string;
  persona: string;
  positionMs: number;
  durationMs: number;
  played: boolean;
  playCount: number;
  favorite: boolean;
  lastPlayedAt: number | null;
  updatedAt: number;
  origin: WatchOrigin;
  sinkId: string | null;
  externalAt: number | null;
  snapshot: WatchSnapshot | null;
}

export interface WatchStatePatch {
  positionMs?: number;
  durationMs?: number;
  played?: boolean;
  incrementPlayCount?: boolean | 'if-unplayed';
  favorite?: boolean;
  /** `null` clears it; `undefined` leaves it alone. */
  lastPlayedAt?: number | null;
  snapshot?: WatchSnapshot;
  origin?: WatchOrigin;
  sinkId?: string | null;
  externalAt?: number | null;
}

interface DbRow {
  uuid: string;
  persona: string;
  item_key: string;
  kind: string;
  media_type: string;
  base_id: string;
  season: number | string | null;
  episode: number | string | null;
  video_id: string | null;
  series_key: string | null;
  position_ms: number | string;
  duration_ms: number | string;
  played: number | string;
  play_count: number | string;
  favorite: number | string;
  last_played_at: number | string | null;
  updated_at: number | string;
  origin: string;
  sink_id: string | null;
  external_at: number | string | null;
  snapshot: string | null;
  [k: string]: unknown;
}

const CHUNK = 200;

function optionalNumber(v: number | string | null): number | null {
  return v == null ? null : Number(v);
}

function toRow(r: DbRow): WatchStateRow {
  let snapshot: WatchSnapshot | null = null;
  if (r.snapshot) {
    try {
      snapshot = JSON.parse(r.snapshot) as WatchSnapshot;
    } catch {
      snapshot = null;
    }
  }
  return {
    uuid: r.uuid,
    persona: r.persona,
    itemKey: r.item_key,
    kind: r.kind as WatchKind,
    mediaType: r.media_type,
    baseId: r.base_id,
    season: optionalNumber(r.season),
    episode: optionalNumber(r.episode),
    videoId: r.video_id,
    seriesKey: r.series_key,
    positionMs: Number(r.position_ms),
    durationMs: Number(r.duration_ms),
    played: Boolean(Number(r.played)),
    playCount: Number(r.play_count),
    favorite: Boolean(Number(r.favorite)),
    lastPlayedAt: optionalNumber(r.last_played_at),
    updatedAt: Number(r.updated_at),
    origin: (r.origin as WatchOrigin) ?? 'local',
    sinkId: r.sink_id,
    externalAt: optionalNumber(r.external_at),
    snapshot,
  };
}

export function watchKindOf(row: Pick<WatchIdentity, 'kind'>): WatchKind {
  return row.kind;
}

function filterKinds(rows: WatchStateRow[], kinds?: WatchKind[]) {
  if (!kinds?.length) return rows;
  return rows.filter((r) => kinds.includes(r.kind));
}

export class WatchStateRepository {
  static async get(
    scope: WatchScope,
    itemKey: string
  ): Promise<WatchStateRow | null> {
    const row = await getDb().maybeOne<DbRow>(
      sql`SELECT * FROM watch_state
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND item_key = ${itemKey}`
    );
    return row ? toRow(row) : null;
  }

  static async getMany(
    scope: WatchScope,
    itemKeys: string[]
  ): Promise<Map<string, WatchStateRow>> {
    const out = new Map<string, WatchStateRow>();
    const wanted = [...new Set(itemKeys.filter(Boolean))];
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const slice = wanted.slice(i, i + CHUNK);
      const rows = await getDb().query<DbRow>(
        sql`SELECT * FROM watch_state
             WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
               AND item_key IN (${join(slice.map((k) => sql`${k}`))})`
      );
      for (const r of rows) out.set(r.item_key, toRow(r));
    }
    return out;
  }

  static async upsert(
    scope: WatchScope,
    identity: WatchIdentity,
    patch: WatchStatePatch
  ): Promise<WatchStateRow> {
    const now = Date.now();
    const pos = patch.positionMs ?? null;
    const dur = patch.durationMs ?? null;
    const played = patch.played == null ? null : patch.played ? 1 : 0;
    const fav = patch.favorite == null ? null : patch.favorite ? 1 : 0;
    const incMode =
      patch.incrementPlayCount === 'if-unplayed'
        ? 2
        : patch.incrementPlayCount
          ? 1
          : 0;
    const setLastPlayed = patch.lastPlayedAt === undefined ? 0 : 1;
    const lastPlayed = patch.lastPlayedAt ?? null;
    const snapshot = patch.snapshot ? JSON.stringify(patch.snapshot) : null;
    const season = identity.season ?? null;
    const episode = identity.episode ?? null;
    const videoId = identity.videoId ?? null;
    const seriesKey = identity.seriesKey ?? null;
    const origin = patch.origin ?? 'local';
    const sinkId = patch.sinkId ?? null;
    const externalAt = patch.externalAt ?? null;

    await getDb().exec(
      sql`INSERT INTO watch_state
            (uuid, persona, item_key, kind, media_type, base_id, season, episode,
             video_id, series_key, position_ms, duration_ms, played, play_count,
             favorite, last_played_at, updated_at, origin, sink_id, external_at,
             snapshot)
          VALUES (${scope.uuid}, ${scope.persona}, ${identity.itemKey},
                  ${identity.kind}, ${identity.mediaType}, ${identity.baseId},
                  ${season}, ${episode}, ${videoId}, ${seriesKey},
                  COALESCE(${pos}, 0), COALESCE(${dur}, 0), COALESCE(${played}, 0),
                  CASE WHEN ${incMode} > 0 THEN 1 ELSE 0 END,
                  COALESCE(${fav}, 0), ${lastPlayed}, ${now},
                  ${origin}, ${sinkId}, ${externalAt}, ${snapshot})
          ON CONFLICT(uuid, persona, item_key) DO UPDATE SET
            kind = excluded.kind,
            media_type = excluded.media_type,
            base_id = excluded.base_id,
            season = excluded.season,
            episode = excluded.episode,
            video_id = COALESCE(excluded.video_id, watch_state.video_id),
            series_key = COALESCE(excluded.series_key, watch_state.series_key),
            position_ms = COALESCE(${pos}, watch_state.position_ms),
            duration_ms = COALESCE(${dur}, watch_state.duration_ms),
            played = COALESCE(${played}, watch_state.played),
            play_count = watch_state.play_count +
              CASE ${incMode}
                WHEN 1 THEN 1
                WHEN 2 THEN CASE WHEN watch_state.played = 1 THEN 0 ELSE 1 END
                ELSE 0
              END,
            favorite = COALESCE(${fav}, watch_state.favorite),
            last_played_at = CASE WHEN ${setLastPlayed} = 1 THEN ${lastPlayed} ELSE watch_state.last_played_at END,
            updated_at = excluded.updated_at,
            origin = excluded.origin,
            sink_id = excluded.sink_id,
            external_at = excluded.external_at,
            snapshot = COALESCE(${snapshot}, watch_state.snapshot)`
    );

    const row = await this.get(scope, identity.itemKey);
    if (row) return row;
    return {
      uuid: scope.uuid,
      persona: scope.persona,
      ...identity,
      season,
      episode,
      videoId,
      seriesKey,
      positionMs: pos ?? 0,
      durationMs: dur ?? 0,
      played: !!played,
      playCount: incMode > 0 ? 1 : 0,
      favorite: !!fav,
      lastPlayedAt: lastPlayed,
      updatedAt: now,
      origin,
      sinkId,
      externalAt,
      snapshot: patch.snapshot ?? null,
    };
  }

  static async delete(scope: WatchScope, itemKey: string): Promise<void> {
    await getDb().exec(
      sql`DELETE FROM watch_state
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND item_key = ${itemKey}`
    );
  }

  /** Ordered on `last_played_at`: an imported batch shares one `updated_at`. */
  static async listResume(
    scope: WatchScope,
    limit: number,
    kinds: WatchKind[] = ['movie', 'episode']
  ): Promise<WatchStateRow[]> {
    const rows = await getDb().query<DbRow>(
      sql`SELECT * FROM watch_state
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND played = 0 AND position_ms > 0
           ORDER BY COALESCE(last_played_at, updated_at) DESC
           LIMIT ${Math.max(limit * 3, 30)}`
    );
    return filterKinds(rows.map(toRow), kinds).slice(0, limit);
  }

  /**
   * The furthest-through episode per series, for Next Up. Season and episode
   * break the tie, since an imported watched list gives every row of one show
   * the same timestamp.
   */
  static async listRecentSeries(
    scope: WatchScope,
    limit: number
  ): Promise<WatchStateRow[]> {
    const rows = await getDb().query<DbRow>(
      sql`SELECT * FROM watch_state
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND series_key IS NOT NULL
             AND (played = 1 OR position_ms > 0)
           ORDER BY COALESCE(last_played_at, updated_at) DESC,
                    season DESC, episode DESC
           LIMIT 500`
    );
    const seen = new Set<string>();
    const out: WatchStateRow[] = [];
    for (const r of rows.map(toRow)) {
      if (r.episode == null || !r.seriesKey) continue;
      if (seen.has(r.seriesKey)) continue;
      seen.add(r.seriesKey);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  static async listFavorites(
    scope: WatchScope,
    kinds?: WatchKind[]
  ): Promise<WatchStateRow[]> {
    const rows = await getDb().query<DbRow>(
      sql`SELECT * FROM watch_state
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND favorite = 1
           ORDER BY updated_at DESC
           LIMIT 500`
    );
    return filterKinds(rows.map(toRow), kinds);
  }

  static async listPlayed(
    scope: WatchScope,
    kinds?: WatchKind[]
  ): Promise<WatchStateRow[]> {
    const rows = await getDb().query<DbRow>(
      sql`SELECT * FROM watch_state
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND played = 1
           ORDER BY COALESCE(last_played_at, updated_at) DESC
           LIMIT 500`
    );
    return filterKinds(rows.map(toRow), kinds);
  }

  static async listForSeries(
    scope: WatchScope,
    seriesKey: string
  ): Promise<WatchStateRow[]> {
    const rows = await getDb().query<DbRow>(
      sql`SELECT * FROM watch_state
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND series_key = ${seriesKey}`
    );
    return rows.map(toRow).filter((r) => r.episode != null);
  }

  /**
   * Imported rows from one addon that this run did not touch. Swept per half,
   * because the halves arrive independently: sweeping both on a read that
   * carried only one would delete everything the other half owns.
   */
  static async deleteStaleImports(
    scope: WatchScope,
    sinkId: string,
    before: number,
    half: 'resume' | 'watched'
  ): Promise<number> {
    const playedValue = half === 'watched' ? 1 : 0;
    const res = await getDb().exec(
      sql`DELETE FROM watch_state
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND origin = 'import' AND sink_id = ${sinkId}
             AND updated_at < ${before}
             AND played = ${playedValue}
             AND favorite = 0`
    );
    return res.rowCount ?? 0;
  }

  static async prune(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const res = await getDb().exec(
      sql`DELETE FROM watch_state WHERE updated_at < ${cutoff}`
    );
    return res.rowCount ?? 0;
  }
}
