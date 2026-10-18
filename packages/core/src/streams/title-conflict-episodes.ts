import pLimit from 'p-limit';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import type { TitleConflict } from '../metadata/utils.js';
import { isClosedSeries } from '../metadata/series-status.js';

export interface ConflictEpisodeCatalog {
  tvdbId?: number;
  tmdbId?: number | null;
  status?: string | null;
  episodes?:
    | {
        seasonNumber?: number;
        episodeNumber?: number;
        absoluteEpisodeNumber?: unknown;
      }[]
    | null;
}

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export interface ConflictNumberingBounds {
  episode?: number;
  season: number;
}

/** Share competitor work before limiting it; smaller seasons need fuller data. */
export type ConflictNumberingLookup = (
  conflict: TitleConflict,
  episodeSeason: number,
  fetch: () => Promise<ConflictNumberingBounds | undefined>
) => Promise<ConflictNumberingBounds | undefined>;

/** Lowest episode of a contiguous release containing the requested coordinate. */
export function matchingReleaseEpisodeFloor(
  release: { episodes?: number[]; seasons?: number[]; date?: string },
  request: {
    season?: number;
    episode?: number;
    absoluteEpisode?: number;
    relativeAbsoluteEpisode?: number;
  },
  filename?: string
): number | undefined {
  if (release.date || !release.episodes?.length) return undefined;
  const episodes = release.episodes;
  // Do not rescue mixed chains such as 279-280-16 even if the parser drops
  // trailing numbers or reduces the whole chain to a single episode.
  if (filename && /\d+[ ._]*-[ ._]*\d+[ ._]*-[ ._]*\d+/.test(filename))
    return undefined;
  if (
    !episodes.every(
      (value, index) =>
        positiveInteger(value) && (!index || value === episodes[index - 1] + 1)
    )
  )
    return undefined;
  const episode = episodes[0];
  const seasons = release.seasons ?? [];
  if (
    !positiveInteger(episode) ||
    seasons.length > 1 ||
    seasons.some((season) => !positiveInteger(season))
  )
    return undefined;

  if (
    seasons.length === 1 &&
    seasons[0] === request.season &&
    request.episode !== undefined &&
    episodes.includes(request.episode)
  )
    return episode;

  // Absolute and entry-relative coordinates only apply to unseasoned/S01
  // releases. Do not reinterpret an arbitrary season's episode number.
  if (
    (!seasons.length || seasons[0] === 1) &&
    [request.absoluteEpisode, request.relativeAbsoluteEpisode].some(
      (expected) => positiveInteger(expected) && episodes.includes(expected)
    )
  )
    return episode;
  return undefined;
}

/** Only a verified external season and matching episode coordinates provide season evidence. */
export function matchingReleaseSeason(
  release: { episodes?: number[]; seasons?: number[]; date?: string },
  verifiedRequestSeason?: number,
  requestedEpisode?: number,
  filename?: string
): number | undefined {
  if (
    release.date ||
    release.seasons?.length !== 1 ||
    (release.episodes?.length ?? 0) > 1
  )
    return undefined;
  if (
    release.episodes?.length &&
    matchingReleaseEpisodeFloor(
      release,
      { season: verifiedRequestSeason, episode: requestedEpisode },
      filename
    ) === undefined
  )
    return undefined;
  const season = release.seasons[0];
  return positiveInteger(season) && season === verifiedRequestSeason
    ? season
    : undefined;
}

/**
 * A conservative upper bound across regular season and absolute numbering.
 * Empty, malformed or visibly incomplete catalogs cannot exclude a show.
 */
export function conflictEpisodeBound(
  show: ConflictEpisodeCatalog
): number | undefined {
  if (!isClosedSeries(show.status) || !show.episodes?.length) return undefined;
  const seasons = new Map<number, Set<number>>();
  let absoluteBound = 0;
  for (const episode of show.episodes) {
    if (episode.seasonNumber === 0) continue;
    if (
      !positiveInteger(episode.seasonNumber) ||
      !positiveInteger(episode.episodeNumber)
    )
      return undefined;
    const episodes = seasons.get(episode.seasonNumber) ?? new Set<number>();
    episodes.add(episode.episodeNumber);
    seasons.set(episode.seasonNumber, episodes);
    if (episode.absoluteEpisodeNumber != null) {
      if (!positiveInteger(episode.absoluteEpisodeNumber)) return undefined;
      absoluteBound = Math.max(absoluteBound, episode.absoluteEpisodeNumber);
    }
  }
  const numbers = [...seasons.keys()];
  if (!numbers.length || Math.max(...numbers) !== numbers.length)
    return undefined;
  let total = 0;
  for (const episodes of seasons.values()) {
    // Positive, unique numbers with max === size form a complete 1..N range.
    if (Math.max(...episodes) !== episodes.size) return undefined;
    total += episodes.size;
  }
  return Math.max(total, absoluteBound);
}

/** Retain lightweight season evidence independently of full episode loading. */
export async function getConflictNumberingBounds(
  conflicts: TitleConflict[],
  getShow = (id: number) => new SkyhookMetadata().getShow(id),
  getFallbackShow?: (
    id: number,
    includeEpisodes: boolean
  ) => Promise<ConflictEpisodeCatalog | null | undefined>,
  getTmdbShow?: (
    id: number
  ) => Promise<ConflictEpisodeCatalog | null | undefined>,
  getTmdbSeasonBound?: (id: number) => Promise<number | undefined>,
  episodeSeasons?: ReadonlyMap<number | string, number>,
  lookup?: ConflictNumberingLookup
): Promise<Map<number | string, ConflictNumberingBounds>> {
  const limit = pLimit(3);
  const bounds = new Map<number | string, ConflictNumberingBounds>();
  const competitors = new Map(
    conflicts.map((conflict) => [
      conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`,
      conflict,
    ])
  );
  const summaries = new Map<number, Promise<number | undefined>>();
  await Promise.all(
    [...competitors].map(async ([key, conflict]) => {
      const episodeSeason = episodeSeasons
        ? (episodeSeasons.get(key) ?? Infinity)
        : 0;
      const fetch = async (): Promise<ConflictNumberingBounds | undefined> => {
        let includeEpisodes = !episodeSeasons || episodeSeasons.has(key);
        // Start the summary before catalogs can consume the shared deadline.
        if (
          positiveInteger(conflict.tmdbId) &&
          getTmdbSeasonBound &&
          !summaries.has(conflict.tmdbId)
        )
          summaries.set(
            conflict.tmdbId,
            getTmdbSeasonBound(conflict.tmdbId).catch(() => undefined)
          );
        const seasonPromise = conflict.tmdbId
          ? summaries.get(conflict.tmdbId)
          : undefined;
        let availableSeason: number | undefined;
        void seasonPromise?.then((season) => {
          availableSeason = season;
        });
        const needsTmdbCatalog = async () => {
          const requestedSeason = episodeSeasons?.get(key);
          if (includeEpisodes && requestedSeason && requestedSeason > 1) {
            const season = await seasonPromise;
            if (positiveInteger(season) && requestedSeason > season)
              includeEpisodes = false;
          }
          return includeEpisodes;
        };
        const isOpen = (catalog: ConflictEpisodeCatalog | null | undefined) =>
          !!catalog?.status?.trim() && !isClosedSeries(catalog.status);
        let catalog: ConflictEpisodeCatalog | null | undefined;
        if (positiveInteger(conflict.tvdbId)) {
          const show = await getShow(conflict.tvdbId).catch(() => null);
          if (show?.tvdbId === conflict.tvdbId) catalog = show;
          if (isOpen(catalog)) return;
          if (
            conflictEpisodeBound(catalog ?? {}) === undefined &&
            getFallbackShow
          ) {
            const fallback = await getFallbackShow(
              conflict.tvdbId,
              // Skip only when a usable bound has arrived; a stalled summary
              // must not delay an independent TVDB catalogue.
              !positiveInteger(availableSeason) ||
                (includeEpisodes &&
                  (episodeSeasons?.get(key) ?? 0) <= availableSeason)
            ).catch(() => undefined);
            if (fallback?.tvdbId === conflict.tvdbId) catalog = fallback;
            if (isOpen(catalog)) return;
          }
        } else if (
          positiveInteger(conflict.tmdbId) &&
          getTmdbShow &&
          (await needsTmdbCatalog())
        ) {
          const show = await getTmdbShow(conflict.tmdbId).catch(
            () => undefined
          );
          if (show?.tmdbId === conflict.tmdbId) catalog = show;
          if (isOpen(catalog)) return;
        }
        const episode = catalog ? conflictEpisodeBound(catalog) : undefined;
        if (episode !== undefined && catalog) {
          return {
            episode,
            season: Math.max(
              ...(catalog.episodes ?? []).map((e) => e.seasonNumber ?? 0)
            ),
          };
        } else {
          const season = await seasonPromise;
          if (positiveInteger(season)) return { season };
        }
      };
      const bound = await (lookup
        ? lookup(conflict, episodeSeason, fetch)
        : limit(fetch));
      if (bound) bounds.set(key, bound);
    })
  );
  return bounds;
}
