import { BasePosterService } from './base.js';
import { makeRequest } from '../utils/http.js';
import { OpenPosterDBIsValidResponse } from '../db/schemas.js';
import { config } from '../config/index.js';

const DEFAULT_BASE_URL = 'https://openposterdb.com';

export class OpenPosterDB extends BasePosterService {
  readonly serviceName = 'OpenPosterDB';
  readonly ownDomains: string[];
  readonly redirectPathSegment = 'openposterdb';
  private readonly baseUrl: string;
  /**
   * Raw query string (without the leading `?`) appended to every poster URL,
   * e.g. `ratings_limit=2&badge_size=l&position=br`. Lets users customise the
   * generated poster via OpenPosterDB's query parameters. Empty when unset.
   */
  private readonly customParameters: string;

  constructor(apiKey: string, baseUrl?: string, customParameters?: string) {
    super(apiKey, 'openposterdb');
    // Tolerate a pasted leading `?`/`&` and surrounding whitespace, and drop any
    // `#fragment` (which is never part of the query the server receives anyway).
    this.customParameters = (customParameters || '')
      .trim()
      .replace(/#.*$/s, '')
      .replace(/^[?&]+/, '');
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
      config.poster.apiKeyValidityCacheTtl
    );
    return data.valid;
  }

  protected getCacheKey(type: string, id: string): string {
    const base = `${type}-${id}-${this.apiKey}-${this.baseUrl}`;
    return this.customParameters ? `${base}-${this.customParameters}` : base;
  }

  protected buildPosterUrl(idType: string, idValue: string): string {
    // The `.jpg` suffix is optional on current OpenPosterDB instances; omit it
    // so the customisation query string can be appended cleanly.
    const url = `${this.baseUrl}/${this.apiKey}/${idType}/poster-default/${idValue}`;
    return this.customParameters ? `${url}?${this.customParameters}` : url;
  }

  protected appendRedirectParams(url: URL): void {
    if (this.baseUrl !== DEFAULT_BASE_URL) {
      url.searchParams.set('baseUrl', this.baseUrl);
    }
    if (this.customParameters) {
      url.searchParams.set('parameters', this.customParameters);
    }
  }

  public static fromQueryParams(
    query: Record<string, string>
  ): Record<string, string> {
    const params: Record<string, string> = {};
    if (query.baseUrl) {
      params.baseUrl = query.baseUrl;
    }
    if (query.parameters) {
      params.parameters = query.parameters;
    }
    return params;
  }
}
