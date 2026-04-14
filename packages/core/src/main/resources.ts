import pLimit from 'p-limit';
import {
  createLogger,
  constants,
  Env,
  ExtrasParser,
  makeUrlLogSafe,
} from '../utils/index.js';
import { getAddonName } from '../utils/general.js';
import { Wrapper } from './wrapper.js';
import { PresetManager } from '../presets/index.js';
import { FeatureControl } from '../utils/feature.js';
import { StreamContext, StreamUtils } from '../streams/index.js';
import { populateNzbFallbacks } from './nzbFailover.js';
import { resolveServiceWrappedStreams } from './serviceWrapper.js';
import type { ServiceWrapServiceTiming } from './serviceWrapper.js';
import type { PrecomputeSubTimings } from '../streams/precomputer.js';
import { StreamSelector } from '../parser/streamExpression.js';
import type {
  ParsedMeta,
  ParsedStream,
  Subtitle,
  AddonCatalog,
} from '../db/schemas.js';
import type { Addon } from '../db/index.js';
import type { Metadata } from '../metadata/utils.js';
import type {
  AIOStreamsContext,
  AIOStreamsError,
  AIOStreamsResponse,
} from './types.js';
import { buildStatistics } from './statistics.js';
import { precacheCache } from './caches.js';
import {
  applyPosterModifications,
  convertDiscoverDeepLinks,
} from './catalog.js';

const logger = createLogger('core');

const PING_TIMEOUT_MS = 10_000;

async function pingStream(stream: ParsedStream, timeoutMs = PING_TIMEOUT_MS) {
  if (!stream.url) {
    throw new Error('pingStream: stream has no URL');
  }
  const wrapper = new Wrapper(stream.addon);
  return wrapper.makeRequest(stream.url, {
    timeout: timeoutMs,
    rawOptions: { redirect: 'manual' },
  });
}

async function pingStreamUrls(streams: ParsedStream[]): Promise<void> {
  const eligible = streams.filter((s) => s.url);
  if (eligible.length === 0) {
    logger.debug('No streams to ping');
    return;
  }
  logger.info(`Pinging ${eligible.length} stream URLs`);
  const limit = pLimit(Env.PRELOAD_STREAMS_CONCURRENCY);
  await Promise.all(
    eligible.map((stream) =>
      limit(async () => {
        try {
          const response = await pingStream(stream);
          response.body?.cancel().catch(() => undefined);
          logger.debug('Ping request sent', {
            url: makeUrlLogSafe(stream.url!),
            status: response.status,
            redirectHost: (() => {
              const location = response.headers.get('location');
              if (!location) return 'no redirect';
              try {
                return new URL(location).host;
              } catch {
                return 'invalid URL';
              }
            })(),
          });
        } catch (error) {
          logger.debug('Ping request failed', {
            url: makeUrlLogSafe(stream.url!),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    )
  );
}

/**
 * Returns all addons that support the given resource name, type, and id.
 * An addon is included if it has a matching resource where either:
 *  - it declares idPrefixes and at least one matches the id, or
 *  - it declares no idPrefixes (accepts all ids)
 */
function getAddonsForResource(
  ctx: Pick<AIOStreamsContext, 'supportedResources' | 'addons'>,
  resourceName: string,
  type: string,
  id: string
): Addon[] {
  const addons: Addon[] = [];
  for (const [instanceId, resources] of Object.entries(
    ctx.supportedResources
  )) {
    const supported = resources.find(
      (r) =>
        r.name === resourceName &&
        r.types.includes(type) &&
        (r.idPrefixes ? r.idPrefixes.some((p) => id.startsWith(p)) : true)
    );
    if (supported) {
      const addon = ctx.addons.find((a) => a.instanceId === instanceId);
      if (addon) addons.push(addon);
    }
  }
  return addons;
}

/**
 * Returns candidate addons for a meta request in two priority tiers:
 *  1. Addons with a matching idPrefix (tried first, errors are reported)
 *  2. Addons with general type support and no idPrefixes (fallback, errors are silently skipped)
 */
function getMetaCandidates(
  ctx: Pick<AIOStreamsContext, 'supportedResources' | 'addons'>,
  type: string,
  id: string
): Array<{
  addon: Addon;
  instanceId: string;
  reason: 'matching id prefix' | 'general type support';
}> {
  const results: Array<{
    addon: Addon;
    instanceId: string;
    reason: 'matching id prefix' | 'general type support';
  }> = [];

  for (const [instanceId, resources] of Object.entries(
    ctx.supportedResources
  )) {
    if (
      resources.find(
        (r) =>
          r.name === 'meta' &&
          r.types.includes(type) &&
          r.idPrefixes?.some((p) => id.startsWith(p))
      )
    ) {
      const addon = ctx.addons.find((a) => a.instanceId === instanceId);
      if (addon)
        results.push({ addon, instanceId, reason: 'matching id prefix' });
    }
  }

  for (const [instanceId, resources] of Object.entries(
    ctx.supportedResources
  )) {
    if (results.some((r) => r.instanceId === instanceId)) continue;
    if (
      resources.find(
        (r) =>
          r.name === 'meta' && r.types.includes(type) && !r.idPrefixes?.length
      )
    ) {
      const addon = ctx.addons.find((a) => a.instanceId === instanceId);
      if (addon)
        results.push({ addon, instanceId, reason: 'general type support' });
    }
  }

  return results;
}

function applyModifications(
  ctx: AIOStreamsContext,
  streams: ParsedStream[]
): ParsedStream[] {
  if (ctx.userData.randomiseResults) {
    streams.sort(() => Math.random() - 0.5);
  }
  if (ctx.userData.enhanceResults) {
    streams.forEach((stream) => {
      if (Math.random() < 0.4) {
        stream.filename = undefined;
        stream.parsedFile = undefined;
        stream.type = 'youtube';
        stream.ytId = Buffer.from(constants.DEFAULT_YT_ID, 'base64').toString(
          'utf-8'
        );
        stream.message =
          'This stream has been artificially enhanced using the best AI on the market.';
      }
    });
  }
  return streams;
}

function getNextEpisode(
  currentSeason: number | undefined,
  currentEpisode: number,
  metadata?: Metadata
): { season: number | undefined; episode: number } {
  let season = currentSeason;
  let episode = currentEpisode + 1;
  if (!currentSeason) return { season, episode };
  const episodeCount = metadata?.seasons?.find(
    (s) => s.season_number === season
  )?.episode_count;

  if (episodeCount && currentEpisode === episodeCount) {
    const nextSeasonNumber = currentSeason + 1;
    if (metadata?.seasons?.find((s) => s.season_number === nextSeasonNumber)) {
      logger.debug(
        `Current episode is the last of season ${currentSeason}, moving to S${nextSeasonNumber}E01.`
      );
      season = nextSeasonNumber;
      episode = 1;
    }
  }
  return { season, episode };
}

export async function processStreams(
  ctx: AIOStreamsContext,
  streams: ParsedStream[],
  context: StreamContext,
  isMeta: boolean = false,
  nzbFailoverOpts?: {
    count: number;
    position: 'beforeLimiting' | 'beforeSEL' | 'last';
  }
): Promise<{
  streams: ParsedStream[];
  errors: AIOStreamsError[];
  timings: {
    metaFilterMs: number;
    serviceWrapMs: number;
    serviceWrapTimings?: Record<string, ServiceWrapServiceTiming>;
    filterMs: number;
    deduplicationMs: number;
    precomputeMs: number;
    precomputeSubTimings?: PrecomputeSubTimings;
    sortMs: number;
    limitMs: number;
    selMs: number;
  };
}> {
  const { type, id } = context;
  let processedStreams = streams;
  let errors: AIOStreamsError[] = [];

  let metaFilterMs = 0;
  let serviceWrapMs = 0;
  let serviceWrapTimings: Record<string, ServiceWrapServiceTiming> | undefined;
  let filterMs = 0;
  let deduplicationMs = 0;
  let precomputeMs = 0;
  let precomputeSubTimings: PrecomputeSubTimings | undefined;
  let sortMs = 0;
  let limitMs = 0;
  let selMs = 0;

  if (isMeta) {
    await ctx.precomputer.precomputeSeaDexOnly(processedStreams, context);
    const metaFilterStart = Date.now();
    processedStreams = await ctx.filterer.filter(processedStreams, context);
    metaFilterMs = Date.now() - metaFilterStart;
  }

  const preServiceWrapIds = new Set(processedStreams.map((s) => s.id));
  const serviceWrapStart = Date.now();
  const resolvedResults = await resolveServiceWrappedStreams(
    processedStreams,
    context,
    ctx.userData,
    ctx.addons
  );
  serviceWrapMs = Date.now() - serviceWrapStart;
  processedStreams = resolvedResults.streams;
  errors.push(...resolvedResults.errors);
  if (resolvedResults.serviceTimings) {
    serviceWrapTimings = resolvedResults.serviceTimings;
  }

  if (resolvedResults.hasNewStreams) {
    const filterStart = Date.now();
    processedStreams = await ctx.filterer.filter(processedStreams, context);
    filterMs = Date.now() - filterStart;
  }

  const dedupStart = Date.now();
  processedStreams = await ctx.deduplicator.deduplicate(processedStreams);
  deduplicationMs = Date.now() - dedupStart;

  if (isMeta || resolvedResults.hasNewStreams) {
    const skipPerStreamIds =
      !isMeta && resolvedResults.hasNewStreams ? preServiceWrapIds : undefined;
    const precomputeStart = Date.now();
    precomputeSubTimings = await ctx.precomputer.precomputePreferred(
      processedStreams,
      context,
      skipPerStreamIds
    );
    precomputeMs = Date.now() - precomputeStart;
  }

  const sortStart = Date.now();
  let finalStreams = await ctx.sorter.sort(processedStreams, context);
  sortMs = Date.now() - sortStart;

  if (nzbFailoverOpts?.position === 'beforeLimiting') {
    await populateNzbFallbacks(
      finalStreams,
      nzbFailoverOpts.count,
      ctx.userData.uuid
    ).catch((error) => {
      logger.error('Error during NZB failover population (beforeLimiting):', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  const limitStart = Date.now();
  finalStreams = await ctx.limiter.limit(finalStreams);
  limitMs = Date.now() - limitStart;

  if (nzbFailoverOpts?.position === 'beforeSEL') {
    await populateNzbFallbacks(
      finalStreams,
      nzbFailoverOpts.count,
      ctx.userData.uuid
    ).catch((error) => {
      logger.error('Error during NZB failover population (beforeSEL):', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  const selStart = Date.now();
  finalStreams = await ctx.filterer.applyStreamExpressionFilters(
    finalStreams,
    context
  );
  selMs = Date.now() - selStart;

  if (!nzbFailoverOpts?.position || nzbFailoverOpts.position === 'last') {
    if (nzbFailoverOpts) {
      await populateNzbFallbacks(
        finalStreams,
        nzbFailoverOpts.count,
        ctx.userData.uuid
      ).catch((error) => {
        logger.error('Error during NZB failover population (last):', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  ctx.filterer.generateFilterSummary(streams, finalStreams, type, id);

  const { streams: proxiedStreams, error } =
    await ctx.proxifier.proxify(finalStreams);

  if (error) {
    errors.push({ title: `Proxifier Error`, description: error });
  }
  finalStreams = applyModifications(ctx, proxiedStreams).map((stream) => {
    if (stream.parsedFile) {
      stream.parsedFile.visualTags = stream.parsedFile.visualTags.filter(
        (tag) => !constants.FAKE_VISUAL_TAGS.includes(tag as any)
      );
      stream.parsedFile.languages = stream.parsedFile.languages.filter(
        (lang) => !['Original'].includes(lang as any)
      );
    }
    return stream;
  });

  if (ctx.userData.externalDownloads) {
    const streamsWithExternalDownloads: ParsedStream[] = [];
    for (const stream of finalStreams) {
      streamsWithExternalDownloads.push(stream);
      if (stream.url) {
        streamsWithExternalDownloads.push(
          StreamUtils.createDownloadableStream(stream)
        );
      }
    }
    logger.info(
      `Added ${streamsWithExternalDownloads.length - finalStreams.length} external downloads to streams`
    );
    finalStreams = streamsWithExternalDownloads;
  }

  return {
    streams: finalStreams,
    errors,
    timings: {
      metaFilterMs,
      serviceWrapMs,
      serviceWrapTimings,
      filterMs,
      deduplicationMs,
      precomputeMs,
      precomputeSubTimings,
      sortMs,
      limitMs,
      selMs,
    },
  };
}

async function precacheNextEpisode(
  ctx: AIOStreamsContext,
  context: StreamContext
): Promise<void> {
  const { type, id, parsedId } = context;
  if (!parsedId) return;

  const currentSeason = parsedId.season ? Number(parsedId.season) : undefined;
  const currentEpisode = parsedId.episode
    ? Number(parsedId.episode)
    : undefined;
  if (!currentEpisode) return;

  const metadata = await context.getMetadata();
  const { season: seasonToPrecache, episode: episodeToPrecache } =
    getNextEpisode(currentSeason, currentEpisode, metadata);

  const precacheId = parsedId.generator(
    parsedId.value,
    seasonToPrecache?.toString(),
    episodeToPrecache?.toString()
  );
  logger.info(`Pre-caching next episode`, {
    titleId: parsedId.value,
    currentSeason,
    currentEpisode,
    episodeToPrecache,
    seasonToPrecache,
    precacheId,
  });

  // Temporarily mutate userData to remove excludeUncached filter for background precache.
  // Preserve original to restore after getStreams returns.
  const originalUserData = ctx.userData;
  const userData = structuredClone(ctx.userData);
  userData.excludeUncached = false;
  userData.groups = undefined;
  userData.dynamicAddonFetching = { enabled: false };
  ctx.userData = userData;

  const nextStreamsResponse = await getStreams(ctx, precacheId, type, true);
  ctx.userData = originalUserData;

  if (!nextStreamsResponse.success) {
    logger.error(`Failed to get streams during precaching ${id}`, {
      error: nextStreamsResponse.errors,
    });
    return;
  }

  const nextStreams = nextStreamsResponse.data.streams;

  let selectedStreams: ParsedStream[] = [];
  const selector =
    ctx.userData.precacheSelector || constants.DEFAULT_PRECACHE_SELECTOR;
  try {
    const streamSelector = new StreamSelector(context.toExpressionContext());
    selectedStreams = await streamSelector.select(nextStreams, selector);
    logger.debug(`Precache selector evaluated`, {
      selector,
      resultCount: selectedStreams.length,
    });
  } catch (error) {
    logger.error(`Failed to evaluate precache selector`, {
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (selectedStreams.length === 0) {
    logger.debug(
      `Skipping precaching ${id} as precache selector returned no streams`
    );
    return;
  }

  const singleStreamOnly = ctx.userData.precacheSingleStream !== false;
  const streamsToCache = selectedStreams
    .filter((s) => s.url)
    .slice(0, singleStreamOnly ? 1 : Env.MAX_BACKGROUND_PINGS);

  if (streamsToCache.length === 0) {
    logger.debug(`Skipping precaching ${id} as no selected stream had a URL`);
    return;
  }

  logger.debug(
    `Precaching ${streamsToCache.length} stream(s) for ${id} (${type})`
  );

  const cacheKey = `precache-${type}-${id}-${ctx.userData.uuid}`;
  await precacheCache.set(
    cacheKey,
    true,
    Env.PRECACHE_NEXT_EPISODE_MIN_INTERVAL
  );

  await pingStreamUrls(streamsToCache);

  logger.info(
    `Successfully precached ${streamsToCache.length} stream(s) for ${id} (${type})`
  );
}

export async function getStreams(
  ctx: AIOStreamsContext,
  id: string,
  type: string,
  preCaching: boolean = false
): Promise<
  AIOStreamsResponse<{
    streams: ParsedStream[];
    statistics: { title: string; description: string; forced?: boolean }[];
  }>
> {
  logger.info(`Handling stream request`, { type, id });
  const statistics: { title: string; description: string; forced?: boolean }[] =
    [];

  const supportedAddons = getAddonsForResource(ctx, 'stream', type, id);

  logger.info(
    `Found ${supportedAddons.length} addons that support the stream resource`,
    {
      supportedAddons: supportedAddons.map((a) => a.name),
    }
  );

  const context = StreamContext.create(type, id, ctx.userData);
  ctx.streamContext = context;

  ctx.filterer.resetFilterTimings();
  ctx.precomputer.resetPrecomputeTimings();

  const fetchStart = Date.now();
  const {
    streams,
    errors,
    statistics: addonStatistics,
  } = await ctx.fetcher.fetch(supportedAddons, context);
  const fetchMs = Date.now() - fetchStart;

  if (
    ctx.userData.statistics?.enabled &&
    ctx.userData.statistics?.statsToShow?.includes('addon')
  ) {
    statistics.push(...addonStatistics);
  }

  errors.push(
    ...ctx.addonInitialisationErrors.map((e) => ({
      title: `[❌] ${getAddonName(e.addon)}`,
      description: e.error,
    }))
  );

  const processResults = await processStreams(
    ctx,
    streams,
    context,
    false,
    ctx.userData.nzbFailover?.enabled && !preCaching
      ? {
          count: ctx.userData.nzbFailover.count ?? 3,
          position: ctx.userData.nzbFailover.position ?? 'last',
        }
      : undefined
  );
  let finalStreams = processResults.streams;
  const pipelineTimings = processResults.timings;
  errors.push(...processResults.errors);

  if (FeatureControl.disabledStreamTypes.size > 0) {
    const removedByType = new Map<string, number>();
    finalStreams = finalStreams.filter((stream) => {
      if (FeatureControl.disabledStreamTypes.has(stream.type)) {
        removedByType.set(
          stream.type,
          (removedByType.get(stream.type) ?? 0) + 1
        );
        return false;
      }
      return true;
    });
    if (removedByType.size > 0) {
      const total = [...removedByType.values()].reduce((a, b) => a + b, 0);
      const lines: string[] = [
        `⚠️ The following stream types have been disabled by the instance owner.`,
        `📌 Disabled Stream Types (${total})`,
      ];
      for (const [type, count] of removedByType.entries()) {
        lines.push(`    • ${count}× ${type}`);
      }
      statistics.push({
        title: '🚫 Removal Reasons',
        description: lines.join('\n').trim(),
        forced: true,
      });
    }
  }

  if (ctx.userData.precacheNextEpisode && !preCaching) {
    let precache = false;
    const cacheKey = `precache-${type}-${id}-${ctx.userData.uuid}`;
    const cachedNextEpisode = await precacheCache.get(cacheKey, false);
    if (cachedNextEpisode) {
      logger.info(
        `The current request for ${type} ${id} has already had the next episode precached within the last ${Env.PRECACHE_NEXT_EPISODE_MIN_INTERVAL} seconds (${precacheCache.getTTL(cacheKey)} seconds left). Skipping precaching.`
      );
      precache = false;
    } else {
      precache = true;
    }
    if (precache) {
      setImmediate(() => {
        precacheNextEpisode(ctx, context).catch((error) => {
          logger.error('Error during precaching:', {
            error: error instanceof Error ? error.message : String(error),
            type,
            id,
          });
        });
      });
    }
  }

  if (ctx.userData.preloadStreams?.enabled && !preCaching) {
    let shouldPreload = true;
    if (Env.PRELOAD_MIN_INTERVAL > 0) {
      const preloadCooldownKey = `preload-${type}-${id}-${ctx.userData.uuid}`;
      const recentlyPreloaded = await precacheCache.get(
        preloadCooldownKey,
        false
      );
      if (recentlyPreloaded) {
        logger.info(
          `Preload for ${type} ${id} skipped — within cooldown (${precacheCache.getTTL(preloadCooldownKey)} seconds left).`
        );
        shouldPreload = false;
      } else {
        await precacheCache.set(
          preloadCooldownKey,
          true,
          Env.PRELOAD_MIN_INTERVAL
        );
      }
    }

    if (shouldPreload) {
      const preloadSelector =
        ctx.userData.preloadStreams.selector ??
        constants.DEFAULT_PRELOAD_SELECTOR;
      const streamSelector = new StreamSelector(context.toExpressionContext());
      let streamsToPreload: ParsedStream[];
      const preloadSingleStream =
        ctx.userData.preloadStreams?.singleStream !== false;
      try {
        streamsToPreload = (
          await streamSelector.select(finalStreams, preloadSelector)
        )
          .filter((s) => s.url)
          .slice(0, preloadSingleStream ? 1 : Env.MAX_BACKGROUND_PINGS);
      } catch (selectorError) {
        logger.warn('Preload selector evaluation failed', {
          selector: preloadSelector,
          error:
            selectorError instanceof Error
              ? selectorError.message
              : String(selectorError),
        });
        streamsToPreload = [];
      }
      if (streamsToPreload.length > 0) {
        setImmediate(() => {
          pingStreamUrls(streamsToPreload).catch((error) => {
            logger.error('Error during stream preloading:', {
              error: error instanceof Error ? error.message : String(error),
              type,
              id,
            });
          });
        });
      }
    }
  }

  statistics.push(
    ...buildStatistics(
      {
        userData: ctx.userData,
        filterer: ctx.filterer,
        precomputer: ctx.precomputer,
      },
      finalStreams,
      fetchMs,
      pipelineTimings
    )
  );

  const byPresetType = new Map<string, ParsedStream[]>();
  for (const s of finalStreams) {
    const t = s.addon?.preset?.type ?? '';
    if (t) {
      const list = byPresetType.get(t) ?? [];
      list.push(s);
      byPresetType.set(t, list);
    }
  }
  for (const [presetType, list] of byPresetType) {
    const PresetClass = PresetManager.fromId(presetType);
    if (typeof PresetClass.onStreamsReady === 'function') {
      PresetClass.onStreamsReady(list);
    }
  }

  logger.info(
    `Returning ${finalStreams.length} streams and ${errors.length} errors and ${statistics.length} statistic`
  );
  return {
    success: true,
    data: { streams: finalStreams, statistics },
    errors,
  };
}

export async function getMeta(
  ctx: AIOStreamsContext,
  type: string,
  id: string
): Promise<AIOStreamsResponse<ParsedMeta | null>> {
  logger.info(`Handling meta request`, { type, id });

  const candidates = getMetaCandidates(ctx, type, id);

  if (candidates.length === 0) {
    logger.warn(`No supported addon was found for the requested meta`, {
      type,
      id,
    });
    return { success: false, data: null, errors: [] };
  }

  const errors: Array<{ title: string; description: string }> = [];

  for (const candidate of candidates) {
    logger.info(`Trying addon for meta resource`, {
      addonName: candidate.addon.name,
      addonInstanceId: candidate.instanceId,
      reason: candidate.reason,
    });
    try {
      const meta = await new Wrapper(candidate.addon).getMeta(type, id);
      logger.info(`Successfully got meta from addon`, {
        addonName: candidate.addon.name,
        addonInstanceId: candidate.instanceId,
      });
      if (ctx.userData.usePosterServiceForMeta) {
        await applyPosterModifications(ctx, [meta], type, true);
      } else {
        meta.links = convertDiscoverDeepLinks(ctx, meta.links);
      }
      if (meta.videos) {
        const context = StreamContext.create(type, id, ctx.userData);
        ctx.streamContext = context;
        meta.videos = await Promise.all(
          meta.videos.map(async (video) => {
            if (!video.streams) return video;
            video.streams = (
              await processStreams(ctx, video.streams, context, true)
            ).streams;
            return video;
          })
        );
      }
      return { success: true, data: meta, errors: [] };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to get meta from addon ${candidate.addon.name}`, {
        error: errorMessage,
        reason: candidate.reason,
      });
      if (candidate.reason === 'general type support') continue;
      errors.push({
        title: `[❌] ${candidate.addon.name}`,
        description: errorMessage,
      });
    }
  }

  logger.error(
    `All ${candidates.length} candidate addons failed for meta request`,
    { type, id }
  );
  return { success: false, data: null, errors };
}

export async function getSubtitles(
  ctx: AIOStreamsContext,
  type: string,
  id: string,
  extras?: string
): Promise<AIOStreamsResponse<Subtitle[]>> {
  logger.info(`Handling subtitle request`, { type, id, extras });

  const supportedAddons = getAddonsForResource(ctx, 'subtitles', type, id);
  const parsedExtras = new ExtrasParser(extras);

  let errors: AIOStreamsError[] = ctx.addonInitialisationErrors.map(
    (error) => ({
      title: `[❌] ${getAddonName(error.addon)}`,
      description: error.error,
    })
  );
  let allSubtitles: Subtitle[] = [];

  await Promise.all(
    supportedAddons.map(async (addon) => {
      try {
        const subtitles = await new Wrapper(addon).getSubtitles(
          type,
          id,
          parsedExtras.toString()
        );
        if (subtitles) allSubtitles.push(...subtitles);
      } catch (error) {
        errors.push({
          title: `[❌] ${getAddonName(addon)}`,
          description: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );

  return { success: true, data: allSubtitles, errors };
}

export async function getAddonCatalog(
  ctx: AIOStreamsContext,
  type: string,
  id: string
): Promise<AIOStreamsResponse<AddonCatalog[]>> {
  logger.info(`getAddonCatalog: ${id}`);
  const addonInstanceId = id.split('.', 2)[0];
  const addon = ctx.addons.find((a) => a.instanceId === addonInstanceId);
  if (!addon) {
    return {
      success: false,
      data: [],
      errors: [
        {
          title: `Addon ${addonInstanceId} not found`,
          description: 'Addon not found',
        },
      ],
    };
  }
  const actualAddonCatalogId = id.split('.').slice(1).join('.');
  let addonCatalogs: AddonCatalog[] = [];
  try {
    addonCatalogs = await new Wrapper(addon).getAddonCatalog(
      type,
      actualAddonCatalogId
    );
  } catch (error) {
    return {
      success: false,
      data: [],
      errors: [
        {
          title: `[❌] ${getAddonName(addon)}`,
          description: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  return { success: true, data: addonCatalogs, errors: [] };
}
