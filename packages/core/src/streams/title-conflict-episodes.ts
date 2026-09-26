import pLimit from 'p-limit';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import type { TitleConflict } from '../metadata/utils.js';

export interface ConflictEpisodeCatalog {
  tvdbId?: number;
  tmdbId?: number | null;
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
  if (!show.episodes?.length) return undefined;
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

/** Fetch each competitor once per filter call; Skyhook caches shows for a day. */
export async function getConflictNumberingBounds(
  conflicts: TitleConflict[],
  getShow = (id: number) => new SkyhookMetadata().getShow(id),
  getFallbackShow?: (
    id: number
  ) => Promise<ConflictEpisodeCatalog | null | undefined>,
  getTmdbShow?: (
    id: number
  ) => Promise<ConflictEpisodeCatalog | null | undefined>,
  getTmdbSeasonBound?: (id: number) => Promise<number | undefined>
): Promise<Map<number | string, ConflictNumberingBounds>> {
  const ids = [...new Set(conflicts.map((conflict) => conflict.tvdbId))].filter(
    positiveInteger
  );
  const bounds = new Map<number | string, ConflictNumberingBounds>();
  const limit = pLimit(3);
  await Promise.all(
    ids.map((id) =>
      limit(async () => {
        const show = await getShow(id).catch(() => null);
        let catalog: ConflictEpisodeCatalog | null | undefined = show;
        let bound =
          catalog?.tvdbId === id ? conflictEpisodeBound(catalog) : undefined;
        if (bound === undefined && getFallbackShow) {
          const fallback = await getFallbackShow(id).catch(() => undefined);
          if (fallback?.tvdbId === id) {
            catalog = fallback;
            bound = conflictEpisodeBound(fallback);
          }
        }
        if (bound !== undefined && catalog) {
          const season = (catalog.episodes ?? []).reduce(
            (max, episode) => Math.max(max, episode.seasonNumber ?? 0),
            0
          );
          bounds.set(id, { episode: bound, season });
        }
      })
    )
  );
  if (getTmdbShow) {
    const tmdbIds = [
      ...new Set(
        conflicts.filter((c) => !positiveInteger(c.tvdbId)).map((c) => c.tmdbId)
      ),
    ].filter(positiveInteger);
    await Promise.all(
      tmdbIds.map((id) =>
        limit(async () => {
          const catalog = await getTmdbShow(id).catch(() => undefined);
          const bound =
            catalog?.tmdbId === id ? conflictEpisodeBound(catalog) : undefined;
          if (bound !== undefined && catalog)
            bounds.set(`tmdb:${id}`, {
              episode: bound,
              season: Math.max(
                ...(catalog.episodes ?? []).map((e) => e.seasonNumber ?? 0)
              ),
            });
        })
      )
    );
  }
  // A failed episode catalog must not erase independently verified season
  // evidence. Also cover competitors whose TVDB catalog could not be loaded.
  if (getTmdbSeasonBound) {
    const pending = new Map<number, (number | string)[]>();
    for (const conflict of conflicts) {
      const key = conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`;
      if (bounds.has(key) || !positiveInteger(conflict.tmdbId)) continue;
      pending.set(conflict.tmdbId, [
        ...new Set([...(pending.get(conflict.tmdbId) ?? []), key]),
      ]);
    }
    await Promise.all(
      [...pending].map(([id, keys]) =>
        limit(async () => {
          const season = await getTmdbSeasonBound(id).catch(() => undefined);
          if (positiveInteger(season))
            for (const key of keys) bounds.set(key, { season });
        })
      )
    );
  }
  return bounds;
}
