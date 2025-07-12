import { Cache } from './cache';
import { makeRequest } from './http';
import { RPDBIsValidResponse } from '../db/schemas';
import { Env } from './env';
export type IdType = 'imdb' | 'tmdb' | 'tvdb';

interface Id {
  type: IdType;
  value: string;
}

const apiKeyValidationCache = Cache.getInstance('rpdbApiKey');

export class RPDB {
  private readonly apiKey: string;
  private readonly TMDB_ID_REGEX = /^(?:tmdb)[-:](\d+)(?::\d+:\d+)?$/;
  private readonly TVDB_ID_REGEX = /^(?:tvdb)[-:](\d+)(?::\d+:\d+)?$/;
  private readonly IMDB_ID_REGEX = /^(?:tt)(\d+)(?::\d+:\d+)?$/;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
    if (!this.apiKey) {
      throw new Error('RPDB API key is not set');
    }
  }

  public async validateApiKey() {
    const cached = apiKeyValidationCache.get(this.apiKey);
    if (cached) {
      return cached;
    }

    const response = await makeRequest(
      `https://api.ratingposterdb.com/${this.apiKey}/isValid`,
      5000,
      undefined,
      undefined,
      true
    );
    if (!response.ok) {
      throw new Error(
        `Invalid RPDB API key: ${response.status} - ${response.statusText}`
      );
    }

    const data = RPDBIsValidResponse.parse(await response.json());
    if (!data.valid) {
      throw new Error('Invalid RPDB API key');
    }

    apiKeyValidationCache.set(
      this.apiKey,
      data.valid,
      Env.RPDB_API_KEY_VALIDITY_CACHE_TTL
    );
  }
  /**
   *
   * @param id - the id of the item to get the poster for, if it is of a supported type, the rpdb poster will be returned, otherwise null
   */
  public getPosterUrl(type: string, id: string): string | null {
    const parsedId = this.getParsedId(id, type);
    if (!parsedId) {
      return null;
    }
    if (parsedId.type === 'tvdb' && type === 'movie') {
      // rpdb doesnt seem to support tvdb for movies
      return null;
    }
    const posterUrl = `https://api.ratingposterdb.com/${this.apiKey}/${parsedId.type}/poster-default/${parsedId.value}.jpg?fallback=true`;
    return posterUrl;
  }

  private getParsedId(id: string, type: string): Id | null {
    if (this.TMDB_ID_REGEX.test(id)) {
      const match = id.match(this.TMDB_ID_REGEX);
      if (['movie', 'series'].includes(type)) {
        return match ? { type: 'tmdb', value: `${type}-${match[1]}` } : null;
      }
      return null;
    }
    if (this.IMDB_ID_REGEX.test(id)) {
      const match = id.match(this.IMDB_ID_REGEX);
      return match ? { type: 'imdb', value: `tt${match[1]}` } : null;
    }
    if (this.TVDB_ID_REGEX.test(id)) {
      const match = id.match(this.TVDB_ID_REGEX);
      return match ? { type: 'tvdb', value: match[1] } : null;
    }
    return null;
  }
}
