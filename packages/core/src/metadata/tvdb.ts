import { createLogger } from '../logging/logger.js';
import { Cache, appConfig, formatZodError, ParsedId } from '../utils/index.js';
import { Metadata, MetadataTitle } from './utils.js';
import { iso6392ToIso6391 } from '../utils/languages.js';
import { normaliseCountryCode } from '../utils/countries.js';
import { makeRequest } from '../utils/http.js';
import { z, ZodError } from 'zod';

const logger = createLogger('tvdb');

interface TVDBMetadataConfig {
  apiKey?: string;
}

const API_VERSION = '4';
const API_BASE_URL = `https://api${API_VERSION}.thetvdb.com`;
const TVDBAliasSchema = z.object({
  language: z.string(), // A 3-4 character string indicating the language of the alias, as defined in Language
  name: z.string(),
});

const TVDBErrorSchema = z.object({
  status: z.enum(['failure', 'error']),
  data: z.null(),
  message: z.string(),
});

type TVDBError = z.infer<typeof TVDBErrorSchema>;

const TVDBSuccessSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    status: z.literal('success'),
    data: dataSchema,
  });

const AuthTokenDataSchema = z.object({
  token: z.string(),
});

const AuthTokenSchema = z.discriminatedUnion('status', [
  TVDBSuccessSchema(AuthTokenDataSchema),
  TVDBErrorSchema,
]);

// --- /search/remoteId endpoint schema ---
const TVDBStatusSchema = z.object({
  id: z.number().nullable(),
  name: z.string().nullable(),
  recordType: z.string(),
  keepUpdated: z.boolean(),
});

// Base schemas for common fields
const TVDBBaseRecordSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  image: z.url().nullable(),
  nameTranslations: z.array(z.string()),
  overviewTranslations: z.array(z.string()),
  aliases: z.array(TVDBAliasSchema),
  score: z.number(),
  lastUpdated: z.string(),
  year: z.string(),
  status: TVDBStatusSchema,
});

const TVDBSeriesSeasonSchema = z.object({
  type: z.object({ type: z.string() }),
  number: z.number(),
});

const TVDBSeriesRecordSchema = TVDBBaseRecordSchema.extend({
  firstAired: z.string().optional(),
  lastAired: z.string().optional(),
  nextAired: z.string().optional(),
  originalCountry: z.string().optional(),
  originalLanguage: z.string().optional(),
  defaultSeasonType: z.number().optional(),
  isOrderRandomized: z.boolean().optional(),
  averageRuntime: z.number().nullable().optional(),
  episodes: z.unknown().nullable().optional(),
  overview: z.string().optional(),
});

const TVDBMovieRecordSchema = TVDBBaseRecordSchema.extend({
  runtime: z.number(),
});

const TVDBMovieSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  image: z.string().url(),
  nameTranslations: z.array(z.string()),
  overviewTranslations: z.array(z.string()),
  aliases: z.array(TVDBAliasSchema),
  score: z.number(),
  runtime: z.number(),
  status: TVDBStatusSchema,
  lastUpdated: z.string(),
  year: z.string(),
});

const TVDBSeriesSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  image: z.string().url(),
  nameTranslations: z.array(z.string()),
  overviewTranslations: z.array(z.string()),
  aliases: z.array(TVDBAliasSchema),
  firstAired: z.string().optional(),
  lastAired: z.string().optional(),
  nextAired: z.string().optional(),
  score: z.number(),
  status: TVDBStatusSchema,
  originalCountry: z.string().optional(),
  originalLanguage: z.string().optional(),
  defaultSeasonType: z.number().optional(),
  isOrderRandomized: z.boolean().optional(),
  lastUpdated: z.string(),
  averageRuntime: z.number().nullable().optional(),
  episodes: z.unknown().nullable().optional(),
  overview: z.string().optional(),
  year: z.string(),
});

const TVDBEpisodeSchema = z.looseObject({});

const TVDBSeasonSchema = z.looseObject({});

const TVDBRemoteIdDataSchema = z.union([
  z.object({ movie: TVDBMovieSchema }),
  z.object({ series: TVDBSeriesSchema }),
  z.object({ episode: TVDBEpisodeSchema }),
  z.object({ season: TVDBSeasonSchema }),
]);

export const RemoteIdSearchResponseSchema = z.discriminatedUnion('status', [
  TVDBSuccessSchema(z.array(TVDBRemoteIdDataSchema)),
  TVDBErrorSchema,
]);

export const SeriesResponseSchema = z.discriminatedUnion('status', [
  TVDBSuccessSchema(TVDBSeriesRecordSchema),
  TVDBErrorSchema,
]);

const TVDBSeriesSeasonsSchema = z.object({
  seasons: z.array(TVDBSeriesSeasonSchema).optional(),
});

export const SeriesSeasonsResponseSchema = z.discriminatedUnion('status', [
  TVDBSuccessSchema(TVDBSeriesSeasonsSchema),
  TVDBErrorSchema,
]);

const TVDBSeasonEpisodeSchema = z.looseObject({
  number: z.number().optional(),
  seasonNumber: z.number().optional(),
  aired: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});

export interface TVDBSeasonEpisode {
  number: number;
  seasonNumber: number;
  aired: string | null;
  /** Episode name in the series' default language (original for anime). */
  name?: string;
}

const SeriesEpisodesResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    data: z.looseObject({
      episodes: z.array(TVDBSeasonEpisodeSchema).nullable().optional(),
    }),
    links: z
      .looseObject({ next: z.string().nullable().optional() })
      .nullable()
      .optional(),
  }),
  TVDBErrorSchema,
]);

const SearchResultSchema = z.looseObject({
  tvdb_id: z.string().optional(),
  name: z.string().optional(),
  year: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
});

const SearchResponseSchema = z.discriminatedUnion('status', [
  TVDBSuccessSchema(z.array(SearchResultSchema)),
  TVDBErrorSchema,
]);

export interface TVDBSeriesSearchResult {
  tvdbId: number;
  name: string;
  year?: number;
  country?: string;
}

const SeriesTranslationResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    data: z.looseObject({
      name: z.string().nullable().optional(),
    }),
  }),
  TVDBErrorSchema,
]);

export const MovieResponseSchema = z.discriminatedUnion('status', [
  TVDBSuccessSchema(TVDBMovieRecordSchema),
  TVDBErrorSchema,
]);

export type RemoteIdSearchResponse = z.infer<
  typeof RemoteIdSearchResponseSchema
>;

export class TVDBMetadata {
  private static readonly ID_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
  private readonly api: TVDBApi;

  private idCache = Cache.getInstance<string, string>('tvdb:id-map');

  public constructor(config: TVDBMetadataConfig) {
    const apiKey = config.apiKey || appConfig.metadata.tvdb.apiKey;
    if (!apiKey) {
      throw new Error('TVDB API key is not set');
    }
    this.api = new TVDBApi(apiKey);
  }

  private async ensureToken(): Promise<void> {
    await this.api.ensureToken();
  }

  /**
   * Builds the series title/alias set, preferring the English translation over
   * TVDB's original-language `name` for non-English shows (keeping the original
   * as a searchable alias). English shows skip the extra translation fetch.
   */
  private async buildSeriesTitles(
    seriesId: number,
    rawName: string,
    aliases: MetadataTitle[],
    originalLanguage?: string
  ): Promise<{ title: string; titles: MetadataTitle[] }> {
    if (originalLanguage && originalLanguage !== 'eng') {
      try {
        const engName = await this.api.getSeriesTranslation(seriesId, 'eng');
        if (engName && engName !== rawName) {
          return {
            title: engName,
            titles: [{ title: rawName }, ...aliases],
          };
        }
      } catch {
        // fall through to the raw name
      }
    }
    return { title: rawName, titles: aliases };
  }

  public async validateApiKey() {
    await this.ensureToken();
  }

  public async getSeasonEpisodes(
    tvdbId: number,
    seasonNumber: number
  ): Promise<TVDBSeasonEpisode[] | undefined> {
    try {
      await this.ensureToken();
      return await this.api.getSeriesEpisodes(tvdbId, seasonNumber);
    } catch (error) {
      logger.warn(
        `Failed to fetch TVDB episodes for series ${tvdbId} season ${seasonNumber}: ${error instanceof Error ? error.message : error}`
      );
      return undefined;
    }
  }

  public async getSeasonNumbers(tvdbId: number): Promise<number[] | undefined> {
    try {
      await this.ensureToken();
      const response = await this.api.getSeriesSeasons(tvdbId);
      return response.data?.seasons
        ?.filter((s) => s.type.type === 'official' && s.number !== 0)
        .map((s) => s.number);
    } catch (error) {
      logger.warn(
        `Failed to fetch TVDB season numbers for series ${tvdbId}: ${error instanceof Error ? error.message : error}`
      );
      return undefined;
    }
  }

  public async searchSeries(query: string): Promise<TVDBSeriesSearchResult[]> {
    await this.ensureToken();
    const results = await this.api.search(query, 'series');
    return results
      .filter((r) => r.tvdb_id && r.name)
      .map((r) => {
        const year = r.year ? parseInt(r.year) : undefined;
        return {
          tvdbId: parseInt(r.tvdb_id!),
          name: r.name!,
          year: year && !Number.isNaN(year) ? year : undefined,
          country: normaliseCountryCode(r.country),
        };
      })
      .filter((r) => !Number.isNaN(r.tvdbId));
  }

  public async getMetadata(id: ParsedId): Promise<Metadata> {
    if (!['imdbId', 'themoviedbId', 'thetvdbId'].includes(id.type)) {
      throw new Error(`Invalid ID type: ${id.type}`);
    }
    await this.ensureToken();

    let tvdbId: number | null = null;
    if (id.type === 'thetvdbId') {
      tvdbId = parseInt(id.value.toString());
    }

    const cachedTvdbId = await this.idCache.get(id.fullId);
    if (cachedTvdbId) {
      tvdbId = parseInt(cachedTvdbId);
      logger.debug(`Using cached TVDB ID for ${id.fullId}: ${tvdbId}`);
    }

    if (!tvdbId) {
      const response = await this.api.searchRemoteId(id.value.toString());
      if (!response.data?.[0]) {
        throw new Error(`No results found for ${id.value}`);
      }

      const items = response.data;
      const item = items.find((item) =>
        id.mediaType === 'movie' ? 'movie' in item : 'series' in item
      );
      if (!item) {
        throw new Error(`Could not find metadata for ${id.value}`);
      }
      if ('movie' in item) {
        const movie = item.movie;
        this.idCache.set(
          id.fullId,
          movie.id.toString(),
          TVDBMetadata.ID_CACHE_TTL
        );
        return {
          title: movie.name,
          titles: movie.aliases.map((a) => ({
            title: a.name,
            language: iso6392ToIso6391(a.language) || undefined,
          })),
          year: parseInt(movie.year),
          tvdbId: movie.id,
          tmdbId: null,
          runtime: movie.runtime,
        };
      } else if ('series' in item) {
        const series = item.series;
        this.idCache.set(
          id.fullId,
          series.id.toString(),
          TVDBMetadata.ID_CACHE_TTL
        );
        const { title, titles } = await this.buildSeriesTitles(
          series.id,
          series.name,
          series.aliases.map((a) => ({
            title: a.name,
            language: iso6392ToIso6391(a.language) || undefined,
          })),
          series.originalLanguage
        );
        return {
          title,
          titles,
          year: parseInt(series.year),
          yearEnd: series.lastAired
            ? new Date(series.lastAired).getFullYear()
            : undefined,
          tvdbId: series.id,
          tmdbId: null,
          runtime: series.averageRuntime ?? undefined,
          nextAirDate: series.nextAired ?? undefined,
          firstAiredDate: series.firstAired ?? undefined,
          lastAiredDate: series.lastAired ?? undefined,
          originalLanguage: series.originalLanguage
            ? iso6392ToIso6391(series.originalLanguage) || undefined
            : undefined,
          country: normaliseCountryCode(series.originalCountry),
        };
      } else {
        throw new Error(`Could not find metadata for ${id.value}`);
      }
    } else {
      if (id.mediaType === 'movie') {
        const response = await this.api.getMovie(tvdbId);
        if (!response.data) {
          throw new Error(`No movie found for TVDB ID ${tvdbId}`);
        }
        return {
          title: response.data.name,
          titles: response.data.aliases.map((a) => ({
            title: a.name,
            language: iso6392ToIso6391(a.language) || undefined,
          })),
          year: parseInt(response.data.year),
          tvdbId: response.data.id,
          tmdbId: null,
          runtime: response.data.runtime,
        };
      } else {
        // Handle both series and anime the same way
        const response = await this.api.getSeries(tvdbId);
        if (!response.data) {
          throw new Error(`No series found for TVDB ID ${tvdbId}`);
        }
        const series = response.data;
        const { title, titles } = await this.buildSeriesTitles(
          series.id,
          series.name,
          series.aliases.map((a) => ({
            title: a.name,
            language: iso6392ToIso6391(a.language) || undefined,
          })),
          series.originalLanguage
        );
        return {
          title,
          titles,
          year: parseInt(series.year),
          yearEnd: series.lastAired
            ? new Date(series.lastAired).getFullYear()
            : undefined,
          tvdbId: series.id,
          tmdbId: null,
          runtime: series.averageRuntime ?? undefined,
          nextAirDate: series.nextAired ?? undefined,
          firstAiredDate: series.firstAired ?? undefined,
          lastAiredDate: series.lastAired ?? undefined,
          originalLanguage: series.originalLanguage
            ? iso6392ToIso6391(series.originalLanguage) || undefined
            : undefined,
          country: normaliseCountryCode(series.originalCountry),
        };
      }
    }
  }
}

class TVDBApi {
  private headers: Record<string, string>;
  private readonly apiKey: string;

  // Cache instances
  private readonly cache = {
    token: Cache.getInstance<string, string>('tvdb:token'),
    series: Cache.getInstance<number, z.infer<typeof SeriesResponseSchema>>(
      'tvdb:series'
    ),
    // prettier-ignore
    seriesSeasons: Cache.getInstance<number, z.infer<typeof SeriesSeasonsResponseSchema>>('tvdb:seriesSeasons'),
    movie: Cache.getInstance<number, z.infer<typeof MovieResponseSchema>>(
      'tvdb:movie'
    ),
    // prettier-ignore
    remoteId: Cache.getInstance<string, z.infer<typeof RemoteIdSearchResponseSchema>>('tvdb:remoteId'),
    // prettier-ignore
    search: Cache.getInstance<string, z.infer<typeof SearchResultSchema>[]>('tvdb:search'),
    // prettier-ignore
    seriesEpisodes: Cache.getInstance<string, TVDBSeasonEpisode[]>('tvdb:seriesEpisodes'),
    seriesTranslation: Cache.getInstance<string, string | null>(
      'tvdb:seriesTranslation'
    ),
  };

  constructor(apiKey: string) {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': appConfig.http.defaultUserAgent,
      Accept: 'application/json',
    };
    this.apiKey = apiKey;
  }

  private setToken(token: string): void {
    this.headers.Authorization = `Bearer ${token}`;
  }

  public async ensureToken(): Promise<void> {
    const getToken = async () => {
      logger.debug('Logging in to TVDB API');
      const response = await this.request<z.infer<typeof AuthTokenSchema>>(
        '/login',
        {
          schema: AuthTokenSchema,
          method: 'POST',
          timeout: 3000,
          body: {
            apikey: this.apiKey,
          },
        }
      );

      if (response.status === 'success') {
        return response.data.token;
      }
      throw new Error(`Failed to authenticate with TVDB: ${response.message}`);
    };

    const token = await this.cache.token.wrap(
      getToken,
      this.apiKey,
      30 * 24 * 60 * 60 // 30 days
    );

    this.setToken(token);
  }

  public async searchRemoteId(
    remoteId: string
  ): Promise<z.infer<typeof RemoteIdSearchResponseSchema>> {
    return this.cache.remoteId.wrap(
      async () => {
        logger.debug(`Searching for remote ID: ${remoteId}`);
        return this.request<z.infer<typeof RemoteIdSearchResponseSchema>>(
          `/search/remoteid/${remoteId}`,
          {
            schema: RemoteIdSearchResponseSchema,
            timeout: 5000,
          }
        );
      },
      remoteId,
      7 * 24 * 60 * 60 // 7 days
    );
  }

  public async search(
    query: string,
    type: 'series' | 'movie'
  ): Promise<z.infer<typeof SearchResultSchema>[]> {
    return this.cache.search.wrap(
      async () => {
        logger.debug(`Searching TVDB: ${query} (${type})`);
        const response = await this.request<
          z.infer<typeof SearchResponseSchema>
        >(`/search?query=${encodeURIComponent(query)}&type=${type}`, {
          schema: SearchResponseSchema,
          timeout: 5000,
        });
        return response.status === 'success' ? response.data : [];
      },
      `${type}:${query.toLowerCase()}`,
      7 * 24 * 60 * 60 // 7 days
    );
  }

  public async getSeries(
    id: number
  ): Promise<z.infer<typeof SeriesResponseSchema>> {
    return this.cache.series.wrap(
      async () => {
        logger.debug(`Getting series: ${id}`);
        return this.request<z.infer<typeof SeriesResponseSchema>>(
          `/series/${id}`,
          {
            schema: SeriesResponseSchema,
            timeout: 5000,
          }
        );
      },
      id,
      7 * 24 * 60 * 60 // 7 days
    );
  }

  public async getSeriesSeasons(
    id: number
  ): Promise<z.infer<typeof SeriesSeasonsResponseSchema>> {
    return this.cache.seriesSeasons.wrap(
      async () => {
        logger.debug(`Getting series seasons: ${id}`);
        return this.request<z.infer<typeof SeriesSeasonsResponseSchema>>(
          `/series/${id}/extended?short=true`,
          {
            schema: SeriesSeasonsResponseSchema,
            timeout: 5000,
          }
        );
      },
      id,
      7 * 24 * 60 * 60 // 7 days
    );
  }

  public async getSeriesEpisodes(
    id: number,
    seasonNumber: number
  ): Promise<TVDBSeasonEpisode[]> {
    return this.cache.seriesEpisodes.wrap(
      async () => {
        logger.debug(
          `Getting episodes for series ${id} season ${seasonNumber}`
        );
        const episodes: TVDBSeasonEpisode[] = [];
        // links.next signals more pages (page size 500); daily-show seasons fit one page
        for (let page = 0; page < 10; page++) {
          const response = await this.request<
            z.infer<typeof SeriesEpisodesResponseSchema>
          >(
            `/series/${id}/episodes/default?season=${seasonNumber}&page=${page}`,
            {
              schema: SeriesEpisodesResponseSchema,
              timeout: 5000,
            }
          );
          if (response.status !== 'success') break;
          for (const ep of response.data.episodes ?? []) {
            if (ep.number === undefined || ep.seasonNumber === undefined) {
              continue;
            }
            episodes.push({
              number: ep.number,
              seasonNumber: ep.seasonNumber,
              aired: ep.aired ?? null,
              name: ep.name ?? undefined,
            });
          }
          if (!response.links?.next) break;
        }
        return episodes;
      },
      `${id}:${seasonNumber}`,
      24 * 60 * 60 // 1 day: ongoing daily shows gain an episode per day
    );
  }

  /**
   * The English-translation name for a series. TVDB's default `name` is the
   * original-language title (e.g. native script for East Asian dramas); the
   * English title that scene groups use only lives in the translation.
   */
  public async getSeriesTranslation(
    id: number,
    lang: string = 'eng'
  ): Promise<string | null> {
    return this.cache.seriesTranslation.wrap(
      async () => {
        const response = await this.request<
          z.infer<typeof SeriesTranslationResponseSchema>
        >(`/series/${id}/translations/${lang}`, {
          schema: SeriesTranslationResponseSchema,
          timeout: 5000,
        });
        return response.status === 'success'
          ? (response.data.name ?? null)
          : null;
      },
      `${id}:${lang}`,
      7 * 24 * 60 * 60 // 7 days
    );
  }

  public async getMovie(
    id: number
  ): Promise<z.infer<typeof MovieResponseSchema>> {
    return this.cache.movie.wrap(
      async () => {
        logger.debug(`Getting movie: ${id}`);
        return this.request<z.infer<typeof MovieResponseSchema>>(
          `/movies/${id}`,
          {
            schema: MovieResponseSchema,
            timeout: 5000,
          }
        );
      },
      id,
      7 * 24 * 60 * 60 // 7 days
    );
  }

  private async request<T>(
    endpoint: string,
    options: {
      schema: z.ZodSchema<T>;
      body?: unknown;
      method?: string;
      timeout?: number;
    }
  ): Promise<T> {
    const { schema, body, method = 'GET' } = options;
    const path = `/v${API_VERSION}/${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;
    const url = new URL(path, API_BASE_URL);

    logger.debug(`Making ${method} request to ${path}`);

    try {
      const response = await makeRequest(url.toString(), {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
        timeout: options.timeout ?? appConfig.userLimits.timeouts.maxTimeout,
      });

      const data = (await response.json()) as unknown;

      // Check for API error response
      if (typeof data === 'object' && data && 'status' in data) {
        const status = (data as { status: unknown }).status;
        if (!response.ok || status === 'error' || status === 'failure') {
          const message =
            'message' in data
              ? String((data as { message: unknown }).message)
              : response.statusText;
          throw new Error(`TVDB API error (${response.status}): ${message}`);
        }
      } else if (!response.ok) {
        throw new Error(
          `TVDB API error (${response.status}): ${response.statusText}`
        );
      }

      return schema.parse(data);
    } catch (error) {
      throw new Error(
        error instanceof ZodError
          ? `Failed to parse response from TVDB: ${formatZodError(error)}`
          : `Request to TVDB API failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
