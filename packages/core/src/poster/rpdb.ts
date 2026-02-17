import { BasePosterService } from './base.js';
import { makeRequest } from '../utils/http.js';
import { RPDBIsValidResponse } from '../db/schemas.js';
import { Env } from '../utils/env.js';

export class RPDB extends BasePosterService {
  readonly serviceName = 'RPDB';
  readonly ownDomains = ['api.ratingposterdb.com'];
  readonly redirectPathSegment = 'rpdb';

  constructor(apiKey: string) {
    super(apiKey, 'rpdb');
  }

  public async validateApiKey(): Promise<boolean> {
    const cached = await this.apiKeyValidationCache.get(this.apiKey);
    if (cached) {
      return cached;
    }

    const response = await makeRequest(
      `https://api.ratingposterdb.com/${this.apiKey}/isValid`,
      {
        timeout: 10000,
        ignoreRecursion: true,
      }
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

    this.apiKeyValidationCache.set(
      this.apiKey,
      data.valid,
      Env.POSTER_API_KEY_VALIDITY_CACHE_TTL
    );
    return data.valid;
  }

  protected buildPosterUrl(idType: string, idValue: string): string {
    return `https://api.ratingposterdb.com/${this.apiKey}/${idType}/poster-default/${idValue}.jpg?fallback=true`;
  }
}
