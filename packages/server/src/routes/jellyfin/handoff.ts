import type { Request } from 'express';
import {
  Cache,
  config as appConfig,
  createLogger,
  dispatchBulkMark,
  dispatchPlayback,
  dispatchWatchlist,
  ensurePlaybackSink,
  itemKeyFor,
  PlaybackHandoffRepository,
  providerIdsFor,
  refreshSinkIfStale,
  type ContentRef,
  type JellyfinItem,
  type PlaybackEventKind,
  type ResolvedPlaybackSink,
  type SinkStatus,
  type WatchStateRow,
} from '@aiostreams/core';
import {
  contextFromCredentials,
  personasOf,
  type JellyfinRequestContext,
} from './context.js';
import { itemFromDescriptor } from './items.js';

const logger = createLogger('jellyfin');

/** Derived from the resolved config, so it is keyed by the memo scope. */
const sinkCache = Cache.getInstance<string, ResolvedPlaybackSink[]>(
  'jellyfin-playback-sinks',
  500
);
const SINK_TTL_SECONDS = 300;

const sinkAddress = (sink: ResolvedPlaybackSink) =>
  `${sink.baseUrl}?${sink.query}`;

/**
 * A history of its own must not reach the primary user's trackers, so only
 * sinks the persona's variants added count. The same addon reached under both
 * configurations is the same tracker account.
 */
async function ownSinks(
  ctx: JellyfinRequestContext,
  sinks: ResolvedPlaybackSink[]
): Promise<ResolvedPlaybackSink[]> {
  if (!sinks.length) return [];
  const primary = new Set(
    (await ctx.primaryEngine()).getPlaybackSinks().map(sinkAddress)
  );
  return sinks.filter((sink) => !primary.has(sinkAddress(sink)));
}

async function sinksFor(
  ctx: JellyfinRequestContext
): Promise<ResolvedPlaybackSink[]> {
  const mode = !ctx.persona
    ? 'primary'
    : ctx.persona.history === 'shared'
      ? 'shared'
      : 'own';
  const key = `${ctx.scope()}|${mode}`;
  const cached = await sinkCache.get(key).catch(() => undefined);
  // A value that lost its `events` array in transit counts as a miss.
  if (cached?.every((sink) => Array.isArray(sink.events))) return cached;
  let sinks: ResolvedPlaybackSink[];
  if (mode === 'shared') {
    // Sharing the history means sharing its trackers, whatever its variants say.
    sinks = (await ctx.primaryEngine()).getPlaybackSinks();
  } else {
    sinks = (await ctx.engine()).getPlaybackSinks();
    if (mode === 'own') sinks = await ownSinks(ctx, sinks);
  }
  await sinkCache.set(key, sinks, SINK_TTL_SECONDS).catch(() => undefined);
  return sinks;
}

interface TrackerExchange {
  lastAt: number | null;
  error: string | null;
}

export interface TrackerStatus {
  addon: string;
  /** Absent for the primary user's trackers. */
  persona?: string;
  status: SinkStatus;
  /** Absent when the addon or this instance does not use that direction. */
  push?: TrackerExchange;
  pull?: TrackerExchange;
}

/**
 * Every tracker the saved configuration syncs with, found the way playback
 * finds them so an addon shows before its first exchange. A persona sharing the
 * primary user's history has no trackers of its own to list.
 */
export async function listTrackers(
  req: Request,
  uuid: string,
  encryptedPassword: string
): Promise<TrackerStatus[] | null> {
  const primary = await contextFromCredentials(req, uuid, encryptedPassword);
  if (!primary) return null;
  const personas = personasOf(primary.userData).filter(
    (p) => p.history !== 'shared'
  );
  const contexts = [
    primary,
    ...(await Promise.all(
      personas.map(async (p) => {
        const ctx = await contextFromCredentials(
          req,
          uuid,
          encryptedPassword,
          p.id
        );
        // The same engine a persona's own would build, built once for all.
        return ctx && { ...ctx, primaryEngine: primary.engine };
      })
    )),
  ].filter((ctx) => ctx !== null);

  const [resolved, rows] = await Promise.all([
    Promise.all(contexts.map((ctx) => sinksFor(ctx))),
    PlaybackHandoffRepository.listAllSinks(uuid),
  ]);
  const rowOf = new Map(
    rows.map((row) => [`${row.persona}|${row.addonInstanceId}`, row])
  );

  const { reportEnabled, pullEnabled } = appConfig.watchState;
  return contexts.flatMap((ctx, i) =>
    resolved[i].flatMap((sink): TrackerStatus[] => {
      const push = reportEnabled && sink.events.length > 0;
      const pull = pullEnabled && sink.pullable;
      if (!push && !pull) return [];
      const row = rowOf.get(`${ctx.watch.persona}|${sink.instanceId}`);
      return [
        {
          addon: sink.name,
          persona: ctx.persona?.id,
          status: row?.status ?? 'connected',
          push: push
            ? { lastAt: row?.lastPushAt ?? null, error: row?.lastError ?? null }
            : undefined,
          pull: pull
            ? {
                lastAt: row?.lastPullAt ?? null,
                error: row?.lastPullError ?? null,
              }
            : undefined,
        },
      ];
    })
  );
}

/**
 * A tracker keys on the show, so an episode reports the series item's ids and
 * never its own; the series meta is cached by the episode build.
 */
async function idsFor(
  ctx: JellyfinRequestContext,
  ref: ContentRef,
  item?: JellyfinItem | null
): Promise<Record<string, string>> {
  if (ref.episode == null) {
    const own = (item?.ProviderIds as Record<string, string> | undefined) ?? {};
    return Object.keys(own).length
      ? own
      : providerIdsFor({ id: ref.baseId, type: ref.type });
  }
  const series = await itemFromDescriptor(ctx, {
    k: 'series',
    t: ref.type,
    i: ref.baseId,
  }).catch(() => null);
  const parent =
    (series?.ProviderIds as Record<string, string> | undefined) ?? {};
  return Object.keys(parent).length
    ? parent
    : providerIdsFor({ id: ref.baseId, type: ref.type });
}

/** Never throws: a scrobble must not fail a client's playstate call. */
export async function reportPlayback(
  ctx: JellyfinRequestContext,
  kind: PlaybackEventKind,
  ref: ContentRef,
  opts: {
    row?: WatchStateRow | null;
    item?: JellyfinItem | null;
    positionMs?: number;
    durationMs?: number;
  } = {}
): Promise<void> {
  if (!appConfig.watchState.reportEnabled) return;
  try {
    const sinks = await sinksFor(ctx);
    if (!sinks.length) return;
    const providerIds = await idsFor(ctx, ref, opts.item);
    await dispatchPlayback(ctx.watch, sinks, {
      kind,
      type: ref.type,
      videoId: ref.videoId || ref.baseId,
      baseId: ref.baseId,
      itemKey: itemKeyFor(ref),
      season: ref.season,
      episode: ref.episode,
      // The row clears the position once it decides the item was played.
      positionMs: opts.positionMs ?? opts.row?.positionMs,
      durationMs: opts.durationMs || opts.row?.durationMs,
      played: opts.row ? opts.row.played : undefined,
      providerIds,
    });
  } catch (error) {
    // Warn, not debug: this is the whole reporting half failing.
    logger.warn(
      {
        event: kind,
        err: error instanceof Error ? error.message : String(error),
      },
      'failed to report playback to addons'
    );
  }
}

export async function reportWatchlist(
  ctx: JellyfinRequestContext,
  listed: boolean,
  ref: ContentRef,
  item?: JellyfinItem | null
): Promise<void> {
  if (!appConfig.watchState.reportEnabled) return;
  if (ref.kind === 'episode') return;
  try {
    const sinks = await sinksFor(ctx);
    if (!sinks.length) return;
    await dispatchWatchlist(ctx.watch, sinks, {
      kind: listed ? 'watchlisted' : 'unwatchlisted',
      type: ref.type,
      metaId: ref.baseId,
      itemKey: itemKeyFor(ref),
      providerIds: await idsFor(ctx, ref, item),
    });
  } catch (error) {
    logger.warn(
      {
        listed,
        err: error instanceof Error ? error.message : String(error),
      },
      'failed to report a watchlist change to addons'
    );
  }
}

/** A mark on a show or season, reported once rather than per episode. */
export async function reportBulkMark(
  ctx: JellyfinRequestContext,
  kind: 'played' | 'unplayed',
  target: { t: string; i: string; s?: number },
  episodes: ContentRef[],
  seriesItem?: JellyfinItem | null
): Promise<void> {
  const videos = episodes.flatMap((ref) =>
    ref.videoId
      ? [
          {
            videoId: ref.videoId,
            season: ref.season ?? null,
            episode: ref.episode ?? null,
            itemKey: itemKeyFor(ref),
          },
        ]
      : []
  );
  if (!appConfig.watchState.reportEnabled || !videos.length) return;
  try {
    const sinks = await sinksFor(ctx);
    if (!sinks.length) return;
    const own = seriesItem?.ProviderIds as Record<string, string> | undefined;
    await dispatchBulkMark(ctx.watch, sinks, {
      kind,
      type: target.t,
      metaId: target.i,
      scope: target.s == null ? 'series' : 'season',
      season: target.s ?? null,
      videos,
      providerIds:
        own && Object.keys(own).length
          ? own
          : providerIdsFor({ id: target.i, type: target.t }),
    });
  } catch (error) {
    logger.warn(
      {
        event: kind,
        err: error instanceof Error ? error.message : String(error),
      },
      'failed to report a bulk mark to addons'
    );
  }
}

/*
 * Shelves are drawn together, so one pass per history per window is enough;
 * other instances are held off by the pull claim.
 */
const refreshedAt = new Map<string, number>();
const REFRESH_DEDUPE_MS = 5_000;
const REFRESH_KEYS_MAX = 20_000;

/** Never awaited: a shelf answers from what is stored, never from the addon. */
export function refreshWatchState(ctx: JellyfinRequestContext): void {
  if (!appConfig.watchState.pullEnabled) return;
  const key = `${ctx.watch.uuid}|${ctx.watch.persona}`;
  const now = Date.now();
  const last = refreshedAt.get(key);
  if (last !== undefined && now - last < REFRESH_DEDUPE_MS) return;
  if (refreshedAt.size >= REFRESH_KEYS_MAX) refreshedAt.clear();
  refreshedAt.set(key, now);
  void (async () => {
    // From the configuration, not the database: a config that only reads never
    // dispatches, so no sink row would ever appear on its own.
    for (const sink of await sinksFor(ctx)) {
      if (!sink.pullable) continue;
      refreshSinkIfStale(await ensurePlaybackSink(ctx.watch, sink));
    }
  })().catch((error) => {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'failed to refresh watch state'
    );
  });
}
