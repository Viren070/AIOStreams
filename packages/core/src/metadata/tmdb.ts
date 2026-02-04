import { Headers } from 'undici';
import { Env, Cache, makeRequest, ParsedId, IdType } from '../utils/index.js';
import { Metadata } from './utils.js';
import { z } from 'zod';

export type TMDBIdType = 'imdb_id' | 'tmdb_id' | 'tvdb_id';

// interface ExternalId {
//   type: ExternalIdType;
//   value: string;
// }

const API_BASE_URL = 'https://api.themoviedb.org/3';
const FIND_BY_ID_PATH = '/find';
const MOVIE_DETAILS_PATH = '/movie';
const MOVIE_TRANSLATIONS_PATH = (id: string) => `/movie/${id}/translations`;
const TV_DETAILS_PATH = '/tv';
const TV_TRANSLATIONS_PATH = (id: string) => `/tv/${id}/translations`;
const ALTERNATIVE_TITLES_PATH = '/alternative_titles';

// Cache TTLs in seconds
const ID_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
const TITLE_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const AUTHORISATION_CACHE_TTL = 2 * 24 * 60 * 60; // 2 days

// Zod schemas for API responses
const GenreSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const MovieDetailsSchema = z.object({
  id: z.number(),
  title: z.string(),
  release_date: z.string().optional(),
  status: z.string(),
  original_title: z.string().optional(),
  original_language: z.string().optional(),
  runtime: z.number().nullable().optional(),
  genres: z.array(GenreSchema).optional(),
});

const TVDetailsSchema = z.object({
  id: z.number(),
  name: z.string(),
  first_air_date: z.string().nullable().optional(),
  last_air_date: z.string().nullable().optional(),
  status: z.string(),
  original_title: z.string().optional(),
  original_language: z.string().optional(),
  episode_run_time: z.array(z.number()).optional(),
  seasons: z.array(
    z.object({
      season_number: z.number(),
      episode_count: z.number(),
    })
  ),
  genres: z.array(GenreSchema).optional(),
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

const TranslationsSchema = z.object({
  id: z.number(),
  translations: z.array(
    z.object({
      iso_3166_1: z.string(),
      iso_639_1: z.string(),
      name: z.string(),
      english_name: z.string(),
      data: z.object({
        title: z.string().optional(),
        name: z.string().optional(),
      }),
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

const ReleaseDateSchema = z.object({
  release_date: z.string(),
  type: z.number().min(0).max(6),
});

export type ReleaseDate = z.infer<typeof ReleaseDateSchema>;

const ReleaseDatesResponseSchema = z.object({
  id: z.number(),
  results: z.array(
    z.object({
      iso_3166_1: z.string(),
      release_dates: z.array(ReleaseDateSchema),
    })
  ),
});

const TVEpisodeDetailsSchema = z.object({
  id: z.number(),
  air_date: z.string().nullable().optional(),
  episode_number: z.number(),
  name: z.string(),
  overview: z.string().optional(),
  season_number: z.number(),
  still_path: z.string().nullable().optional(),
});

const IdTypeMap: Partial<Record<IdType, TMDBIdType>> = {
  imdbId: 'imdb_id',
  thetvdbId: 'tvdb_id',
  themoviedbId: 'tmdb_id',
};

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

  private async convertToTmdbId(parsedId: ParsedId): Promise<string> {
    if (parsedId.type === 'themoviedbId') {
      return parsedId.value.toString();
    }

    // Check cache first
    const cacheKey = `${parsedId.type}:${parsedId.value}:${parsedId.mediaType}`;
    const cachedId = await TMDBMetadata.idCache.get(cacheKey);
    if (cachedId) {
      return cachedId;
    }

    const url = new URL(API_BASE_URL + FIND_BY_ID_PATH + `/${parsedId.value}`);
    url.searchParams.set('external_source', `${IdTypeMap[parsedId.type]}`);
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`${response.status} - ${response.statusText}`);
    }

    const data = FindResultsSchema.parse(await response.json());
    const results =
      parsedId.mediaType === 'movie' ? data.movie_results : data.tv_results;
    const meta = results[0];

    if (!meta) {
      throw new Error(
        `No ${parsedId.mediaType} metadata found for ID: ${parsedId.type}:${parsedId.value}`
      );
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

  private async fetchAlternativeTitles(
    url: URL,
    mediaType: string
  ): Promise<string[]> {
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch alternative titles: ${response.statusText}`
      );
    }

    const json = await response.json();

    if (mediaType === 'movie') {
      const data = MovieAlternativeTitlesSchema.parse(json);
      return data.titles.map((title) => title.title);
    } else {
      const data = TVAlternativeTitlesSchema.parse(json);
      return data.results.map((title) => title.title);
    }
  }

  private async fetchTranslatedTitles(
    url: URL,
    mediaType: string
  ): Promise<string[]> {
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch translations: ${response.statusText}`);
    }

    const json = await response.json();
    const data = TranslationsSchema.parse(json);
    return data.translations
      .map((translation) => translation.data.title || translation.data.name)
      .filter((s): s is string => Boolean(s));
  }

  public async getMetadata(parsedId: ParsedId): Promise<Metadata> {
    if (!['movie', 'series', 'anime'].includes(parsedId.mediaType)) {
      throw new Error(`Invalid media type: ${parsedId.mediaType}`);
    }
    if (!['imdbId', 'thetvdbId', 'themoviedbId'].includes(parsedId.type)) {
      throw new Error(`Invalid ID type: ${parsedId.type}`);
    }

    const tmdbId = await this.convertToTmdbId(parsedId);

    // Check cache first
    const cacheKey = `${tmdbId}:${parsedId.mediaType}`;
    const cachedMetadata = await TMDBMetadata.metadataCache.get(cacheKey);
    if (cachedMetadata) {
      return { ...cachedMetadata, tmdbId: Number(tmdbId) };
    }

    // Fetch primary title from details endpoint
    const detailsUrl = new URL(
      API_BASE_URL +
        (parsedId.mediaType === 'movie'
          ? MOVIE_DETAILS_PATH
          : TV_DETAILS_PATH) +
        `/${tmdbId}`
    );
    this.addSearchParams(detailsUrl);
    const detailsResponse = await makeRequest(detailsUrl.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });

    if (!detailsResponse.ok) {
      throw new Error(`Failed to fetch details: ${detailsResponse.statusText}`);
    }

    const detailsJson = await detailsResponse.json();

    // Parse and extract data based on media type
    let primaryTitle: string;
    let releaseDate: string | undefined;
    let yearEnd: string | undefined;
    let seasons:
      | Array<{ season_number: number; episode_count: number }>
      | undefined;
    let allTitles: string[] = [];
    let originalLanguage: string | undefined;
    let runtime: number | undefined;
    let genres: string[] = [];

    if (parsedId.mediaType === 'movie') {
      const movieData = MovieDetailsSchema.parse(detailsJson);
      primaryTitle =
        movieData.original_language !== 'en'
          ? (movieData.original_title ?? movieData.title)
          : movieData.title;
      if (movieData.original_title) {
        allTitles.push(movieData.original_title);
      }
      originalLanguage = movieData.original_language;
      releaseDate = movieData.release_date;
      runtime = movieData.runtime || undefined;
      genres = movieData.genres?.map((g) => g.name) ?? [];
    } else {
      const tvData = TVDetailsSchema.parse(detailsJson);
      primaryTitle =
        tvData.original_language !== 'en'
          ? (tvData.original_title ?? tvData.name)
          : tvData.name;
      if (tvData.original_title) {
        allTitles.push(tvData.original_title);
      }
      originalLanguage = tvData.original_language;
      releaseDate = tvData.first_air_date ?? undefined;
      yearEnd = tvData.last_air_date
        ? this.parseReleaseDate(tvData.last_air_date)
        : undefined;
      seasons = tvData.seasons;
      if (tvData.episode_run_time && tvData.episode_run_time.length > 0) {
        // Calculate average runtime
        runtime = Math.round(
          tvData.episode_run_time.reduce((a, b) => a + b, 0) /
            tvData.episode_run_time.length
        );
      }
      genres = tvData.genres?.map((g) => g.name) ?? [];
    }

    allTitles.push(primaryTitle);

    const year = this.parseReleaseDate(releaseDate);

    // Fetch alternative titles and translations in parallel
    const altTitlesUrl = new URL(
      API_BASE_URL +
        (parsedId.mediaType === 'movie'
          ? MOVIE_DETAILS_PATH
          : TV_DETAILS_PATH) +
        `/${tmdbId}` +
        ALTERNATIVE_TITLES_PATH
    );
    const translatedTitlesUrl = new URL(
      API_BASE_URL +
        (parsedId.mediaType === 'movie'
          ? MOVIE_TRANSLATIONS_PATH(tmdbId)
          : TV_TRANSLATIONS_PATH(tmdbId))
    );
    this.addSearchParams(altTitlesUrl);
    this.addSearchParams(translatedTitlesUrl);

    const [altTitlesResult, translationsResult] = await Promise.allSettled([
      this.fetchAlternativeTitles(altTitlesUrl, parsedId.mediaType),
      this.fetchTranslatedTitles(translatedTitlesUrl, parsedId.mediaType),
    ]);

    if (altTitlesResult.status === 'fulfilled') {
      allTitles.push(...altTitlesResult.value);
    }

    if (translationsResult.status === 'fulfilled') {
      allTitles.push(...translationsResult.value);
    }

    // If both requests failed, we should throw an error
    if (
      altTitlesResult.status === 'rejected' &&
      translationsResult.status === 'rejected'
    ) {
      throw new Error(
        `Failed to fetch both alternative titles and translations: ${altTitlesResult.reason}, ${translationsResult.reason}`
      );
    }

    const uniqueTitles = [...new Set(allTitles)];
    const metadata: Metadata = {
      title: primaryTitle,
      titles: uniqueTitles,
      releaseDate: releaseDate,
      year: Number(year),
      yearEnd: yearEnd ? Number(yearEnd) : undefined,
      originalLanguage,
      seasons,
      tmdbId: Number(tmdbId),
      tvdbId: null,
      runtime: runtime,
      genres: genres.length > 0 ? genres : undefined,
    };
    // Cache the result
    TMDBMetadata.metadataCache.set(cacheKey, metadata, TITLE_CACHE_TTL);
    return { ...metadata, tmdbId: Number(tmdbId) };
  }

  private addSearchParams(url: URL) {
    if (this.apiKey) {
      url.searchParams.set('api_key', this.apiKey);
    }
  }

  public async getReleaseDates(tmdbId: number): Promise<ReleaseDate[]> {
    const url = new URL(API_BASE_URL + `/movie/${tmdbId}/release_dates`);
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch release dates: ${response.statusText}`);
    }
    const json = await response.json();
    const data = ReleaseDatesResponseSchema.parse(json);
    return data.results.flatMap((result) => result.release_dates);
  }

  public async getEpisodeAirDate(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<string | undefined> {
    const url = new URL(
      API_BASE_URL +
        `/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`
    );
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch episode details: ${response.statusText}`
      );
    }
    const json = await response.json();
    const episodeData = TVEpisodeDetailsSchema.parse(json);
    return episodeData.air_date ?? undefined;
  }

  public async getNextEpisodeAirDate(
    tmdbId: number,
    currentSeason: number,
    currentEpisode: number,
    seasons?: Array<{ season_number: number; episode_count: number }>
  ): Promise<string | undefined> {
    if (!seasons || seasons.length === 0) {
      return undefined;
    }

    const currentSeasonData = seasons.find(
      (s) => s.season_number === currentSeason
    );
    if (!currentSeasonData) {
      return undefined;
    }

    let nextSeason = currentSeason;
    let nextEpisode = currentEpisode + 1;

    if (nextEpisode > currentSeasonData.episode_count) {
      const nextSeasonData = seasons
        .filter((s) => s.season_number > currentSeason)
        .sort((a, b) => a.season_number - b.season_number)[0];

      if (!nextSeasonData || nextSeasonData.episode_count === 0) {
        return undefined;
      }

      nextSeason = nextSeasonData.season_number;
      nextEpisode = 1;
    }

    try {
      const url = new URL(
        API_BASE_URL +
          `/tv/${tmdbId}/season/${nextSeason}/episode/${nextEpisode}`
      );
      this.addSearchParams(url);
      const response = await makeRequest(url.toString(), {
        timeout: 5000,
        headers: this.getHeaders(),
      });
      if (!response.ok) {
        return undefined;
      }
      const json = await response.json();
      const episodeData = TVEpisodeDetailsSchema.parse(json);
      return episodeData.air_date ?? undefined;
    } catch (error) {
      return undefined;
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
      timeout: 3500,
      headers: this.getHeaders(),
    });
    if (!validationResponse.ok) {
      throw new Error(
        `Got HTTP error during validation, ensure a valid access token or API key was set: ${validationResponse.status} - ${validationResponse.statusText}`
      );
    }
    const validationData = (await validationResponse.json()) as {
      success: boolean;
    };
    const isValid = validationData.success;
    TMDBMetadata.validationCache.set(
      cacheKey,
      isValid,
      AUTHORISATION_CACHE_TTL
    );
    return isValid;
  }
}
