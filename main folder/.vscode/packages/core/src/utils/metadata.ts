import { Env } from './env';
import { Cache } from './cache';
import { TYPES } from './constants';

export type ExternalIdType = 'imdb' | 'tmdb' | 'tvdb';

interface ExternalId {
  type: ExternalIdType;
  value: string;
}

const API_BASE_URL = 'https://api.themoviedb.org/3';
const FIND_BY_ID_PATH = '/find';
const MOVIE_DETAILS_PATH = '/movie';
const TV_DETAILS_PATH = '/tv';
const ALTERNATIVE_TITLES_PATH = '/alternative_titles';

// Cache TTLs in seconds
const ID_CACHE_TTL = 24 * 60 * 60; // 24 hours
const TITLE_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const ACCESS_TOKEN_CACHE_TTL = 2 * 24 * 60 * 60; // 2 day

export interface Metadata {
  titles: string[];
  year?: string;
}

export class TMDBMetadata {
  private readonly TMDB_ID_REGEX = /^(?:tmdb)[-:](\d+)(?::\d+:\d+)?$/;
  private readonly TVDB_ID_REGEX = /^(?:tvdb)[-:](\d+)(?::\d+:\d+)?$/;
  private readonly IMDB_ID_REGEX = /^(?:tt)(\d+)(?::\d+:\d+)?$/;
  private readonly idCache: Cache<string, string>;
  private readonly metadataCache: Cache<string, Metadata>;
  private readonly accessToken: string;
  private readonly validationCache: Cache<string, boolean>;
  public constructor(accessToken?: string) {
    if (!accessToken && !Env.TMDB_ACCESS_TOKEN) {
      throw new Error('TMDB Access Token is not set');
    }
    this.accessToken = (accessToken || Env.TMDB_ACCESS_TOKEN)!;
    this.idCache = Cache.getInstance<string, string>('tmdb_id_conversion');
    this.metadataCache = Cache.getInstance<string, Metadata>('tmdb_metadata');
    this.validationCache = Cache.getInstance<string, boolean>(
      'tmdb_validation'
    );
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  private parseExternalId(id: string): ExternalId | null {
    if (this.TMDB_ID_REGEX.test(id)) {
      const match = id.match(this.TMDB_ID_REGEX);
      return match ? { type: 'tmdb', value: match[1] } : null;
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

  private async convertToTmdbId(
    id: ExternalId,
    type: (typeof TYPES)[number]
  ): Promise<string> {
    if (id.type === 'tmdb') {
      return id.value;
    }

    // Check cache first
    const cacheKey = `${id.type}:${id.value}:${type}`;
    const cachedId = this.idCache.get(cacheKey);
    if (cachedId) {
      return cachedId;
    }

    const url = new URL(API_BASE_URL + FIND_BY_ID_PATH + `/${id.value}`);
    url.searchParams.set('external_source', `${id.type}_id`);

    const response = await fetch(url, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    const results = type === 'movie' ? data.movie_results : data.tv_results;
    const meta = results?.[0];

    if (!meta) {
      throw new Error(`No ${type} metadata found for ID: ${id.value}`);
    }

    const tmdbId = meta.id.toString();
    // Cache the result
    this.idCache.set(cacheKey, tmdbId, ID_CACHE_TTL);
    return tmdbId;
  }

  private parseReleaseDate(releaseDate: string): string {
    const date = new Date(releaseDate);
    return date.getFullYear().toString();
  }

  public async getMetadata(
    id: string,
    type: (typeof TYPES)[number]
  ): Promise<Metadata> {
    if (!['movie', 'series', 'anime'].includes(type)) {
      return { titles: [], year: undefined };
    }

    let metadata: Metadata = { titles: [], year: undefined };

    const externalId = this.parseExternalId(id);
    if (!externalId) {
      throw new Error(
        'Invalid ID format. Must be TMDB (tmdb:123) or IMDB (tt123) or TVDB (tvdb:123) format'
      );
    }

    const tmdbId = await this.convertToTmdbId(externalId, type);

    // Check cache first
    const cacheKey = `${tmdbId}:${type}`;
    const cachedMetadata = this.metadataCache.get(cacheKey);
    if (cachedMetadata) {
      metadata = cachedMetadata;
    }

    // Fetch primary title from details endpoint
    const detailsUrl = new URL(
      API_BASE_URL +
        (type === 'movie' ? MOVIE_DETAILS_PATH : TV_DETAILS_PATH) +
        `/${tmdbId}`
    );

    const detailsResponse = await fetch(detailsUrl, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!detailsResponse.ok) {
      throw new Error(`Failed to fetch details: ${detailsResponse.statusText}`);
    }

    const detailsData = await detailsResponse.json();
    const primaryTitle =
      type === 'movie' ? detailsData.title : detailsData.name;
    const year = this.parseReleaseDate(
      type === 'movie' ? detailsData.release_date : detailsData.first_air_date
    );

    // Fetch alternative titles
    const altTitlesUrl = new URL(
      API_BASE_URL +
        (type === 'movie' ? MOVIE_DETAILS_PATH : TV_DETAILS_PATH) +
        `/${tmdbId}` +
        ALTERNATIVE_TITLES_PATH
    );

    const altTitlesResponse = await fetch(altTitlesUrl, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!altTitlesResponse.ok) {
      throw new Error(
        `Failed to fetch alternative titles: ${altTitlesResponse.statusText}`
      );
    }

    const altTitlesData = await altTitlesResponse.json();
    const alternativeTitles =
      type === 'movie'
        ? altTitlesData.titles.map((title: any) => title.title)
        : altTitlesData.results.map((title: any) => title.title);

    // Combine primary title with alternative titles, ensuring no duplicates
    const allTitles = [primaryTitle, ...alternativeTitles];
    const uniqueTitles = [...new Set(allTitles)];
    metadata.titles = uniqueTitles;
    metadata.year = year;

    // Cache the result
    this.metadataCache.set(cacheKey, metadata, TITLE_CACHE_TTL);
    return metadata;
  }

  public async validateAccessToken() {
    const cacheKey = this.accessToken;
    const cachedResult = this.validationCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    const url = new URL(API_BASE_URL + '/authentication');
    const validationResponse = await fetch(url, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!validationResponse.ok) {
      throw new Error(
        `Failed to validate TMDB access token: ${validationResponse.statusText}`
      );
    }
    const validationData = await validationResponse.json();
    const isValid = validationData.success;
    this.validationCache.set(cacheKey, isValid, ACCESS_TOKEN_CACHE_TTL);
    return isValid;
  }
}
