import { config as appConfig } from '../config/index.js';
import { BasePosterService } from './base.js';
import { makeRequest } from '../utils/http.js';
import { TopPosterIsValidResponse } from '../db/schemas.js';
import { config } from '../config/index.js';

export class TopPoster extends BasePosterService {
  readonly serviceName = 'Top Poster';
  readonly ownDomains = ['api.top-posters.com'];
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
        `https://api.top-posters.com/auth/verify/${this.apiKey}`,
        {
          timeout: 10000,
          ignoreRecursion: true,
          headers: {
            'User-Agent': `AIOStreams/${appConfig.bootstrap.version}`,
          },
        }
      );
    } catch (error: any) {
      throw new Error(`Failed to connect to TOP Posters API: ${error.message}`);
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid TOP Posters API key');
      } else if (response.status === 429) {
        throw new Error('TOP Posters API rate limit exceeded');
      } else {
        throw new Error(
          `TOP Posters API returned an unexpected status: ${response.status} - ${response.statusText}`
        );
      }
    }

    let data;
    try {
      data = TopPosterIsValidResponse.parse(await response.json());
    } catch (error: any) {
      throw new Error(
        `TOP Posters API returned malformed JSON: ${error.message}`
      );
    }

    if (!data.valid) {
      throw new Error('Invalid TOP Posters API key');
    }

    this.apiKeyValidationCache.set(
      this.apiKey,
      data.valid,
      config.poster.apiKeyValidityCacheTtl
    );
    return data.valid;
  }

  protected buildPosterUrl(idType: string, idValue: string): string {
    return `https://api.top-posters.com/${this.apiKey}/${idType}/poster/${idValue}.jpg?fallback=true`;
  }
}
