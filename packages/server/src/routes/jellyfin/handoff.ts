import {
  Cache,
  config as appConfig,
  createLogger,
  dispatchPlayback,
  ensurePlaybackSink,
  itemKeyFor,
  providerIdsFor,
  refreshSinkIfStale,
  type ContentRef,
  type JellyfinItem,
  type PlaybackEventKind,
  type ResolvedPlaybackSink,
  type WatchStateRow,
} from '@aiostreams/core';
import type { JellyfinRequestContext } from './context.js';
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
  if (cached) return cached;
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

/**
 * A tracker keys on the show. An episode item carries no `ProviderIds`, so the
 * series item supplies them; its meta is cached by the episode build.
 */
async function idsFor(
  ctx: JellyfinRequestContext,
  ref: ContentRef,
  item?: JellyfinItem | null
): Promise<Record<string, string>> {
  const own = (item?.ProviderIds as Record<string, string> | undefined) ?? {};
  if (ref.episode == null) {
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
  const merged = { ...parent, ...own };
  return Object.keys(merged).length
    ? merged
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
    logger.debug(
      {
        event: kind,
        err: error instanceof Error ? error.message : String(error),
      },
      'failed to report playback to addons'
    );
  }
}

/** Never awaited: a shelf answers from what is stored, never from the addon. */
export function refreshWatchState(ctx: JellyfinRequestContext): void {
  if (!appConfig.watchState.pullEnabled) return;
  void (async () => {
    // From the configuration, not the database: a config that only reads never
    // dispatches, so no sink row would ever appear on its own.
    for (const sink of await sinksFor(ctx)) {
      if (!sink.pullable) continue;
      refreshSinkIfStale(await ensurePlaybackSink(ctx.watch, sink));
    }
  })().catch((error) => {
    logger.debug(
      { err: error instanceof Error ? error.message : String(error) },
      'failed to refresh watch state'
    );
  });
}
