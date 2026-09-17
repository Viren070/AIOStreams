import type { ParsedId } from '../utils/id-parser.js';
import type { AnimeEntry } from './types.js';

/** Read numeric coordinates without turning null/blank or 'a' into season zero. */
export function readEpisodeCoordinate(value: unknown): number | undefined {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^\d+$/.test(value.trim()))
  )
    return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

/** Whether the request supplies episode coordinates in a TV provider's scheme. */
export function hasExternalEpisodeCoordinates(id: ParsedId): boolean {
  return (
    !!id.season &&
    !!id.episode &&
    ['imdbId', 'thetvdbId', 'themoviedbId'].includes(id.type)
  );
}

/**
 * Translate an external episode via the entry's source and target starts.
 * Seasonless anime IDs are deliberately left to their existing enrichment path.
 * Undefined means the available hints cannot describe the requested coordinates.
 */
export function mapExternalEpisodeToTmdb(
  id: ParsedId,
  entry: AnimeEntry
): { seasonNumber: number; episodeNumber: number } | undefined {
  if (!hasExternalEpisodeCoordinates(id)) return undefined;
  const season = Number(id.season);
  const episode = Number(id.episode);
  if (!Number.isInteger(season) || !Number.isInteger(episode) || episode < 1) {
    return undefined;
  }
  // Explicit TMDB requests already use the destination's coordinates.
  if (id.type === 'themoviedbId') {
    return { seasonNumber: season, episodeNumber: episode };
  }
  const targetSeason = readEpisodeCoordinate(entry.tmdb?.seasonNumber);
  const targetStart = readEpisodeCoordinate(entry.tmdb?.fromEpisode ?? 1);
  if (
    !Number.isInteger(targetSeason) ||
    targetSeason === null ||
    targetSeason === undefined ||
    targetSeason < 0 ||
    !Number.isInteger(targetStart) ||
    targetStart === undefined ||
    targetStart < 1
  ) {
    return undefined;
  }

  const localEpisode = getExternalEntryEpisode(id, entry);
  if (localEpisode === undefined) return undefined;
  return {
    seasonNumber: targetSeason,
    episodeNumber: localEpisode + targetStart - 1,
  };
}

/** Episode within the selected anime entry, for external season/episode requests. */
export function getExternalEntryEpisode(
  id: ParsedId,
  entry: AnimeEntry
): number | undefined {
  if (!hasExternalEpisodeCoordinates(id)) return undefined;
  const season = Number(id.season);
  const episode = Number(id.episode);
  if (!Number.isInteger(season) || !Number.isInteger(episode) || episode < 1) {
    return undefined;
  }
  // An IMDb ID may be served by a catalog using TVDB seasons (e.g. S17 for
  // Bleach). Prefer a matching IMDb hint; otherwise require a matching TVDB
  // season rather than applying the offset from an unrelated IMDb season.
  const source =
    id.type === 'themoviedbId'
      ? readEpisodeCoordinate(entry.tmdb?.seasonNumber) === season
        ? entry.tmdb
        : undefined
      : id.type === 'imdbId' &&
          readEpisodeCoordinate(entry.imdb?.seasonNumber) === season
        ? entry.imdb
        : readEpisodeCoordinate(entry.tvdb?.seasonNumber) === season
          ? entry.tvdb
          : undefined;
  if (!source) return undefined;
  const sourceStart = readEpisodeCoordinate(source.fromEpisode ?? 1);
  if (
    !Number.isInteger(sourceStart) ||
    sourceStart === undefined ||
    sourceStart < 1 ||
    episode < sourceStart
  ) {
    return undefined;
  }
  // Non-IMDb episodes require a non-linear mapping, not a simple offset.
  if (source === entry.imdb && entry.imdb?.nonImdbEpisodes?.length) {
    return undefined;
  }
  return episode - sourceStart + 1;
}
