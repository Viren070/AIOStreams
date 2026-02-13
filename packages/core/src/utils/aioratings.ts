import { Cache } from './cache.js';
import { makeRequest } from './http.js';
import { AIOratingsIsValidResponse } from '../db/schemas.js';
import { Env } from './env.js';
import { IdParser } from './id-parser.js';
import { AnimeDatabase } from './anime-database.js';

const apiKeyValidationCache = Cache.getInstance<string, boolean>(
  'aioratingsApiKey'
);
const posterCheckCache = Cache.getInstance<string, string>('aioratingsCheck');

export class AIOratings {
  private readonly apiKey: string;
  private readonly profileId: string;
  constructor(apiKey: string, profileId: string = 'default') {
    this.apiKey = apiKey.trim();
    if (!this.apiKey) {
      throw new Error('AIOratings API key is not set');
    }
    this.profileId = profileId.trim() || 'default';
  }

  public async validateApiKey(): Promise<boolean> {
    const cached = await apiKeyValidationCache.get(this.apiKey);
    if (cached !== undefined) {
      return cached;
    }

    let response;
    try {
      response = await makeRequest(
        `${Env.AIORATINGS_API_URL}/api/${this.apiKey}/isValid`,
        {
          timeout: 10000,
          ignoreRecursion: true,
        }
      );
    } catch (error: any) {
      throw new Error(
        `Failed to connect to AIOratings API: ${error.message}`
      );
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid AIOratings API key');
      } else if (response.status === 429) {
        throw new Error('AIOratings API rate limit exceeded');
      } else {
        throw new Error(
          `AIOratings API returned an unexpected status: ${response.status} - ${response.statusText}`
        );
      }
    }

    let data;
    try {
      data = AIOratingsIsValidResponse.parse(await response.json());
    } catch (error: any) {
      throw new Error(
        `AIOratings API returned malformed JSON: ${error.message}`
      );
    }

    if (!data.valid) {
      throw new Error('Invalid AIOratings API key');
    }

    apiKeyValidationCache.set(
      this.apiKey,
      data.valid,
      Env.RPDB_API_KEY_VALIDITY_CACHE_TTL
    );
    return data.valid;
  }

  private parseId(
    type: string,
    id: string
  ): { idType: 'tmdb' | 'imdb'; idValue: string } | null {
    const parsedId = IdParser.parse(id, type);
    if (!parsedId) return null;

    let idType: 'tmdb' | 'imdb' | null = null;
    let idValue: string | null = null;

    switch (parsedId.type) {
      case 'imdbId':
        idType = 'imdb';
        idValue = parsedId.value.toString();
        break;
      case 'themoviedbId': {
        idType = 'tmdb';
        // aioratings uses 'tv' not 'series'
        const tmdbType = type === 'series' ? 'tv' : type;
        idValue = `${tmdbType}-${parsedId.value}`;
        break;
      }
      case 'thetvdbId': {
        // aioratings doesn't support tvdb, fall through to AnimeDatabase
        const entry = AnimeDatabase.getInstance().getEntryById(
          'thetvdbId',
          parsedId.value
        );
        if (!entry) return null;

        if (entry.mappings?.imdbId) {
          idType = 'imdb';
          idValue = entry.mappings.imdbId.toString();
        } else if (entry.mappings?.themoviedbId) {
          idType = 'tmdb';
          const tmdbType = type === 'series' ? 'tv' : type;
          idValue = `${tmdbType}-${entry.mappings.themoviedbId}`;
        } else {
          return null;
        }
        break;
      }
      default: {
        // Try to map unsupported id types via AnimeDatabase
        const entry = AnimeDatabase.getInstance().getEntryById(
          parsedId.type,
          parsedId.value
        );
        if (!entry) return null;

        if (entry.mappings?.imdbId) {
          idType = 'imdb';
          idValue = entry.mappings.imdbId.toString();
        } else if (entry.mappings?.themoviedbId) {
          idType = 'tmdb';
          const tmdbType = type === 'series' ? 'tv' : type;
          idValue = `${tmdbType}-${entry.mappings.themoviedbId}`;
        } else {
          return null;
        }
        break;
      }
    }
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

    const cacheKey = `${type}-${id}-${this.apiKey}-${this.profileId}`;
    const cached = await posterCheckCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const posterUrl = `${Env.AIORATINGS_API_URL}/api/${this.apiKey}/${idType}/${this.profileId}/${idValue}.jpg`;
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
