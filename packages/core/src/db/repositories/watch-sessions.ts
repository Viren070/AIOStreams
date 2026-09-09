import { getDb } from '../db.js';
import { sql } from '../sql.js';
import type { WatchKind } from './watch-state.js';
import type { WatchScope } from '../../watch-state/types.js';

/**
 * One open playback per client. Persisted rather than held in memory: the
 * process restarts under a running playback, and the sweep runs on one replica
 * which may not be the one that served the progress reports.
 */
export interface WatchSessionRow {
  uuid: string;
  persona: string;
  sessionKey: string;
  itemKey: string;
  kind: WatchKind;
  mediaType: string;
  baseId: string;
  season: number | null;
  episode: number | null;
  videoId: string | null;
  playSessionId: string | null;
  deviceId: string | null;
  client: string | null;
  positionMs: number;
  durationMs: number;
  paused: boolean;
  startedAt: number;
  lastCheckinAt: number;
  endedAt: number | null;
}

export interface WatchSessionUpsert {
  itemKey: string;
  kind: WatchKind;
  mediaType: string;
  baseId: string;
  season?: number | null;
  episode?: number | null;
  videoId?: string | null;
  playSessionId?: string | null;
  deviceId?: string | null;
  client?: string | null;
  positionMs?: number;
  durationMs?: number;
  paused?: boolean;
}

interface DbRow {
  uuid: string;
  persona: string;
  session_key: string;
  item_key: string;
  kind: string;
  media_type: string;
  base_id: string;
  season: number | string | null;
  episode: number | string | null;
  video_id: string | null;
  play_session_id: string | null;
  device_id: string | null;
  client: string | null;
  position_ms: number | string;
  duration_ms: number | string;
  paused: number | string;
  started_at: number | string;
  last_checkin_at: number | string;
  ended_at: number | string | null;
  [k: string]: unknown;
}

function optionalNumber(v: number | string | null): number | null {
  return v == null ? null : Number(v);
}

function toRow(r: DbRow): WatchSessionRow {
  return {
    uuid: r.uuid,
    persona: r.persona,
    sessionKey: r.session_key,
    itemKey: r.item_key,
    kind: r.kind as WatchKind,
    mediaType: r.media_type,
    baseId: r.base_id,
    season: optionalNumber(r.season),
    episode: optionalNumber(r.episode),
    videoId: r.video_id,
    playSessionId: r.play_session_id,
    deviceId: r.device_id,
    client: r.client,
    positionMs: Number(r.position_ms),
    durationMs: Number(r.duration_ms),
    paused: Boolean(Number(r.paused)),
    startedAt: Number(r.started_at),
    lastCheckinAt: Number(r.last_checkin_at),
    endedAt: optionalNumber(r.ended_at),
  };
}

export class WatchSessionRepository {
  static async get(
    scope: WatchScope,
    sessionKey: string
  ): Promise<WatchSessionRow | null> {
    const row = await getDb().maybeOne<DbRow>(
      sql`SELECT * FROM watch_sessions
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND session_key = ${sessionKey}`
    );
    return row ? toRow(row) : null;
  }

  /** Switching item under the same key is a new playback, so timings reset. */
  static async open(
    scope: WatchScope,
    sessionKey: string,
    input: WatchSessionUpsert
  ): Promise<void> {
    const now = Date.now();
    await getDb().exec(
      sql`INSERT INTO watch_sessions
            (uuid, persona, session_key, item_key, kind, media_type, base_id,
             season, episode, video_id, play_session_id, device_id, client,
             position_ms, duration_ms, paused, started_at, last_checkin_at,
             ended_at)
          VALUES (${scope.uuid}, ${scope.persona}, ${sessionKey},
                  ${input.itemKey}, ${input.kind}, ${input.mediaType},
                  ${input.baseId}, ${input.season ?? null},
                  ${input.episode ?? null}, ${input.videoId ?? null},
                  ${input.playSessionId ?? null}, ${input.deviceId ?? null},
                  ${input.client ?? null}, ${input.positionMs ?? 0},
                  ${input.durationMs ?? 0}, ${input.paused ? 1 : 0},
                  ${now}, ${now}, NULL)
          ON CONFLICT(uuid, persona, session_key) DO UPDATE SET
            item_key = excluded.item_key,
            kind = excluded.kind,
            media_type = excluded.media_type,
            base_id = excluded.base_id,
            season = excluded.season,
            episode = excluded.episode,
            video_id = excluded.video_id,
            play_session_id = COALESCE(excluded.play_session_id, watch_sessions.play_session_id),
            device_id = COALESCE(excluded.device_id, watch_sessions.device_id),
            client = COALESCE(excluded.client, watch_sessions.client),
            position_ms = excluded.position_ms,
            duration_ms = CASE WHEN excluded.duration_ms > 0
                               THEN excluded.duration_ms ELSE watch_sessions.duration_ms END,
            paused = excluded.paused,
            started_at = CASE WHEN watch_sessions.item_key = excluded.item_key
                                   AND watch_sessions.ended_at IS NULL
                              THEN watch_sessions.started_at ELSE excluded.started_at END,
            last_checkin_at = excluded.last_checkin_at,
            ended_at = NULL`
    );
  }

  /** A closed session stays closed, so a late tick cannot reopen it. */
  static async checkIn(
    scope: WatchScope,
    sessionKey: string,
    at: number,
    patch: { positionMs?: number; durationMs?: number; paused?: boolean }
  ): Promise<void> {
    const pos = patch.positionMs ?? null;
    const dur =
      patch.durationMs && patch.durationMs > 0 ? patch.durationMs : null;
    const paused = patch.paused == null ? null : patch.paused ? 1 : 0;
    await getDb().exec(
      sql`UPDATE watch_sessions SET
            last_checkin_at = ${at},
            position_ms = COALESCE(${pos}, position_ms),
            duration_ms = COALESCE(${dur}, duration_ms),
            paused = COALESCE(${paused}, paused)
          WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
            AND session_key = ${sessionKey} AND ended_at IS NULL`
    );
  }

  static async close(
    scope: WatchScope,
    sessionKey: string,
    at: number
  ): Promise<void> {
    await getDb().exec(
      sql`UPDATE watch_sessions SET ended_at = ${at}, last_checkin_at = ${at}
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND session_key = ${sessionKey}`
    );
  }

  /** Open sessions that have not checked in since `before`. */
  static async listIdle(
    before: number,
    limit: number
  ): Promise<WatchSessionRow[]> {
    const rows = await getDb().query<DbRow>(
      sql`SELECT * FROM watch_sessions
           WHERE ended_at IS NULL AND last_checkin_at < ${before}
           ORDER BY last_checkin_at ASC
           LIMIT ${limit}`
    );
    return rows.map(toRow);
  }

  /** Closed sessions are kept only long enough to absorb a late duplicate stop. */
  static async pruneClosed(olderThan: number): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM watch_sessions
           WHERE ended_at IS NOT NULL AND ended_at < ${olderThan}`
    );
    return res.rowCount ?? 0;
  }
}
