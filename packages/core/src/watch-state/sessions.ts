import { createHash } from 'node:crypto';
import { config as appConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import {
  WatchSessionRepository,
  type WatchSessionRow,
} from '../db/repositories/watch-sessions.js';
import { PlaybackHandoffRepository } from '../db/repositories/playback-handoff.js';
import { dispatchPlayback } from './handoff/dispatch.js';
import type { ResolvedPlaybackSink } from './handoff/resolve.js';
import type { PlaybackEventKind } from './handoff/capability.js';
import { getWatchStateProvider } from './index.js';
import {
  identityFor,
  scopeOf,
  type ContentRef,
  type WatchScope,
} from './types.js';

const logger = createLogger('watch-sessions');

const SWEEP_BATCH = 200;
/** Long enough to absorb a stop that arrives after the sweep closed the row. */
const CLOSED_RETENTION_MS = 6 * 3600_000;

/** Hashed because both parts come from request headers. */
export function sessionKeyFor(client: {
  name?: string;
  deviceId?: string;
}): string {
  return createHash('sha1')
    .update(`${client.name ?? ''}|${client.deviceId ?? ''}`)
    .digest('hex')
    .slice(0, 24);
}

export interface SessionContext {
  scope: WatchScope;
  sessionKey: string;
  client?: { name?: string; device?: string; deviceId?: string };
  playSessionId?: string;
}

export async function openWatchSession(
  ctx: SessionContext,
  ref: ContentRef,
  opts: { positionMs?: number; durationMs?: number; paused?: boolean } = {}
): Promise<void> {
  const identity = identityFor(ref);
  await WatchSessionRepository.open(ctx.scope, ctx.sessionKey, {
    itemKey: identity.itemKey,
    kind: identity.kind,
    mediaType: identity.mediaType,
    baseId: identity.baseId,
    season: identity.season,
    episode: identity.episode,
    videoId: identity.videoId,
    playSessionId: ctx.playSessionId ?? null,
    deviceId: ctx.client?.deviceId ?? null,
    client: ctx.client?.name ?? null,
    positionMs: opts.positionMs ?? 0,
    durationMs: opts.durationMs ?? 0,
    paused: opts.paused ?? false,
  });
}

/** The returned transition is set only on a pause edge, not on every tick. */
export async function checkInWatchSession(
  ctx: SessionContext,
  patch: { positionMs?: number; durationMs?: number; paused?: boolean }
): Promise<{
  transition: 'pause' | 'start' | null;
  row: WatchSessionRow | null;
}> {
  const existing = await WatchSessionRepository.get(ctx.scope, ctx.sessionKey);
  const at = Date.now();
  await WatchSessionRepository.checkIn(ctx.scope, ctx.sessionKey, at, patch);

  if (!existing || existing.endedAt != null || patch.paused == null) {
    return { transition: null, row: existing };
  }
  if (existing.paused === patch.paused)
    return { transition: null, row: existing };
  return { transition: patch.paused ? 'pause' : 'start', row: existing };
}

export async function closeWatchSession(ctx: SessionContext): Promise<void> {
  await WatchSessionRepository.close(ctx.scope, ctx.sessionKey, Date.now());
}

/** Rebuilds the routing a stop needs from the sink row, with no config in hand. */
function sinkFromRow(row: {
  addonInstanceId: string;
  addonName: string | null;
  baseUrl: string;
  query: string;
  events: string[];
  types: string[];
  idPrefixes: string[] | null;
  pullUrl: string | null;
}): ResolvedPlaybackSink {
  return {
    instanceId: row.addonInstanceId,
    name: row.addonName ?? row.addonInstanceId,
    baseUrl: row.baseUrl,
    query: row.query,
    events: new Set(row.events as PlaybackEventKind[]),
    pullable: !!row.pullUrl,
    types: row.types,
    idPrefixes: row.idPrefixes ?? undefined,
  };
}

/**
 * Closes playbacks nothing has reported on for a while, at the last position the
 * client sent. A client that dies never sends a stop, so without this the title
 * never leaves Continue Watching and never scrobbles. Pausing is safe: clients
 * keep reporting progress while paused.
 */
export async function sweepIdleWatchSessions(): Promise<{
  closed: number;
  reported: number;
}> {
  const idleMs = appConfig.watchState.sessionIdleTimeout * 1000;
  const rows = await WatchSessionRepository.listIdle(
    Date.now() - idleMs,
    SWEEP_BATCH
  );
  let closed = 0;
  let reported = 0;

  for (const session of rows) {
    const at = Date.now();
    const scope = scopeOf(session);
    try {
      const ref: ContentRef = {
        kind: session.kind,
        type: session.mediaType,
        baseId: session.baseId,
        season: session.season,
        episode: session.episode,
        videoId: session.videoId,
      };
      const row = await getWatchStateProvider().record(scope, {
        type: 'stop',
        identity: identityFor(ref),
        positionMs: session.positionMs,
        durationMs: session.durationMs || undefined,
      });
      await WatchSessionRepository.close(scope, session.sessionKey, at);
      closed++;

      if (!appConfig.watchState.reportEnabled) continue;
      const sinks = await PlaybackHandoffRepository.listSinks(scope);
      if (!sinks.length) continue;
      await dispatchPlayback(scope, sinks.map(sinkFromRow), {
        kind: 'stop',
        type: session.mediaType,
        videoId: session.videoId || session.baseId,
        baseId: session.baseId,
        itemKey: session.itemKey,
        season: session.season,
        episode: session.episode,
        at,
        positionMs: session.positionMs,
        durationMs: session.durationMs || undefined,
        played: row ? row.played : undefined,
      });
      reported++;
    } catch (error) {
      logger.warn(
        {
          uuid: session.uuid,
          persona: session.persona,
          itemKey: session.itemKey,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to close an idle playback'
      );
    }
  }

  await WatchSessionRepository.pruneClosed(Date.now() - CLOSED_RETENTION_MS);

  if (closed)
    logger.info(
      { closed, reported },
      'closed playbacks that stopped reporting'
    );
  return { closed, reported };
}
