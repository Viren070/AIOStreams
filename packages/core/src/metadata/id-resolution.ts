import { config as appConfig } from '../config/index.js';
import { createLogger } from '../utils/index.js';
import type { ParsedId } from '../utils/id-parser.js';
import type { AnimeEntry } from '../anime-database/types.js';
import { getEnrichedImdbId } from '../anime-database/enrich.js';
import { IdMappingDataset } from './id-mappings.js';

const logger = createLogger('id-resolution');

export interface ResolvedIds {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
}

export function resolveCrossProviderIds(
  parsedId: ParsedId,
  animeEntry: AnimeEntry | null,
  mediaType: 'movie' | 'series'
): ResolvedIds {
  // A separate IMDb series can number an OVA as S01 while anime datasets
  // attach it to the parent show's specials. Resolve that provider through
  // the requested IMDb identity instead of inheriting the parent show ID.
  const imdbSeasonRequest =
    mediaType === 'series' &&
    parsedId.type === 'imdbId' &&
    Number(parsedId.season) > 0;
  let tmdbId =
    parsedId.type === 'themoviedbId'
      ? Number(parsedId.value)
      : animeEntry?.mappings?.themoviedbId &&
          !(imdbSeasonRequest && animeEntry.tmdb?.seasonNumber === 0)
        ? Number(animeEntry.mappings.themoviedbId)
        : undefined;
  let imdbId =
    parsedId.type === 'imdbId'
      ? parsedId.value.toString()
      : getEnrichedImdbId(parsedId, animeEntry);
  let tvdbId =
    parsedId.type === 'thetvdbId'
      ? Number(parsedId.value)
      : animeEntry?.mappings?.thetvdbId &&
          mediaType === 'series' &&
          !(imdbSeasonRequest && animeEntry.tvdb?.seasonNumber === 0)
        ? Number(animeEntry.mappings.thetvdbId)
        : undefined;

  if (
    appConfig.metadata.idMappings.enabled &&
    (!imdbId || !tvdbId || !tmdbId)
  ) {
    try {
      const mapped = IdMappingDataset.getInstance().resolve(mediaType, {
        imdbId,
        tvdbId,
        tmdbId,
      });
      imdbId = imdbId ?? mapped.imdbId;
      tvdbId = tvdbId ?? mapped.tvdbId;
      tmdbId = tmdbId ?? mapped.tmdbId;
    } catch (error) {
      logger.debug(`ID mapping lookup failed for ${parsedId.fullId}: ${error}`);
    }
  }

  return { imdbId, tmdbId, tvdbId };
}

/** Episode hints belong to their mapped provider record, never another record. */
export function scopeAnimeEpisodeMappings(
  entry: AnimeEntry | null,
  ids: { tmdbId?: number | null; tvdbId?: number | null }
): AnimeEntry | null {
  if (!entry) return null;
  const differentTmdb =
    ids.tmdbId != null &&
    entry.mappings?.themoviedbId != null &&
    Number(entry.mappings.themoviedbId) !== Number(ids.tmdbId);
  const differentTvdb =
    ids.tvdbId != null &&
    entry.mappings?.thetvdbId != null &&
    Number(entry.mappings.thetvdbId) !== Number(ids.tvdbId);
  if (!differentTmdb && !differentTvdb) return entry;
  return {
    ...entry,
    tmdb: differentTmdb ? { seasonNumber: null, seasonId: null } : entry.tmdb,
    tvdb: differentTvdb ? { seasonNumber: null, seasonId: null } : entry.tvdb,
    episodeMappings: differentTvdb ? undefined : entry.episodeMappings,
  };
}
