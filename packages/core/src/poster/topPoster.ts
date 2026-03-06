import { BasePosterService } from './base.js';
import { makeRequest } from '../utils/http.js';
import { TopPosterIsValidResponse } from '../db/schemas.js';
import { Env } from '../utils/env.js';

export class TopPoster extends BasePosterService {
  readonly serviceName = 'Top Poster';
  readonly ownDomains = ['api.top-streaming.stream'];
  readonly redirectPathSegment = 'top-poster';

  constructor(apiKey: string) {
    super(apiKey, 'topPoster');
  }

  public async validateApiKey(): Promise<boolean> {
    const cached = await this.apiKeyValidationCache.get(this.apiKey);
    if (cached !== undefined) {
      return cached;
    }

    let response;
    try {
      response = await makeRequest(
        `https://api.top-streaming.stream/auth/verify/${this.apiKey}`,
        {
          timeout: 10000,
          ignoreRecursion: true,
        }
      );
    } catch (error: any) {
      throw new Error(`Failed to connect to Top Poster API: ${error.message}`);
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Top Poster API key');
      } else if (response.status === 429) {
        throw new Error('Top Poster API rate limit exceeded');
      } else {
        throw new Error(
          `Top Poster API returned an unexpected status: ${response.status} - ${response.statusText}`
        );
      }
    }

    let data;
    try {
      data = TopPosterIsValidResponse.parse(await response.json());
    } catch (error: any) {
      throw new Error(
        `Top Poster API returned malformed JSON: ${error.message}`
      );
    }

    if (!data.valid) {
      throw new Error('Invalid Top Poster API key');
    }

    this.apiKeyValidationCache.set(
      this.apiKey,
      data.valid,
      Env.POSTER_API_KEY_VALIDITY_CACHE_TTL
    );
    return data.valid;
  }

  protected buildPosterUrl(idType: string, idValue: string): string {
    return `https://api.top-streaming.stream/${this.apiKey}/${idType}/poster-default/${idValue}.jpg?fallback=true`;
  }
}
