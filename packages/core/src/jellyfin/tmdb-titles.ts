import pLimit from 'p-limit';
import type { MetaPreview, UserData } from '../db/schemas.js';
import type { AIOStreams } from '../main/index.js';
import { TMDBMetadata, type TMDBTitle } from '../metadata/tmdb.js';
import { IdMappingDataset } from '../metadata/id-mappings.js';

export const TMDB_IMAGES = 'https://image.tmdb.org/t/p/';
const ID_LOOKUPS = 8;

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

