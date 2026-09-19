import { config as appConfig } from '../config/index.js';
import { createLogger } from '../utils/index.js';
import type { ParsedId } from '../utils/id-parser.js';
import type { AnimeEntry } from '../anime-database/types.js';
import { IdMappingDataset } from './id-mappings.js';

const logger = createLogger('id-resolution');

export interface ResolvedIds {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
}

/** Resolves imdb/tmdb/tvdb ids via the anime entry's own mappings, then the cross-provider id-mappings dataset. */
export function resolveCrossProviderIds(
  parsedId: ParsedId,
  animeEntry: AnimeEntry | null,
  mediaType: 'movie' | 'series'
): ResolvedIds {
  let tmdbId =
    parsedId.type === 'themoviedbId'
      ? Number(parsedId.value)
      : animeEntry?.mappings?.themoviedbId
        ? Number(animeEntry.mappings.themoviedbId)
        : undefined;
  let imdbId =
    parsedId.type === 'imdbId'
      ? parsedId.value.toString()
      : animeEntry?.mappings?.imdbId?.toString();
  let tvdbId =
    parsedId.type === 'thetvdbId'
      ? Number(parsedId.value)
      : animeEntry?.mappings?.thetvdbId && mediaType === 'series'
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
