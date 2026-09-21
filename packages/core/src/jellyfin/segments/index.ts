import { AnimeDatabase } from '../../anime-database/index.js';
import type { AnimeEntry } from '../../anime-database/types.js';
import { config as appConfig } from '../../config/index.js';
import { IdMappingDataset } from '../../metadata/id-mappings.js';
import { Cache } from '../../utils/cache.js';
import {
  DistributedLock,
  requestLockType,
} from '../../utils/distributed-lock.js';
import type { SegmentProviderId } from '../../utils/constants.js';
import { IdParser, type IdType } from '../../utils/id-parser.js';
import { createLogger } from '../../logging/logger.js';
import type { ContentDescriptor } from '../types.js';
import { SEGMENT_PROVIDER_REGISTRY } from './providers/index.js';
import type {
  ProviderContext,
  Segment,
  SegmentCredentials,
  SegmentIdKey,
  SegmentLookup,
  SegmentProviderStatus,
  SegmentType,
} from './types.js';

export * from './types.js';
export { SEGMENT_PROVIDER_REGISTRY } from './providers/index.js';

const logger = createLogger('jellyfin');

/** Our id keys against the parser's and the anime database's spellings. */
const ID_TYPES: [SegmentIdKey, IdType][] = [
  ['imdb', 'imdbId'],
  ['tmdb', 'themoviedbId'],
  ['tvdb', 'thetvdbId'],
  ['mal', 'malId'],
  ['kitsu', 'kitsuId'],
  ['anilist', 'anilistId'],
  ['anidb', 'anidbId'],
];

const ANIME_KEYS = new Set<SegmentIdKey>(['mal', 'kitsu', 'anilist', 'anidb']);

const cache = Cache.getInstance<string, Segment[]>('jellyfin-segments', 40_000);

/** Below this a client will not offer a skip anyway, so it is noise. */
const MIN_SEGMENT_MS = 1000;

/** Bumped when a provider changes what it returns, so old answers retire. */
const KEY_VERSION = 'v2';

function contextFor(
  id: SegmentProviderId,
  credentials: SegmentCredentials = {}
): ProviderContext {
  const settings = appConfig.jellyfin.segments;
  return {
    baseUrl:
      settings.baseUrls[id] || SEGMENT_PROVIDER_REGISTRY[id].defaultBaseUrl,
    timeoutMs: settings.timeout * 1000,
    minConfidence: settings.minConfidence,
    minSubmissions: settings.minSubmissions,
    animeSkipClientId: settings.animeSkipClientId,
    pmdbApiKey: credentials.pmdbApiKey || settings.pmdbApiKey,
  };
}

function activeProviders(
  credentials?: SegmentCredentials
): SegmentProviderId[] {
  const settings = appConfig.jellyfin.segments;
  if (!settings.enabled) return [];
  return settings.providers.filter((id) => {
    const provider = SEGMENT_PROVIDER_REGISTRY[id];
    return (
      !!provider && (provider.configured?.(contextFor(id, credentials)) ?? true)
    );
  });
}

/** Every provider some configuration could use, in the operator's order. */
export function segmentProviders(): SegmentProviderStatus[] {
  const settings = appConfig.jellyfin.segments;
  if (!settings.enabled) return [];
  return settings.providers.flatMap((id): SegmentProviderStatus[] => {
    const provider = SEGMENT_PROVIDER_REGISTRY[id];
    if (!provider) return [];
    const entry = { id, name: provider.name };
    if (!provider.configured) return [{ ...entry, key: 'none' }];
    if (provider.configured(contextFor(id)))
      return [{ ...entry, key: 'instance' }];
    return provider.configurationKey
      ? [{ ...entry, key: 'configuration' }]
      : [];
  });
}

export function segmentsEnabled(): boolean {
  return segmentProviders().length > 0;
}

/**
 * Ids the descriptor states outright. Only one is ever present: an item id
 * carries the single id space its meta was published in.
 */
function statedIds(
  descriptor: ContentDescriptor
): Partial<Record<SegmentIdKey, string>> {
  const parsed = IdParser.parse(descriptor.i, descriptor.t);
  if (!parsed) return {};
  const key = ID_TYPES.find(([, idType]) => idType === parsed.type)?.[0];
  return key ? { [key]: String(parsed.value) } : {};
}

/**
 * Submissions keep the TMDB layout they were filed under, so a cour TMDB has
 * folded into an earlier season is also tried at IMDb's season for it. Only in
 * that shape: elsewhere IMDb's season can be a different cour on TMDB.
 */
function tmdbEpisodesOf(
  entry: AnimeEntry,
  lookup: SegmentLookup,
  stated: SegmentIdKey
): SegmentLookup['tmdbEpisodes'] {
  const animeStated = ANIME_KEYS.has(stated);
  const unknown = animeStated ? [] : undefined;
  const tmdbSeason = entry.tmdb?.seasonNumber;
  const imdb = entry.imdb;
  if (typeof tmdbSeason !== 'number' || !lookup.episode) return unknown;

  let inCour = lookup.episode;
  if (!animeStated) {
    if (stated !== 'imdb' || !imdb || imdb.seasonNumber !== lookup.season)
      return unknown;
    inCour = lookup.episode - (imdb.fromEpisode ?? 1) + 1;
    if (inCour < 1) return unknown;
  }

  const tmdbFrom = entry.tmdb.fromEpisode ?? 1;
  const out = [{ season: tmdbSeason, episode: tmdbFrom + inCour - 1 }];
  if (
    typeof imdb?.seasonNumber === 'number' &&
    imdb.seasonNumber > tmdbSeason &&
    tmdbFrom > 1
  ) {
    out.push({
      season: imdb.seasonNumber,
      episode: (imdb.fromEpisode ?? 1) + inCour - 1,
    });
  }
  return out;
}

/** The anime database resolves per season, so a second cour keys as itself rather than as its first. */
async function fillIds(
  lookup: SegmentLookup,
  providers: SegmentProviderId[]
): Promise<void> {
  const needed = new Set<SegmentIdKey>();
  for (const id of providers) {
    for (const key of SEGMENT_PROVIDER_REGISTRY[id].idKeys) needed.add(key);
  }
  const missing = () => [...needed].some((key) => !lookup.ids[key]);
  const stated = ID_TYPES.find(([key]) => lookup.ids[key]);
  if (!stated) return;
  const animeStated = ANIME_KEYS.has(stated[0]);
  const wantsTmdbNumbering =
    needed.has('tmdb') && lookup.kind === 'episode' && stated[0] !== 'tmdb';

  const fromDataset = () => {
    const mediaType = lookup.kind === 'movie' ? 'movie' : 'series';
    try {
      // Movies only: an episode's TMDB numbering is not IMDb's.
      if (!lookup.ids.imdb && lookup.ids.tmdb && lookup.kind === 'movie') {
        const imdb = IdMappingDataset.getInstance().imdbIdFor(
          'movie',
          'tmdb',
          Number(lookup.ids.tmdb)
        );
        if (imdb) lookup.ids.imdb = imdb;
      }
      if (!lookup.ids.imdb || (lookup.ids.tmdb && lookup.ids.tvdb)) return;
      const mapped = IdMappingDataset.getInstance().resolve(mediaType, {
        imdbId: lookup.ids.imdb,
      });
      if (mapped.tmdbId && !lookup.ids.tmdb)
        lookup.ids.tmdb = String(mapped.tmdbId);
      if (mapped.tvdbId && !lookup.ids.tvdb)
        lookup.ids.tvdb = String(mapped.tvdbId);
    } catch (error) {
      logger.debug(
        { err: error instanceof Error ? error.message : String(error) },
        'segment id mapping failed'
      );
    }
  };

  fromDataset();
  if (!missing() && !wantsTmdbNumbering) return;

  try {
    const entry = await AnimeDatabase.getInstance().getEntryById(
      stated[1],
      lookup.ids[stated[0]] as string,
      lookup.season,
      lookup.episode
    );
    if (entry?.mappings) {
      for (const [key, idType] of ID_TYPES) {
        if (lookup.ids[key]) continue;
        const value = entry.mappings[idType];
        if (value != null && value !== '') lookup.ids[key] = String(value);
      }
    }
    if (wantsTmdbNumbering) {
      lookup.tmdbEpisodes = entry
        ? tmdbEpisodesOf(entry, lookup, stated[0])
        : animeStated
          ? []
          : undefined;
    }
  } catch (error) {
    logger.debug(
      { err: error instanceof Error ? error.message : String(error) },
      'segment id lookup failed'
    );
    if (animeStated && wantsTmdbNumbering) lookup.tmdbEpisodes = [];
  }
  fromDataset();
}

export function lookupFor(
  descriptor: ContentDescriptor,
  runtimeMs?: number
): SegmentLookup | null {
  if (descriptor.k !== 'episode' && descriptor.k !== 'movie') return null;
  return {
    kind: descriptor.k,
    ids: statedIds(descriptor),
    season: descriptor.k === 'episode' ? descriptor.s : undefined,
    episode: descriptor.k === 'episode' ? descriptor.e : undefined,
    runtimeMs,
  };
}

/** Never on the item id, so one episode reached through two catalogs is one lookup. */
function cacheKey(id: SegmentProviderId, lookup: SegmentLookup) {
  const ids = ID_TYPES.map(([key]) => lookup.ids[key] ?? '').join('|');
  return `${KEY_VERSION}|${id}|${lookup.kind}|${ids}|${lookup.season ?? ''}|${lookup.episode ?? ''}`;
}

/**
 * Timestamps are submitted per title while a file is one particular release, and
 * clients decide for themselves whether to auto-skip, so rejecting what cannot
 * fit the runtime is the only guard there is.
 */
function sanitise(segments: Segment[], runtimeMs?: number): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    const startMs = Math.round(segment.startMs);
    let endMs = Math.round(segment.endMs);
    if (!Number.isFinite(startMs) || startMs < 0) continue;
    if (!Number.isFinite(endMs)) {
      // An open end means it runs to the end of the file.
      if (!runtimeMs) continue;
      endMs = runtimeMs;
    }
    if (runtimeMs) {
      if (startMs >= runtimeMs) continue;
      endMs = Math.min(endMs, runtimeMs);
    }
    if (endMs - startMs < MIN_SEGMENT_MS) continue;
    out.push({ ...segment, startMs, endMs });
  }
  return out;
}

/** First provider in the operator's order with a usable entry for a type wins it. */
function merge(
  results: Map<SegmentProviderId, Segment[]>,
  providers: SegmentProviderId[],
  runtimeMs?: number
): Segment[] {
  const chosen = new Map<SegmentType, Segment>();
  for (const id of providers) {
    for (const segment of sanitise(results.get(id) ?? [], runtimeMs)) {
      if (!chosen.has(segment.type)) chosen.set(segment.type, segment);
    }
  }
  return [...chosen.values()].sort((a, b) => a.startMs - b.startMs);
}

function providersFor(
  lookup: SegmentLookup,
  credentials?: SegmentCredentials
): SegmentProviderId[] {
  return activeProviders(credentials).filter((id) =>
    SEGMENT_PROVIDER_REGISTRY[id].kinds.includes(lookup.kind)
  );
}

/** Answers before ids are resolved, which `supports` cannot. */
export function couldHaveSegments(
  lookup: SegmentLookup,
  credentials?: SegmentCredentials
): boolean {
  return providersFor(lookup, credentials).length > 0;
}

/**
 * A type is decided once the first provider in order that has it has answered,
 * or once every provider has answered without it.
 */
function decided(
  types: SegmentType[],
  providers: SegmentProviderId[],
  results: Map<SegmentProviderId, Segment[]>,
  settled: Set<SegmentProviderId>,
  runtimeMs?: number
): boolean {
  return types.every((type) => {
    for (const id of providers) {
      if (!settled.has(id)) return false;
      if (
        sanitise(results.get(id) ?? [], runtimeMs).some((s) => s.type === type)
      )
        return true;
    }
    return true;
  });
}

/**
 * With `types`, answers as soon as those are decided; slower providers keep
 * running and fill the cache for the next lookup.
 */
export async function segmentsFor(
  lookup: SegmentLookup,
  credentials?: SegmentCredentials,
  types?: SegmentType[]
): Promise<Segment[]> {
  const providers = providersFor(lookup, credentials);
  if (!providers.length) return [];

  // Keys come from the stated ids, before filling adds any.
  const keys = new Map(providers.map((id) => [id, cacheKey(id, lookup)]));
  const results = new Map<SegmentProviderId, Segment[]>();
  await Promise.all(
    providers.map(async (id) => {
      const cached = await cache.get(keys.get(id)!).catch(() => undefined);
      if (cached) results.set(id, cached);
    })
  );
  const settled = new Set(results.keys());

  const uncached = providers.filter((id) => !results.has(id));
  if (uncached.length) {
    await fillIds(lookup, uncached);
    const settings = appConfig.jellyfin.segments;
    const fetches = uncached.map(async (id) => {
      const provider = SEGMENT_PROVIDER_REGISTRY[id];
      const ctx = contextFor(id, credentials);
      const key = keys.get(id)!;
      try {
        const { result } = await DistributedLock.getInstance().withLock(
          `jellyfin-segments:${key}`,
          async () => {
            const segments = provider.supports(lookup, ctx)
              ? await provider.fetch(lookup, ctx)
              : [];
            // Misses are cached so uncovered shows are not re-asked. Failures
            // are not: one configuration's bad key must not blank a provider
            // for the others.
            await cache
              .set(
                key,
                segments,
                segments.length ? settings.ttl : settings.negativeTtl
              )
              .catch(() => undefined);
            return segments;
          },
          {
            type: requestLockType(),
            // A provider may make more than one request per lookup.
            timeout: ctx.timeoutMs * 3,
            ttl: ctx.timeoutMs * 3,
          }
        );
        results.set(id, result);
      } catch (error) {
        logger.debug(
          {
            provider: id,
            err: error instanceof Error ? error.message : String(error),
          },
          'segment provider failed'
        );
      } finally {
        settled.add(id);
      }
    });
    const all = Promise.all(fetches);
    if (types?.length) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (decided(types, providers, results, settled, lookup.runtimeMs))
            resolve();
        };
        check();
        for (const fetch of fetches) void fetch.then(check);
        void all.then(() => resolve());
      });
    } else {
      await all;
    }
  }

  return merge(results, providers, lookup.runtimeMs);
}
