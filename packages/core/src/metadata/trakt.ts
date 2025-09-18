import { z } from 'zod';
import {
  AnimeDatabase,
  Cache,
  createLogger,
  makeRequest,
  ParsedId,
  formatZodError,
  Env,
} from '../utils/index.js';

const traktAliasCache = Cache.getInstance<string, string[]>('trakt-aliases');
const TRAKT_ALIAS_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days

const TraktAliasSchema = z.array(
  z.object({
    title: z.string(),
    country: z.string(),
  })
);
const TRAKT_API_BASE_URL = 'https://api.trakt.tv';

const logger = createLogger('trakt');

export async function getTraktAliases(
  parsedId: ParsedId
): Promise<string[] | null> {
  const cacheKey = `${parsedId.type}:${parsedId.value}`;
  const cachedAliases = await traktAliasCache.get(cacheKey);
  if (cachedAliases) {
    logger.debug(
      `Retrieved ${cachedAliases.length} (cached) Trakt aliases for ${parsedId.value}`
    );
    return cachedAliases;
  }
  // need imdb id, trakt id requires authentication.
  let imdbId = parsedId.type === 'imdbId' ? parsedId.value : null;
  // try to get imdb ID from anime database
  const animeEntry = AnimeDatabase.getInstance().getEntryById(
    parsedId.type,
    parsedId.value
  );
  imdbId = imdbId ?? animeEntry?.mappings?.imdbId?.toString() ?? null;
  if (!imdbId) {
    return null;
  }

  try {
    const data = await makeRequest(
      `${TRAKT_API_BASE_URL}/${parsedId.mediaType === 'movie' ? 'movies' : 'shows'}/${imdbId}/aliases`,
      {
        timeout: 1000,
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '1',
          'trakt-api-key': Env.TRAKT_CLIENT_ID,
        },
      }
    );

    const parsedData = TraktAliasSchema.safeParse(await data.json());

    if (!parsedData.success) {
      logger.error(
        `Failed to parse Trakt aliases: ${formatZodError(parsedData.error)}`
      );
      return null;
    }

    const aliases = parsedData.data.map((alias) => alias.title);
    traktAliasCache.set(cacheKey, aliases, TRAKT_ALIAS_CACHE_TTL);
    logger.debug(
      `Retrieved ${aliases.length} Trakt aliases for ${parsedId.value}`
    );
    return aliases;
  } catch (error) {
    logger.error(`Failed to retrieve Trakt aliases: ${error}`);
    return null;
  }
}
