import pLimit from 'p-limit';
import type { Meta, MetaPreview, UserData } from '../db/schemas.js';
import type { AIOStreams } from '../main/index.js';
import { createLogger } from '../logging/logger.js';
import { TMDBMetadata, type TMDBTitle } from '../metadata/tmdb.js';
import { IdMappingDataset } from '../metadata/id-mappings.js';
import { readEnrichment } from './enrichment.js';
import { providerIdsFor } from './dto.js';

const logger = createLogger('jellyfin');

export const TMDB_IMAGES = 'https://image.tmdb.org/t/p/';
const ID_LOOKUPS = 8;
/* Extra titles asked for, since some map to nothing this setup can open. */
const SPARE = 8;

export function tmdbFor(userData: UserData): TMDBMetadata | null {
  try {
    return new TMDBMetadata({
      accessToken: userData.tmdbAccessToken,
      apiKey: userData.tmdbApiKey,
    });
  } catch {
    return null;
  }
}

export function isoDate(date: string | undefined): string | undefined {
  return date ? `${date}T00:00:00.0000000Z` : undefined;
}

/**
 * TMDB titles as catalog entries under ids this configuration can open: TMDB's
 * own where a meta addon takes them, else the IMDb id. One nothing opens is
 * left out.
 */
export async function titlePreviews(
  engine: AIOStreams,
  tmdb: TMDBMetadata,
  titles: TMDBTitle[]
): Promise<MetaPreview[]> {
  const pool = pLimit(ID_LOOKUPS);
  const previews = await Promise.all(
    titles.map((title) =>
      pool(async (): Promise<MetaPreview | null> => {
        const type = title.mediaType === 'movie' ? 'movie' : 'series';
        let id: string | undefined = `tmdb:${title.tmdbId}`;
        if (!engine.canGetMeta(type, id)) {
          id = engine.canGetMeta(type, 'tt0')
            ? (IdMappingDataset.getInstance().imdbIdFor(
                type,
                'tmdb',
                title.tmdbId
              ) ??
              (await tmdb
                .getImdbId(title.mediaType, title.tmdbId)
                .catch(() => undefined)))
            : undefined;
        }
        if (!id) return null;
        return {
          id,
          type,
          name: title.title,
          poster: title.posterPath
            ? `${TMDB_IMAGES}w500${title.posterPath}`
            : undefined,
          background: title.backdropPath
            ? `${TMDB_IMAGES}w1280${title.backdropPath}`
            : undefined,
          description: title.overview,
          releaseInfo: title.date?.slice(0, 4),
          released: isoDate(title.date),
        } as MetaPreview;
      })
    )
  );
  return previews.filter((p): p is MetaPreview => !!p);
}

/**
 * What TMDB recommends alongside a movie or show, or null for the caller to
 * fall back.
 */
export async function recommendedPreviews(
  engine: AIOStreams,
  userData: UserData,
  meta: Meta | MetaPreview,
  kind: 'movie' | 'series',
  limit: number
): Promise<MetaPreview[] | null> {
  const tmdb = tmdbFor(userData);
  if (!tmdb) return null;
  const ids = providerIdsFor(meta, readEnrichment(meta));
  const tmdbId =
    Number(ids.Tmdb) ||
    (ids.Imdb
      ? IdMappingDataset.getInstance().resolve(kind, { imdbId: ids.Imdb })
          .tmdbId
      : undefined);
  if (!tmdbId) return null;
  try {
    const titles = await tmdb.getRecommendations(
      kind === 'movie' ? 'movie' : 'tv',
      tmdbId
    );
    if (!titles.length) return null;
    const previews = await titlePreviews(
      engine,
      tmdb,
      titles.slice(0, limit + SPARE)
    );
    return previews.length ? previews.slice(0, limit) : null;
  } catch (error) {
    logger.debug(
      { tmdbId, err: error instanceof Error ? error.message : String(error) },
      'recommendations failed'
    );
    return null;
  }
}
