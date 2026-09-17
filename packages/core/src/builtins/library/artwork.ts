import { ParsedResult } from '@viren070/parse-torrent-title';
import { token_set_ratio } from 'fuzzball';
import { Cache, createLogger } from '../../utils/index.js';
import { IMDBMetadata, IMDBSearchResult } from '../../metadata/imdb.js';
import { normaliseTitle } from '../../parser/utils.js';

const logger = createLogger('library:artwork');

/** Minimum fuzzy score for a search result title to count as the same title. */
const TITLE_MATCH_THRESHOLD = 90;
/** Upper bound on how long a catalog page waits for artwork lookups. */
const LOOKUP_BUDGET_MS = 5000;
/** Parallel lookups per catalog page. */
const LOOKUP_CONCURRENCY = 8;
const HIT_TTL = 7 * 24 * 60 * 60;
/** Unmatched titles are remembered for a day so they aren't searched on every page load. */
const MISS_TTL = 24 * 60 * 60;

const MOVIE_KINDS = new Set(['movie', 'tvMovie', 'video']);
const SERIES_KINDS = new Set(['tvSeries', 'tvMiniSeries']);

export interface LibraryArtwork {
  imdbId: string;
  poster: string;
  title?: string;
  year?: number;
}

export interface ArtworkQuery {
  title: string;
  year?: number;
  type: 'movie' | 'series';
}

/**
 * Derive what to search for from a parsed torrent/NZB name.
 * Returns undefined when there is no usable title.
 */
export function buildArtworkQuery(
  parsed: ParsedResult,
  parsedTitle: string
): ArtworkQuery | undefined {
  const title = parsedTitle.trim();
  if (!title) return undefined;
  const isSeries =
    (parsed.seasons?.length ?? 0) > 0 ||
    (parsed.episodes?.length ?? 0) > 0 ||
    parsed.complete === true;
  const year = parsed.year ? Number(parsed.year) : undefined;
  return {
    title,
    year: year && !Number.isNaN(year) ? year : undefined,
    type: isSeries ? 'series' : 'movie',
  };
}

/**
 * Pick the search result that matches the query, or undefined if none does.
 *
 * A result must be of the right kind (movie vs series), have a poster, have a
 * title that fuzzy-matches the query, and (when the query has a year) a year
 * within one year of it. Series only need to have started by that year, since
 * release names often carry the airing year of a later season.
 */
export function pickArtworkMatch(
  results: IMDBSearchResult[],
  query: ArtworkQuery
): IMDBSearchResult | undefined {
  const wantedTitle = normaliseTitle(query.title);
  const kinds = query.type === 'series' ? SERIES_KINDS : MOVIE_KINDS;

  const yearOk = (year?: number) => {
    if (!query.year) return true;
    if (!year) return false;
    return query.type === 'series'
      ? year <= query.year + 1
      : Math.abs(year - query.year) <= 1;
  };

  let best: { result: IMDBSearchResult; score: number } | undefined;
  for (const result of results) {
    if (!result.poster || !result.kind || !kinds.has(result.kind)) continue;
    if (!yearOk(result.year)) continue;
    const candidateTitle = normaliseTitle(result.title);
    const score =
      candidateTitle === wantedTitle
        ? 100
        : token_set_ratio(candidateTitle, wantedTitle);
    if (score < TITLE_MATCH_THRESHOLD) continue;
    // Results are already in IMDb relevance order, so only replace on a strictly better score.
    if (!best || score > best.score) best = { result, score };
  }
  return best?.result;
}

const imdb = new IMDBMetadata();
const artworkCache = Cache.getInstance<string, LibraryArtwork | { miss: true }>(
  'library-artwork'
);

async function lookupArtwork(
  query: ArtworkQuery
): Promise<LibraryArtwork | undefined> {
  const key = `${query.type}:${query.title.toLowerCase()}:${query.year ?? ''}`;
  const cached = await artworkCache.get(key);
  if (cached) return 'miss' in cached ? undefined : cached;
  try {
    const results = await imdb.searchTitles(query.title);
    const match = pickArtworkMatch(results, query);
    const artwork = match?.poster
      ? {
          imdbId: match.id,
          poster: match.poster,
          title: match.title,
          year: match.year,
        }
      : undefined;
    await artworkCache.set(
      key,
      artwork ?? { miss: true },
      artwork ? HIT_TTL : MISS_TTL
    );
    return artwork;
  } catch (error: any) {
    logger.debug(
      { title: query.title, error: error?.message },
      'artwork lookup failed'
    );
    return undefined;
  }
}

/**
 * Resolve artwork for a page of library items.
 *
 * Lookups run with limited concurrency and the page never waits longer than
 * LOOKUP_BUDGET_MS; unfinished lookups keep running and populate the search
 * cache, so their artwork shows up on the next load.
 */
export async function resolveLibraryArtwork(
  queries: (ArtworkQuery | undefined)[]
): Promise<(LibraryArtwork | undefined)[]> {
  const results: (LibraryArtwork | undefined)[] = new Array(queries.length);
  let next = 0;
  const worker = async () => {
    while (next < queries.length) {
      const index = next++;
      const query = queries[index];
      if (query) results[index] = await lookupArtwork(query);
    }
  };
  const all = Promise.all(
    Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queries.length) }, worker)
  );
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, LOOKUP_BUDGET_MS);
  });
  await Promise.race([all, budget]);
  clearTimeout(timer);
  return results;
}
