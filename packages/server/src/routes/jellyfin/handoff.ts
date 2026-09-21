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
  retireOtherPersonaSinks,
  retireUnusedSinks,
  type AIOStreams,
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

type HistoryMode = 'primary' | 'shared' | 'own';

function modeOf(ctx: JellyfinRequestContext): HistoryMode {
  if (!ctx.persona) return 'primary';
  return ctx.persona.history === 'shared' ? 'shared' : 'own';
}

function picked(
  sinks: ResolvedPlaybackSink[],
  presets: readonly string[]
): ResolvedPlaybackSink[] {
  return sinks.filter(
    (sink) => sink.presetId !== undefined && presets.includes(sink.presetId)
  );
}

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

function pickedByOthers(ctx: JellyfinRequestContext): Set<string> {
  const presets = new Set(ctx.userData.jellyfin?.primary?.trackers);
  for (const persona of personasOf(ctx.userData)) {
    if (persona.id === ctx.persona?.id || persona.history === 'shared')
      continue;
    for (const id of persona.trackers ?? []) presets.add(id);
  }
  return presets;
}

/** A tracker that failed to load keeps its row; an outage is not giving it up. */
function unloaded(
  engine: AIOStreams,
  presets: readonly string[] | undefined
): string[] {
  return engine
    .getFailedAddons()
    .filter((addon) => !presets || presets.includes(addon.preset.id))
    .flatMap((addon) => (addon.instanceId ? [addon.instanceId] : []));
}

/**
 * Each tracker account belongs to one history. A user's explicit list is what
 * it claims; left on automatic, the primary user takes every tracker and a
 * persona of its own history only what its variants added.
 */
async function resolveSinks(
  ctx: JellyfinRequestContext,
  mode: HistoryMode
): Promise<{ sinks: ResolvedPlaybackSink[]; unloaded: string[] }> {
  const primaryPicks = ctx.userData.jellyfin?.primary?.trackers;
  if (mode !== 'own') {
    // Sharing the history means sharing its trackers, whatever its variants say.
    const primary = await ctx.primaryEngine();
    const all = primary.getPlaybackSinks();
    return {
      sinks: primaryPicks ? picked(all, primaryPicks) : all,
      unloaded: unloaded(primary, primaryPicks),
    };
  }
  const engine = await ctx.engine();
  const own = engine.getPlaybackSinks();
  const picks = ctx.persona?.trackers;
  if (picks) {
    let sinks = picked(own, picks);
    if (!primaryPicks && sinks.length) {
      const held = new Set(
        (await ctx.primaryEngine()).getPlaybackSinks().map((s) => s.presetId)
      );
      sinks = sinks.filter((sink) => !held.has(sink.presetId));
    }
    return { sinks, unloaded: unloaded(engine, picks) };
  }
  const taken = pickedByOthers(ctx);
  const sinks = (await ownSinks(ctx, own)).filter(
    (sink) => sink.presetId === undefined || !taken.has(sink.presetId)
  );
  return { sinks, unloaded: unloaded(engine, undefined) };
}

async function sinksFor(
  ctx: JellyfinRequestContext
): Promise<ResolvedPlaybackSink[]> {
  const mode = modeOf(ctx);
  // Personas without variants share a scope but not their trackers.
  const key = `${ctx.scope()}|${mode}|${ctx.persona?.id ?? ''}`;
  const cached = await sinkCache.get(key).catch(() => undefined);
  // A value that lost its `events` array in transit counts as a miss.
  if (cached?.every((sink) => Array.isArray(sink.events))) return cached;
  const resolved = await resolveSinks(ctx, mode);
  const sinks = resolved.sinks.slice(0, appConfig.watchState.maxSinks);
  const unloaded = resolved.unloaded;
  await retireUnusedSinks(ctx.watch, [
    ...sinks.map((sink) => sink.instanceId),
    ...unloaded,
  ]).catch((error) => {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'failed to retire unused trackers'
    );
  });
  await sinkCache.set(key, sinks, SINK_TTL_SECONDS).catch(() => undefined);
  return sinks;
}

/** The primary user, then each persona with a history of its own. */
async function historyContexts(
  req: Request,
  uuid: string,
  encryptedPassword: string
): Promise<JellyfinRequestContext[] | null> {
  const primary = await contextFromCredentials(req, uuid, encryptedPassword);
  if (!primary) return null;
  const personas = personasOf(primary.userData).filter(
    (p) => p.history !== 'shared'
  );
  return [
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
}

/** Retires what each history gave up now, rather than on its next use days away. */
export async function syncTrackerClaims(
  req: Request,
  uuid: string,
  encryptedPassword: string
): Promise<void> {
  const contexts = await historyContexts(req, uuid, encryptedPassword);
  if (!contexts) return;
  await Promise.all(contexts.map((ctx) => sinksFor(ctx)));
  await retireOtherPersonaSinks(
    uuid,
    contexts.flatMap((ctx) => (ctx.persona ? [ctx.persona.id] : []))
  );
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

export interface TrackerOption {
  /** Empty for the primary user. */
  user: string;
  presetId: string;
  addon: string;
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
): Promise<{ trackers: TrackerStatus[]; available: TrackerOption[] } | null> {
  const contexts = await historyContexts(req, uuid, encryptedPassword);
  if (!contexts) return null;

  const [resolved, rows, engines] = await Promise.all([
    Promise.all(contexts.map((ctx) => sinksFor(ctx))),
    PlaybackHandoffRepository.listAllSinks(uuid),
    Promise.all(contexts.map((ctx) => ctx.engine())),
  ]);
  const rowOf = new Map(
    rows.map((row) => [`${row.persona}|${row.addonInstanceId}`, row])
  );

  const { reportEnabled, pullEnabled } = appConfig.watchState;
  const exchanges = (sink: ResolvedPlaybackSink) => ({
    push: reportEnabled && sink.events.length > 0,
    pull: pullEnabled && sink.pullable,
  });
  const trackers = contexts.flatMap((ctx, i) =>
    resolved[i].flatMap((sink): TrackerStatus[] => {
      const { push, pull } = exchanges(sink);
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
  const available = contexts.flatMap((ctx, i) => {
    const seen = new Set<string>();
    return engines[i].getPlaybackSinks().flatMap((sink): TrackerOption[] => {
      const { push, pull } = exchanges(sink);
      if ((!push && !pull) || !sink.presetId || seen.has(sink.presetId))
        return [];
      seen.add(sink.presetId);
      return [
        {
          user: ctx.persona?.id ?? '',
          presetId: sink.presetId,
          addon: sink.name,
        },
      ];
    });
  });
  return { trackers, available };
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
