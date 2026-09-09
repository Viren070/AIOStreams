import { AnimeDatabase } from '../../anime-database/index.js';
import { config as appConfig } from '../../config/index.js';
import { Cache } from '../../utils/cache.js';
import type { SegmentProviderId } from '../../utils/constants.js';
import { IdParser, type IdType } from '../../utils/id-parser.js';
import { createLogger } from '../../logging/logger.js';
import type { ContentDescriptor } from '../types.js';
import { SEGMENT_PROVIDER_REGISTRY } from './providers/index.js';
import type {
  ProviderContext,
  Segment,
  SegmentIdKey,
  SegmentLookup,
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

const cache = Cache.getInstance<string, Segment[]>('jellyfin-segments', 20_000);

/** Below this a client will not offer a skip anyway, so it is noise. */
const MIN_SEGMENT_MS = 1000;

function enabledProviders(): SegmentProviderId[] {
  const settings = appConfig.jellyfin.segments;
  if (!settings.enabled) return [];
  return settings.providers.filter((id) => SEGMENT_PROVIDER_REGISTRY[id]);
}

export function segmentsEnabled(): boolean {
  return enabledProviders().length > 0;
}

function contextFor(id: SegmentProviderId): ProviderContext {
  const settings = appConfig.jellyfin.segments;
  return {
    baseUrl:
      settings.baseUrls[id] || SEGMENT_PROVIDER_REGISTRY[id].defaultBaseUrl,
    timeoutMs: settings.timeout * 1000,
    minConfidence: settings.minConfidence,
    minSubmissions: settings.minSubmissions,
    animeSkipClientId: settings.animeSkipClientId,
  };
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
 * Fills the id spaces the enabled providers need. The anime database resolves
 * per season, so a second cour keys as itself rather than as its first.
 */
async function fillAnimeIds(
  lookup: SegmentLookup,
  providers: SegmentProviderId[]
): Promise<void> {
  const wanted = new Set<SegmentIdKey>();
  for (const id of providers) {
    for (const key of SEGMENT_PROVIDER_REGISTRY[id].idKeys) {
      if (!lookup.ids[key]) wanted.add(key);
    }
  }
  if (!wanted.size) return;

  const known = ID_TYPES.find(([key]) => lookup.ids[key]);
  if (!known) return;
  try {
    const entry = await AnimeDatabase.getInstance().getEntryById(
      known[1],
      lookup.ids[known[0]] as string,
      lookup.season,
      lookup.episode
    );
    if (!entry?.mappings) return;
    for (const [key, idType] of ID_TYPES) {
      if (lookup.ids[key]) continue;
      const value = entry.mappings[idType];
      if (value != null && value !== '') lookup.ids[key] = String(value);
    }
  } catch (error) {
    logger.debug(
      { err: error instanceof Error ? error.message : String(error) },
      'segment id lookup failed'
    );
  }
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

/*
 * Keyed on the ids and numbering, never on the item id, so the same episode
 * reached through two catalogs is one lookup. The provider list is in the key
 * so changing it takes effect without a flush; the runtime is not, because it
 * only narrows what a provider already returned.
 */
function cacheKey(lookup: SegmentLookup, providers: SegmentProviderId[]) {
  const ids = ID_TYPES.map(([key]) => lookup.ids[key] ?? '').join('|');
  return `${providers.join(',')}|${lookup.kind}|${ids}|${lookup.season ?? ''}|${lookup.episode ?? ''}`;
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

/** First provider in the operator's order to answer for a type wins it. */
function merge(
  results: Map<SegmentProviderId, Segment[]>,
  providers: SegmentProviderId[]
): Segment[] {
  const chosen = new Map<SegmentType, Segment>();
  for (const id of providers) {
    for (const segment of results.get(id) ?? []) {
      if (!chosen.has(segment.type)) chosen.set(segment.type, segment);
    }
  }
  return [...chosen.values()].sort((a, b) => a.startMs - b.startMs);
}

/**
 * Whether anything enabled covers this kind of item, without touching the cache
 * or the network. `supports` cannot answer it: it needs ids resolved first.
 */
export function couldHaveSegments(lookup: SegmentLookup): boolean {
  return enabledProviders().some((id) =>
    SEGMENT_PROVIDER_REGISTRY[id].kinds.includes(lookup.kind)
  );
}

export async function segmentsFor(lookup: SegmentLookup): Promise<Segment[]> {
  const providers = enabledProviders();
  if (!providers.length || !couldHaveSegments(lookup)) return [];

  const key = cacheKey(lookup, providers);
  const cached = await cache.get(key).catch(() => undefined);
  if (cached) return sanitise(cached, lookup.runtimeMs);

  await fillAnimeIds(lookup, providers);

  // Every provider is asked at once and merged by the operator's order, so one
  // slow provider costs its timeout rather than the sum of them all.
  const usable = providers.filter((id) =>
    SEGMENT_PROVIDER_REGISTRY[id].supports(lookup, contextFor(id))
  );
  const settled = await Promise.allSettled(
    usable.map((id) =>
      SEGMENT_PROVIDER_REGISTRY[id].fetch(lookup, contextFor(id))
    )
  );

  const results = new Map<SegmentProviderId, Segment[]>();
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      results.set(usable[i], result.value);
    } else {
      logger.debug(
        {
          provider: usable[i],
          err:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        },
        'segment provider failed'
      );
    }
  });

  const merged = merge(results, providers);
  const settings = appConfig.jellyfin.segments;
  // Misses are cached too: a provider that answers "nothing" rather than
  // failing would otherwise be re-asked for every episode of every show it
  // does not cover.
  await cache
    .set(key, merged, merged.length ? settings.ttl : settings.negativeTtl)
    .catch(() => undefined);
  return sanitise(merged, lookup.runtimeMs);
}
