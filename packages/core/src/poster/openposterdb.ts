import { BasePosterService } from './base.js';
import { makeRequest } from '../utils/http.js';
import { OpenPosterDBIsValidResponse } from '../db/schemas.js';
import { Env } from '../utils/env.js';

const DEFAULT_BASE_URL = 'https://openposterdb.com';

export class OpenPosterDB extends BasePosterService {
  readonly serviceName = 'OpenPosterDB';
  readonly ownDomains: string[];
  readonly redirectPathSegment = 'openposterdb';
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    super(apiKey, 'openposterdb');
    const raw = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(
          `OpenPosterDB base URL must use http or https, got ${parsed.protocol}`
        );
      }
      this.baseUrl = raw;
      this.ownDomains = [parsed.hostname];
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('OpenPosterDB')) throw e;
      throw new Error(`Invalid OpenPosterDB base URL: ${raw}`);
    }
  }

  public async validateApiKey(): Promise<boolean> {
    const cacheKey = `${this.baseUrl}:${this.apiKey}`;
    const cached = await this.apiKeyValidationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await makeRequest(
      `${this.baseUrl}/${this.apiKey}/isValid`,
      {
        timeout: 10000,
        ignoreRecursion: true,
      }
    );
    if (!response.ok) {
      throw new Error(
        `Invalid OpenPosterDB API key: ${response.status} - ${response.statusText}`
      );
    }

    const data = OpenPosterDBIsValidResponse.parse(await response.json());
    if (!data.valid) {
      throw new Error('Invalid OpenPosterDB API key');
    }

    this.apiKeyValidationCache.set(
      cacheKey,
      data.valid,
      Env.POSTER_API_KEY_VALIDITY_CACHE_TTL
    );
    return data.valid;
  }

  protected getCacheKey(type: string, id: string): string {
    return `${type}-${id}-${this.apiKey}-${this.baseUrl}`;
  }

  protected buildPosterUrl(idType: string, idValue: string): string {
    return `${this.baseUrl}/${this.apiKey}/${idType}/poster-default/${idValue}.jpg`;
  }

  protected appendRedirectParams(url: URL): void {
    if (this.baseUrl !== DEFAULT_BASE_URL) {
      url.searchParams.set('baseUrl', this.baseUrl);
    }
  }

  public static fromQueryParams(
    query: Record<string, string>
  ): Record<string, string> {
    const params: Record<string, string> = {};
    if (query.baseUrl) {
      params.baseUrl = query.baseUrl;
    }
    return params;
  }
}
