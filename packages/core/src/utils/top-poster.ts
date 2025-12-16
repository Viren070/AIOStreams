import { Cache } from './cache.js';
import { makeRequest } from './http.js';
import { TopPosterIsValidResponse } from '../db/schemas.js';
import { Env } from './env.js';
import { IdParser } from './id-parser.js';
import { AnimeDatabase } from './anime-database.js';

const apiKeyValidationCache = Cache.getInstance<string, boolean>(
  'topPosterApiKey'
);
const posterCheckCache = Cache.getInstance<string, string>('topPosterCheck');

export class TopPoster {
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
    if (!this.apiKey) {
      throw new Error('Top Poster API key is not set');
    }
  }
  public async validateApiKey(): Promise<boolean> {
    const cached = await apiKeyValidationCache.get(this.apiKey);
    if (cached) {
      return cached;
    }

    const response = await makeRequest(
      `https://api.top-streaming.stream/auth/verify/${this.apiKey}`,
      {
        timeout: 10000,
        ignoreRecursion: true,
      }
    );
    if (!response.ok) {
      throw new Error(
        `Invalid Top Poster API key: ${response.status} - ${response.statusText}`
      );
    }

    const data = TopPosterIsValidResponse.parse(await response.json());
    if (!data.valid) {
      throw new Error('Invalid Top Poster API key');
    }

    apiKeyValidationCache.set(
      this.apiKey,
      data.valid,
      Env.RPDB_API_KEY_VALIDITY_CACHE_TTL
    );
    return data.valid;
  }
  /**
   *
   * @param id - the id of the item to get the poster for, if it is of a supported type, the top poster will be returned, otherwise null
   */
  private parseId(
    type: string,
    id: string
  ): { idType: 'tmdb' | 'imdb' | 'tvdb'; idValue: string } | null {
    const parsedId = IdParser.parse(id, type);
    if (!parsedId) return null;

    let idType: 'tmdb' | 'imdb' | 'tvdb';
    let idValue: string;

    switch (parsedId.type) {
      case 'themoviedbId':
        idType = 'tmdb';
        idValue = `${type}-${parsedId.value}`;
        break;
      case 'imdbId':
        idType = 'imdb';
        idValue = parsedId.value.toString();
        break;
      case 'thetvdbId':
        if (type === 'movie') return null; // tvdb not supported for movies
        idType = 'tvdb';
        idValue = parsedId.value.toString();
        break;
      default: {
        // Try to map unsupported id types
        const entry = AnimeDatabase.getInstance().getEntryById(
          parsedId.type,
          parsedId.value
        );
        if (!entry) return null;

        if (entry.mappings?.thetvdbId && type === 'series') {
          idType = 'tvdb';
          idValue = `${entry.mappings.thetvdbId}`;
        } else if (entry.mappings?.themoviedbId) {
          idType = 'tmdb';
          idValue = `${type}-${entry.mappings.themoviedbId}`;
        } else if (entry.mappings?.imdbId) {
          idType = 'imdb';
          idValue = entry.mappings.imdbId.toString();
        } else {
          return null;
        }
        break;
      }
    }
    // @ts-ignore
    if (!idType || !idValue) return null;
    return { idType, idValue };
  }
  public async getPosterUrl(
    type: string,
    id: string,
    checkExists: boolean = true
  ): Promise<string | null> {
    const parsed = this.parseId(type, id);
    if (!parsed) return null;
    const { idType, idValue } = parsed;

    const cacheKey = `${type}-${id}-${this.apiKey}`;
    const cached = await posterCheckCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const posterUrl = `https://api.top-streaming.stream/${this.apiKey}/${idType}/poster-default/${idValue}.jpg?fallback=true`;
    if (!checkExists) {
      return posterUrl;
    }
    try {
      const response = await makeRequest(posterUrl, {
        method: 'HEAD',
        timeout: 3000,
        ignoreRecursion: true,
      });
      if (!response.ok) {
        return null;
      }
    } catch (error) {
      return null;
    }
    posterCheckCache.set(cacheKey, posterUrl, 24 * 60 * 60);
    return posterUrl;
  }
}
