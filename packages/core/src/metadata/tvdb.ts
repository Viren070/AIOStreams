import { createLogger } from '../utils/logger.js';
import { Cache, DistributedLock, Env, ParsedId } from '../utils/index.js';
import { Metadata } from './utils.js';
import { makeRequest } from '../utils/http.js';
import { z } from 'zod';

const logger = createLogger('tvdb');

interface TVDBMetadataConfig {
  apiKey?: string;
}

const API_VERSION = '4';
const API_BASE_URL = `https://api${API_VERSION}.thetvdb.com`;
const TVDBAliasSchema = z.object({
  language: z.string(),
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
  image: z.string().url(),
  nameTranslations: z.array(z.string()),
  overviewTranslations: z.array(z.string()),
  aliases: z.array(TVDBAliasSchema),
  score: z.number(),
  lastUpdated: z.string(),
  year: z.string(),
  status: TVDBStatusSchema,
});

const TVDBSeriesRecordSchema = TVDBBaseRecordSchema.extend({
  firstAired: z.string().optional(),
  lastAired: z.string().optional(),
  nextAired: z.string().optional(),
  originalCountry: z.string().optional(),
  originalLanguage: z.string().optional(),
  defaultSeasonType: z.number().optional(),
  isOrderRandomized: z.boolean().optional(),
  averageRuntime: z.number().optional(),
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
  averageRuntime: z.number().optional(),
  episodes: z.unknown().nullable().optional(),
  overview: z.string().optional(),
  year: z.string(),
});

const TVDBRemoteIdDataSchema = z.union([
  z.object({ movie: TVDBMovieSchema }),
  z.object({ series: TVDBSeriesSchema }),
]);

export const RemoteIdSearchResponseSchema = z.discriminatedUnion('status', [
  TVDBSuccessSchema(z.array(TVDBRemoteIdDataSchema)),
  TVDBErrorSchema,
]);

export const SeriesResponseSchema = z.discriminatedUnion('status', [
  TVDBSuccessSchema(TVDBSeriesRecordSchema),
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
  private readonly api: TVDBApi;
  public constructor(config: TVDBMetadataConfig) {
    const apiKey = config.apiKey || Env.TVDB_API_KEY;
    if (!apiKey) {
      throw new Error('TVDB API key is not set');
    }
    this.api = new TVDBApi(apiKey);
  }

  private async ensureToken(): Promise<void> {
    await this.api.ensureToken();
  }

  public async validateApiKey() {
    await this.ensureToken();
  }

  public async getMetadata(id: ParsedId): Promise<Metadata> {
    if (!['imdbId', 'themoviedbId', 'thetvdbId'].includes(id.type)) {
      throw new Error(`Invalid ID type: ${id.type}`);
    }
    await this.ensureToken();

    if (id.type !== 'thetvdbId') {
      const response = await this.api.searchRemoteId(id.value.toString());
      if (!response.data?.[0]) {
        throw new Error(`No results found for ${id.value}`);
      }

      const item = response.data[0];
      if ('movie' in item) {
        const movie = item.movie;
        return {
          title: movie.name,
          titles: movie.aliases.map((a) => a.name),
          year: parseInt(movie.year),
          tvdbId: movie.id,
          tmdbId: null,
        };
      } else {
        const series = item.series;
        return {
          title: series.name,
          titles: series.aliases.map((a) => a.name),
          year: parseInt(series.year),
          yearEnd: series.lastAired
            ? new Date(series.lastAired).getFullYear()
            : undefined,
          tvdbId: series.id,
          tmdbId: null,
        };
      }
    } else {
      // Direct TVDB ID lookup
      const tvdbId = parseInt(id.value.toString());

      if (id.mediaType === 'movie') {
        const response = await this.api.getMovie(tvdbId);
        if (!response.data) {
          throw new Error(`No movie found for TVDB ID ${tvdbId}`);
        }
        return {
          title: response.data.name,
          titles: response.data.aliases.map((a) => a.name),
          year: parseInt(response.data.year),
          tvdbId: response.data.id,
          tmdbId: null,
        };
      } else {
        // Handle both series and anime the same way
        const response = await this.api.getSeries(tvdbId);
        if (!response.data) {
          throw new Error(`No series found for TVDB ID ${tvdbId}`);
        }
        const series = response.data;
        return {
          title: series.name,
          titles: series.aliases.map((a) => a.name),
          year: parseInt(series.year),
          yearEnd: series.lastAired
            ? new Date(series.lastAired).getFullYear()
            : undefined,
          tvdbId: series.id,
          tmdbId: null,
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
    movie: Cache.getInstance<number, z.infer<typeof MovieResponseSchema>>(
      'tvdb:movie'
    ),
    // prettier-ignore
    remoteId: Cache.getInstance<string, z.infer<typeof RemoteIdSearchResponseSchema>>('tvdb:remoteId'),
  };

  constructor(apiKey: string) {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': Env.DEFAULT_USER_AGENT,
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
      'token',
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
          }
        );
      },
      remoteId,
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
          }
        );
      },
      id,
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
        timeout: options.timeout ?? Env.MAX_TIMEOUT,
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
      logger.error(
        `Request to ${path} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error instanceof Error
        ? error
        : new Error('Unknown error occurred');
    }
  }
}
