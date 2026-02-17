import { BasePosterService } from './base.js';
import { makeRequest } from '../utils/http.js';
import { AIOratingsIsValidResponse } from '../db/schemas.js';
import { Env } from '../utils/env.js';

export class AIOratings extends BasePosterService {
  readonly serviceName = 'AIOratings';
  readonly ownDomains = ['apiv2.aioratings.com'];
  readonly redirectPathSegment = 'aioratings';
  private readonly profileId: string;

  constructor(apiKey: string, profileId: string = 'default') {
    super(apiKey, 'aioratings');
    this.profileId = profileId.trim() || 'default';
  }

  /**
   * AIOratings doesn't support tvdb directly.
   * It supports tmdb and imdb. If we have a tvdb ID, the base class
   * will fall through to AnimeDatabase mapping for tmdb/imdb.
   */
  protected get supportedIdTypes(): ('tmdb' | 'imdb')[] {
    return ['tmdb', 'imdb'];
  }

  /**
   * Override parseId to use different tmdb format.
   * AIOratings uses 'tv' instead of 'series' in the tmdb path.
   */
  protected override parseId(
    type: string,
    id: string
  ): { idType: 'tmdb' | 'imdb'; idValue: string } | null {
    const result = super.parseId(type, id);
    if (!result) return null;

    // AIOratings uses 'tv' instead of 'series' in tmdb IDs
    if (result.idType === 'tmdb') {
      const tmdbType = type === 'series' ? 'tv' : type;
      // Re-format: the base class produces `${type}-${value}`, we need `${tmdbType}-${value}`
      const parts = result.idValue.split('-');
      const numericId = parts.slice(1).join('-');
      result.idValue = `${tmdbType}-${numericId}`;
    }

    return result as { idType: 'tmdb' | 'imdb'; idValue: string };
  }

  public async validateApiKey(): Promise<boolean> {
    const cached = await this.apiKeyValidationCache.get(this.apiKey);
    if (cached !== undefined) {
      return cached;
    }

    let response;
    try {
      response = await makeRequest(
        `https://apiv2.aioratings.com/api/${this.apiKey}/isValid`,
        {
          timeout: 10000,
          ignoreRecursion: true,
        }
      );
    } catch (error: any) {
      throw new Error(`Failed to connect to AIOratings API: ${error.message}`);
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

    this.apiKeyValidationCache.set(
      this.apiKey,
      data.valid,
      Env.POSTER_API_KEY_VALIDITY_CACHE_TTL
    );
    return data.valid;
  }

  protected buildPosterUrl(idType: string, idValue: string): string {
    return `https://apiv2.aioratings.com/api/${this.apiKey}/${idType}/${this.profileId}/${idValue}.jpg`;
  }

  protected getCacheKey(type: string, id: string): string {
    return `${type}-${id}-${this.apiKey}-${this.profileId}`;
  }

  protected appendRedirectParams(url: URL): void {
    if (this.profileId) {
      url.searchParams.set('profileId', this.profileId);
    }
  }
}
