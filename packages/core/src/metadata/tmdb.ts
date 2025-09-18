import { Headers } from 'undici';
import { Env, Cache, TYPES, makeRequest } from '../utils/index.js';
import { Metadata } from './utils.js';
import { z } from 'zod';

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
const ID_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
const TITLE_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const AUTHORISATION_CACHE_TTL = 2 * 24 * 60 * 60; // 2 days

// Zod schemas for API responses
const MovieDetailsSchema = z.object({
  id: z.number(),
  title: z.string(),
  release_date: z.string().optional(),
  status: z.string(),
});

const TVDetailsSchema = z.object({
  id: z.number(),
  name: z.string(),
  first_air_date: z.string().optional(),
  last_air_date: z.string().optional(),
  status: z.string(),
  seasons: z.array(
    z.object({
      season_number: z.number(),
      episode_count: z.number(),
    })
  ),
});

const MovieAlternativeTitlesSchema = z.object({
  titles: z.array(
    z.object({
      title: z.string(),
    })
  ),
});

const TVAlternativeTitlesSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
    })
  ),
});

const FindResultsSchema = z.object({
  movie_results: z.array(
    z.object({
      id: z.number(),
    })
  ),
  tv_results: z.array(
    z.object({
      id: z.number(),
    })
  ),
});

export class TMDBMetadata {
  private readonly TMDB_ID_REGEX = /^(?:tmdb)[-:](\d+)(?::\d+:\d+)?$/;
  private readonly TVDB_ID_REGEX = /^(?:tvdb)[-:](\d+)(?::\d+:\d+)?$/;
  private readonly IMDB_ID_REGEX = /^(?:tt)(\d+)(?::\d+:\d+)?$/;
  private static readonly idCache: Cache<string, string> = Cache.getInstance<
    string,
    string
  >('tmdb_id_conversion');
  private static readonly metadataCache: Cache<string, Metadata> =
    Cache.getInstance<string, Metadata>('tmdb_metadata');
  private readonly accessToken: string | undefined;
  private readonly apiKey: string | undefined;
  private static readonly validationCache: Cache<string, boolean> =
    Cache.getInstance<string, boolean>('tmdb_validation');
  public constructor(auth?: { accessToken?: string; apiKey?: string }) {
    if (
      !auth?.accessToken &&
      !Env.TMDB_ACCESS_TOKEN &&
      !auth?.apiKey &&
      !Env.TMDB_API_KEY
    ) {
      throw new Error('TMDB Access Token or API Key is not set');
    }
    if (auth?.apiKey || Env.TMDB_API_KEY) {
      this.apiKey = auth?.apiKey || Env.TMDB_API_KEY;
    } else if (auth?.accessToken || Env.TMDB_ACCESS_TOKEN) {
      this.accessToken = auth?.accessToken || Env.TMDB_ACCESS_TOKEN;
    }
  }

  private getHeaders(): Headers {
    const headers = new Headers();
    if (this.accessToken) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    headers.set('Content-Type', 'application/json');
    return headers;
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
    const cachedId = await TMDBMetadata.idCache.get(cacheKey);
    if (cachedId) {
      return cachedId;
    }

    const url = new URL(API_BASE_URL + FIND_BY_ID_PATH + `/${id.value}`);
    url.searchParams.set('external_source', `${id.type}_id`);
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 10000,
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`${response.status} - ${response.statusText}`);
    }

    const data = FindResultsSchema.parse(await response.json());
    const results = type === 'movie' ? data.movie_results : data.tv_results;
    const meta = results[0];

    if (!meta) {
      throw new Error(`No ${type} metadata found for ID: ${id.value}`);
    }

    const tmdbId = meta.id.toString();
    // Cache the result
    TMDBMetadata.idCache.set(cacheKey, tmdbId, ID_CACHE_TTL);
    return tmdbId;
  }

  private parseReleaseDate(releaseDate: string | undefined): string {
    if (!releaseDate) return '0';
    const date = new Date(releaseDate);
    return date.getFullYear().toString();
  }

  public async getMetadata(
    id: string,
    type: (typeof TYPES)[number]
  ): Promise<Metadata> {
    if (!['movie', 'series', 'anime'].includes(type)) {
      throw new Error(`Invalid type: ${type}`);
    }

    const externalId = this.parseExternalId(id);
    if (!externalId) {
      throw new Error(
        'Invalid ID format. Must be TMDB (tmdb:123) or IMDB (tt123) or TVDB (tvdb:123) format'
      );
    }

    const tmdbId = await this.convertToTmdbId(externalId, type);

    // Check cache first
    const cacheKey = `${tmdbId}:${type}`;
    const cachedMetadata = await TMDBMetadata.metadataCache.get(cacheKey);
    if (cachedMetadata) {
      return cachedMetadata;
    }

    // Fetch primary title from details endpoint
    const detailsUrl = new URL(
      API_BASE_URL +
        (type === 'movie' ? MOVIE_DETAILS_PATH : TV_DETAILS_PATH) +
        `/${tmdbId}`
    );
    this.addSearchParams(detailsUrl);
    const detailsResponse = await makeRequest(detailsUrl.toString(), {
      timeout: 10000,
      headers: this.getHeaders(),
    });

    if (!detailsResponse.ok) {
      throw new Error(`Failed to fetch details: ${detailsResponse.statusText}`);
    }

    const detailsJson = await detailsResponse.json();
    const detailsData =
      type === 'movie'
        ? MovieDetailsSchema.parse(detailsJson)
        : TVDetailsSchema.parse(detailsJson);

    const primaryTitle =
      type === 'movie'
        ? (detailsData as z.infer<typeof MovieDetailsSchema>).title
        : (detailsData as z.infer<typeof TVDetailsSchema>).name;
    const year = this.parseReleaseDate(
      type === 'movie'
        ? (detailsData as z.infer<typeof MovieDetailsSchema>).release_date
        : (detailsData as z.infer<typeof TVDetailsSchema>).first_air_date
    );
    const yearEnd =
      type === 'series'
        ? (detailsData as z.infer<typeof TVDetailsSchema>).last_air_date
          ? this.parseReleaseDate(
              (detailsData as z.infer<typeof TVDetailsSchema>).last_air_date
            )
          : undefined
        : undefined;
    const seasons =
      type === 'series'
        ? (detailsData as z.infer<typeof TVDetailsSchema>).seasons
        : undefined;

    // Fetch alternative titles
    const altTitlesUrl = new URL(
      API_BASE_URL +
        (type === 'movie' ? MOVIE_DETAILS_PATH : TV_DETAILS_PATH) +
        `/${tmdbId}` +
        ALTERNATIVE_TITLES_PATH
    );
    this.addSearchParams(altTitlesUrl);
    const altTitlesResponse = await makeRequest(altTitlesUrl.toString(), {
      timeout: 10000,
      headers: this.getHeaders(),
    });

    if (!altTitlesResponse.ok) {
      throw new Error(
        `Failed to fetch alternative titles: ${altTitlesResponse.statusText}`
      );
    }

    const altTitlesJson = await altTitlesResponse.json();
    const altTitlesData =
      type === 'movie'
        ? MovieAlternativeTitlesSchema.parse(altTitlesJson)
        : TVAlternativeTitlesSchema.parse(altTitlesJson);
    const alternativeTitles =
      type === 'movie'
        ? (
            altTitlesData as z.infer<typeof MovieAlternativeTitlesSchema>
          ).titles.map((title) => title.title)
        : (
            altTitlesData as z.infer<typeof TVAlternativeTitlesSchema>
          ).results.map((title) => title.title);

    // Combine primary title with alternative titles, ensuring no duplicates
    const allTitles = [primaryTitle, ...alternativeTitles];
    const uniqueTitles = [...new Set(allTitles)];
    const metadata: Metadata = {
      title: primaryTitle,
      titles: uniqueTitles,
      year: Number(year),
      yearEnd: yearEnd ? Number(yearEnd) : undefined,
      seasons,
    };
    // Cache the result
    TMDBMetadata.metadataCache.set(cacheKey, metadata, TITLE_CACHE_TTL);
    return metadata;
  }

  private addSearchParams(url: URL) {
    if (this.apiKey) {
      url.searchParams.set('api_key', this.apiKey);
    }
  }

  public async validateAuthorisation() {
    const cacheKey = this.accessToken || this.apiKey;
    if (!cacheKey) {
      throw new Error('TMDB Access Token or API Key is not set');
    }
    const cachedResult = await TMDBMetadata.validationCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    const url = new URL(API_BASE_URL + '/authentication');
    this.addSearchParams(url);
    const validationResponse = await makeRequest(url.toString(), {
      timeout: 10000,
      headers: this.getHeaders(),
    });
    if (!validationResponse.ok) {
      throw new Error(
        `Failed to validate TMDB authorisation, ensure you have set a valid access token or API key: ${validationResponse.statusText}`
      );
    }
    const validationData: any = await validationResponse.json();
    const isValid = validationData.success;
    TMDBMetadata.validationCache.set(
      cacheKey,
      isValid,
      AUTHORISATION_CACHE_TTL
    );
    return isValid;
  }
}
