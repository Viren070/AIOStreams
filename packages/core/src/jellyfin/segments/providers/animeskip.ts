import { Cache } from '../../../utils/cache.js';
import { makeRequest } from '../../../utils/http.js';
import type {
  ProviderContext,
  Segment,
  SegmentLookup,
  SegmentProvider,
  SegmentType,
} from '../types.js';

interface AnimeSkipTimestamp {
  at?: number;
  type?: { name?: string };
}

interface AnimeSkipEpisode {
  season?: string | null;
  number?: string | null;
  baseDuration?: number | null;
  timestamps?: AnimeSkipTimestamp[] | null;
}

/** Only the types that map onto Jellyfin's enum. */
const TYPES: Record<string, SegmentType> = {
  intro: 'Intro',
  'new intro': 'Intro',
  'mixed intro': 'Intro',
  recap: 'Recap',
  credits: 'Outro',
  'new credits': 'Outro',
  'mixed credits': 'Outro',
};

const SHOWS_QUERY =
  'query($id: String!) { findShowsByExternalId(service: ANILIST, serviceId: $id) { id } }';
const EPISODES_QUERY =
  'query($id: ID!) { findEpisodesByShowId(showId: $id) { season number baseDuration timestamps { at type { name } } } }';

/*
 * One episode costs a whole-show fetch, so both hops are cached here and not
 * only the segments derived from them.
 */
const showCache = Cache.getInstance<string, string[]>(
  'jellyfin-animeskip-shows',
  5_000
);
const episodeCache = Cache.getInstance<string, AnimeSkipEpisode[]>(
  'jellyfin-animeskip-episodes',
  2_000
);
const SHOW_TTL = 30 * 24 * 3600;
const EPISODE_TTL = 24 * 3600;

async function query<T>(
  ctx: ProviderContext,
  body: { query: string; variables: Record<string, unknown> }
): Promise<T | null> {
  const response = await makeRequest(
    `${ctx.baseUrl.replace(/\/+$/, '')}/graphql`,
    {
      timeout: ctx.timeoutMs,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-Client-ID': ctx.animeSkipClientId,
      },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) return null;
  const json = (await response.json()) as { data?: T };
  return json?.data ?? null;
}

async function showIds(
  anilistId: string,
  ctx: ProviderContext
): Promise<string[]> {
  const cached = await showCache.get(anilistId).catch(() => undefined);
  if (cached) return cached;
  const data = await query<{ findShowsByExternalId?: { id: string }[] }>(ctx, {
    query: SHOWS_QUERY,
    variables: { id: anilistId },
  });
  const ids = (data?.findShowsByExternalId ?? []).map((s) => s.id);
  // Cached even when empty: most titles are not in Anime Skip at all.
  await showCache.set(anilistId, ids, SHOW_TTL).catch(() => undefined);
  return ids;
}

async function episodesOf(
  showId: string,
  ctx: ProviderContext
): Promise<AnimeSkipEpisode[]> {
  const cached = await episodeCache.get(showId).catch(() => undefined);
  if (cached) return cached;
  const data = await query<{ findEpisodesByShowId?: AnimeSkipEpisode[] }>(ctx, {
    query: EPISODES_QUERY,
    variables: { id: showId },
  });
  const episodes = data?.findEpisodesByShowId ?? [];
  await episodeCache.set(showId, episodes, EPISODE_TTL).catch(() => undefined);
  return episodes;
}

const numberOf = (value: string | null | undefined): number | null => {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

/**
 * Several rows can share an episode number, each submitted against a different
 * release. `season` is free text and sometimes nonsense, so it narrows and never
 * excludes; prefer the release closest to the runtime being served, and
 * otherwise the most completely marked up.
 */
function pickEpisode(
  episodes: AnimeSkipEpisode[],
  lookup: SegmentLookup
): AnimeSkipEpisode | undefined {
  const candidates = episodes.filter(
    (ep) => numberOf(ep.number) === lookup.episode
  );
  if (!candidates.length) return undefined;

  const seasonMatched =
    lookup.season == null
      ? []
      : candidates.filter((ep) => numberOf(ep.season) === lookup.season);
  const pool = seasonMatched.length ? seasonMatched : candidates;

  const score = (ep: AnimeSkipEpisode): number => {
    if (lookup.runtimeMs && ep.baseDuration) {
      return Math.abs(ep.baseDuration * 1000 - lookup.runtimeMs);
    }
    return Number.MAX_SAFE_INTEGER - (ep.timestamps?.length ?? 0);
  };
  return [...pool].sort((a, b) => score(a) - score(b))[0];
}

/**
 * Timestamps are points, so a segment runs from one to the next. The last is
 * left open for the caller to clamp.
 */
function toSegments(episode: AnimeSkipEpisode): Segment[] {
  const points = (episode.timestamps ?? [])
    .filter((t) => typeof t?.at === 'number' && t.at >= 0)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  const out: Segment[] = [];
  points.forEach((point, i) => {
    const type = TYPES[String(point.type?.name ?? '').toLowerCase()];
    if (!type) return;
    const startMs = (point.at ?? 0) * 1000;
    const next = points[i + 1]?.at;
    out.push({
      type,
      startMs,
      endMs: typeof next === 'number' ? next * 1000 : Number.POSITIVE_INFINITY,
      provider: 'animeskip',
    });
  });
  return out;
}

export const animeSkipProvider: SegmentProvider = {
  id: 'animeskip',
  defaultBaseUrl: 'https://api.anime-skip.com',
  kinds: ['episode'],
  idKeys: ['anilist'],

  supports(lookup, ctx) {
    return (
      lookup.kind === 'episode' &&
      !!lookup.ids.anilist &&
      !!lookup.episode &&
      !!ctx.animeSkipClientId
    );
  },

  async fetch(lookup: SegmentLookup, ctx: ProviderContext) {
    for (const showId of await showIds(String(lookup.ids.anilist), ctx)) {
      const episode = pickEpisode(await episodesOf(showId, ctx), lookup);
      if (!episode) continue;
      const segments = toSegments(episode);
      if (segments.length) return segments;
    }
    return [];
  },
};
