import pLimit from 'p-limit';
import type { ConflictEpisodeCatalog } from '../streams/title-conflict-episodes.js';
import { Headers } from 'undici';
import {
  appConfig,
  Cache,
  makeRequest,
  ParsedId,
  IdType,
} from '../utils/index.js';
import { deduplicateTitles, Metadata, MetadataTitle } from './utils.js';
import { iso31661ToIso6391 } from '../utils/languages.js';
import { normaliseCountryCode } from '../utils/countries.js';
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
const EPISODE_CACHE_TTL = 6 * 60 * 60; // 6 hours
const SEARCH_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const PERSON_CACHE_TTL = 3 * 24 * 60 * 60; // 3 days, credits grow
const RECOMMENDATION_CACHE_TTL = 24 * 60 * 60; // 1 day

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
  origin_country: z.array(z.string()).optional(),
  runtime: z.number().nullable().optional(),
  genres: z.array(GenreSchema).optional(),
});

const TVDetailsSchema = z.object({
  id: z.number(),
  name: z.string(),
  first_air_date: z.string().nullable().optional(),
  last_air_date: z.string().nullable().optional(),
  status: z.string(),
  original_name: z.string().optional(),
  original_language: z.string().optional(),
  origin_country: z.array(z.string()).optional(),
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
      iso_3166_1: z.string(),
    })
  ),
});

const TVAlternativeTitlesSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      iso_3166_1: z.string(),
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
  runtime: z.number().nullable().optional(),
  translations: z
    .object({
      translations: z.array(
        z.looseObject({
          iso_639_1: z.string().optional(),
          data: z.looseObject({ name: z.string().optional() }).optional(),
        })
      ),
    })
    .optional(),
});

export interface EpisodeDetails {
  airDate?: string;
  runtime?: number;
  /** The episode's name in every language TMDB has, English first. */
  titles?: MetadataTitle[];
}

const TVSearchResultsSchema = z.object({
  results: z.array(
    z.looseObject({
      id: z.number(),
      name: z.string().optional(),
      original_name: z.string().optional(),
      first_air_date: z.string().nullable().optional(),
      origin_country: z.array(z.string()).optional(),
      popularity: z.number().optional(),
    })
  ),
});

const PersonSearchResultsSchema = z.object({
  results: z.array(
    z.looseObject({
      id: z.number(),
      name: z.string(),
      popularity: z.number().optional(),
    })
  ),
});

const PersonCreditSchema = z.looseObject({
  id: z.number(),
  media_type: z.string(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  genre_ids: z.array(z.number()).optional(),
  popularity: z.number().optional(),
  vote_count: z.number().optional(),
  character: z.string().nullable().optional(),
  job: z.string().nullable().optional(),
});

const PersonDetailsSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  biography: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(),
  deathday: z.string().nullable().optional(),
  place_of_birth: z.string().nullable().optional(),
  profile_path: z.string().nullable().optional(),
  known_for_department: z.string().nullable().optional(),
  imdb_id: z.string().nullable().optional(),
  combined_credits: z
    .object({
      cast: z.array(PersonCreditSchema).optional(),
      crew: z.array(PersonCreditSchema).optional(),
    })
    .optional(),
});

const ExternalIdsSchema = z.looseObject({
  imdb_id: z.string().nullable().optional(),
});

const TitleListSchema = z.object({
  results: z.array(
    z.looseObject({
      id: z.number(),
      title: z.string().optional(),
      name: z.string().optional(),
      release_date: z.string().nullable().optional(),
      first_air_date: z.string().nullable().optional(),
      overview: z.string().nullable().optional(),
      poster_path: z.string().nullable().optional(),
      backdrop_path: z.string().nullable().optional(),
      genre_ids: z.array(z.number()).optional(),
      popularity: z.number().optional(),
      vote_count: z.number().optional(),
    })
  ),
});

/** A movie or show as TMDB lists them in credits and recommendations. */
export interface TMDBTitle {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  /** YYYY-MM-DD */
  date?: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  genreIds: number[];
  popularity: number;
  voteCount: number;
}

export interface TMDBPersonCredit extends TMDBTitle {
  /** Characters played and jobs held, one entry per credit. */
  roles: string[];
}

export interface TMDBPerson {
  tmdbId: number;
  name: string;
  biography?: string;
  /** YYYY-MM-DD */
  birthday?: string;
  deathday?: string;
  placeOfBirth?: string;
  profilePath?: string;
  imdbId?: string;
  department?: string;
  credits: TMDBPersonCredit[];
}

export interface TMDBSeriesSearchResult {
  tmdbId: number;
  name?: string;
  originalName?: string;
  year?: number;
  country?: string;
  popularity?: number;
}

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
  private static readonly catalogCache = Cache.getInstance<
    number,
    ConflictEpisodeCatalog
  >('tmdb_episode_catalog');
  private static readonly seasonBoundCache = Cache.getInstance<number, number>(
    'tmdb_conflict_season_bound'
  );
  private readonly accessToken: string | undefined;
  private readonly apiKey: string | undefined;
  private static readonly validationCache: Cache<string, boolean> =
    Cache.getInstance<string, boolean>('tmdb_validation');
  private static readonly episodeCache: Cache<string, EpisodeDetails> =
    Cache.getInstance<string, EpisodeDetails>('tmdb_episode_v2');
  private static readonly searchCache: Cache<string, TMDBSeriesSearchResult[]> =
    Cache.getInstance<string, TMDBSeriesSearchResult[]>('tmdb_search');
  private static readonly personIdCache: Cache<string, number> =
    Cache.getInstance<string, number>('tmdb_person_id');
  private static readonly personCache: Cache<string, TMDBPerson> =
    Cache.getInstance<string, TMDBPerson>('tmdb_person');
  private static readonly recommendationCache: Cache<string, TMDBTitle[]> =
    Cache.getInstance<string, TMDBTitle[]>('tmdb_recommendations');
  private static readonly imdbIdCache: Cache<string, string> =
    Cache.getInstance<string, string>('tmdb_imdb_id');
  public constructor(auth?: { accessToken?: string; apiKey?: string }) {
    if (
      !auth?.accessToken &&
      !appConfig.metadata.tmdb.accessToken &&
      !auth?.apiKey &&
      !appConfig.metadata.tmdb.apiKey
    ) {
      throw new Error('TMDB Access Token or API Key is not set');
    }
    if (auth?.apiKey || appConfig.metadata.tmdb.apiKey) {
      this.apiKey = auth?.apiKey || appConfig.metadata.tmdb.apiKey || undefined;
    } else if (auth?.accessToken || appConfig.metadata.tmdb.accessToken) {
      this.accessToken =
        auth?.accessToken || appConfig.metadata.tmdb.accessToken || undefined;
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
  ): Promise<MetadataTitle[]> {
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
      return data.titles
        .filter((t) => t.title)
        .map((title) => ({
          title: title.title,
          language: iso31661ToIso6391(title.iso_3166_1) || undefined,
        }));
    } else {
      const data = TVAlternativeTitlesSchema.parse(json);
      return data.results
        .filter((t) => t.title)
        .map((title) => ({
          title: title.title,
          language: iso31661ToIso6391(title.iso_3166_1) || undefined,
        }));
    }
  }

  private async fetchTranslatedTitles(
    url: URL,
    mediaType: string
  ): Promise<MetadataTitle[]> {
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
      .map((translation) => {
        const title = translation.data.title || translation.data.name;
        if (!title) return null;
        return {
          title,
          language: translation.iso_639_1 || undefined,
        } as MetadataTitle;
      })
      .filter((t): t is MetadataTitle => t !== null);
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
      if (
        cachedMetadata.titles &&
        Array.isArray(cachedMetadata.titles) &&
        cachedMetadata.titles.every((t) => typeof t === 'string')
      ) {
        cachedMetadata.titles = cachedMetadata.titles.map((title) => ({
          title: title,
          language: undefined,
        }));
      }
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
    let allTitles: MetadataTitle[] = [];
    let originalLanguage: string | undefined;
    let country: string | undefined;
    let runtime: number | undefined;
    let genres: string[] = [];
    let firstAiredDate: string | undefined;
    let lastAiredDate: string | undefined;

    if (parsedId.mediaType === 'movie') {
      const movieData = MovieDetailsSchema.parse(detailsJson);
      if (movieData.original_title) {
        allTitles.push({
          title: movieData.original_title,
          language: movieData.original_language,
        });
      } else {
        allTitles.push({
          title: movieData.title,
          language: 'en',
        });
      }
      primaryTitle = movieData.title;
      originalLanguage = movieData.original_language;
      country = normaliseCountryCode(movieData.origin_country?.[0]);
      releaseDate = movieData.release_date;
      runtime = movieData.runtime || undefined;
      genres = movieData.genres?.map((g) => g.name) ?? [];
    } else {
      const tvData = TVDetailsSchema.parse(detailsJson);
      if (tvData.original_name) {
        allTitles.push({
          title: tvData.original_name,
          language: tvData.original_language,
        });
      } else {
        allTitles.push({
          title: tvData.name,
          language: 'en',
        });
      }
      primaryTitle = tvData.name;
      originalLanguage = tvData.original_language;
      country = normaliseCountryCode(tvData.origin_country?.[0]);
      releaseDate = tvData.first_air_date ?? undefined;
      firstAiredDate = tvData.first_air_date ?? undefined;
      lastAiredDate = tvData.last_air_date ?? undefined;
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

    const uniqueTitles = deduplicateTitles(allTitles);
    const metadata: Metadata = {
      title: primaryTitle,
      titles: uniqueTitles,
      releaseDate: releaseDate,
      year: Number(year),
      yearEnd: yearEnd ? Number(yearEnd) : undefined,
      originalLanguage,
      country,
      seasons,
      tmdbId: Number(tmdbId),
      tvdbId: null,
      runtime: runtime,
      genres: genres.length > 0 ? genres : undefined,
      firstAiredDate,
      lastAiredDate,
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

  /** Validate the complete season list independently of individual episode data. */
  public async getSeasonBound(tmdbId: number): Promise<number> {
    return TMDBMetadata.seasonBoundCache.wrap(
      async () => {
        const url = new URL(`${API_BASE_URL}/tv/${tmdbId}`);
        this.addSearchParams(url);
        const response = await makeRequest(url.toString(), {
          timeout: 5000,
          headers: this.getHeaders(),
        });
        if (!response.ok)
          throw new Error(`TMDB season summary failed: ${response.status}`);
        const show = z
          .object({
            id: z.number().int().positive(),
            number_of_seasons: z.number().int().positive(),
            seasons: z.array(
              z.object({ season_number: z.number().int().nonnegative() })
            ),
          })
          .parse(await response.json());
        const seasons = show.seasons
          .map((s) => s.season_number)
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
        if (
          show.id !== tmdbId ||
          seasons.length !== show.number_of_seasons ||
          seasons.some((n, i) => n !== i + 1)
        ) {
          throw new Error('Incomplete or mismatched TMDB season summary');
        }
        return show.number_of_seasons;
      },
      tmdbId,
      24 * 60 * 60
    );
  }

  /** Fetch a complete regular-season catalog; failures and partial data are not cached. */
  public async getEpisodeCatalog(
    tmdbId: number
  ): Promise<ConflictEpisodeCatalog> {
    return TMDBMetadata.catalogCache.wrap(
      async () => {
        const read = async (path: string) => {
          const url = new URL(API_BASE_URL + path);
          this.addSearchParams(url);
          const response = await makeRequest(url.toString(), {
            timeout: 5000,
            headers: this.getHeaders(),
          });
          if (!response.ok)
            throw new Error(`TMDB catalog request failed: ${response.status}`);
          return response.json();
        };
        const show = z
          .object({
            id: z.number().int().positive(),
            number_of_seasons: z.number().int().positive(),
            number_of_episodes: z.number().int().positive(),
            seasons: z.array(
              z.object({
                season_number: z.number().int().nonnegative(),
                episode_count: z.number().int().nonnegative(),
              })
            ),
          })
          .parse(await read(`/tv/${tmdbId}`));
        const seasons = show.seasons
          .filter((s) => s.season_number > 0)
          .sort((a, b) => a.season_number - b.season_number);
        if (
          show.id !== tmdbId ||
          seasons.length !== show.number_of_seasons ||
          seasons.some(
            (s, i) => s.season_number !== i + 1 || s.episode_count < 1
          ) ||
          seasons.reduce((n, s) => n + s.episode_count, 0) !==
            show.number_of_episodes
        )
          throw new Error('Incomplete TMDB catalog summary');
        const limit = pLimit(3);
        const lists = await Promise.all(
          seasons.map((season) =>
            limit(async () => {
              const data = z
                .object({
                  season_number: z.number().int(),
                  episodes: z.array(
                    z.object({
                      show_id: z.number().int(),
                      season_number: z.number().int(),
                      episode_number: z.number().int().positive(),
                    })
                  ),
                })
                .parse(
                  await read(`/tv/${tmdbId}/season/${season.season_number}`)
                );
              const episodes = data.episodes.sort(
                (a, b) => a.episode_number - b.episode_number
              );
              if (
                data.season_number !== season.season_number ||
                episodes.length !== season.episode_count ||
                episodes.some(
                  (e, i) =>
                    e.show_id !== tmdbId ||
                    e.season_number !== season.season_number ||
                    e.episode_number !== i + 1
                )
              )
                throw new Error('Incomplete or mismatched TMDB season catalog');
              return episodes.map((e) => ({
                seasonNumber: e.season_number,
                episodeNumber: e.episode_number,
              }));
            })
          )
        );
        return { tmdbId, episodes: lists.flat() };
      },
      tmdbId,
      24 * 60 * 60
    );
  }

  public async getEpisodeDetails(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<EpisodeDetails | undefined> {
    const cacheKey = `${tmdbId}:${seasonNumber}:${episodeNumber}`;
    const cached = await TMDBMetadata.episodeCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const url = new URL(
      API_BASE_URL +
        `/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`
    );
    // translations ride along free, giving localised episode names
    url.searchParams.set('append_to_response', 'translations');
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });
    if (response.status === 404) {
      // episode doesn't exist under TMDB's numbering scheme
      return undefined;
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch episode details: ${response.statusText}`
      );
    }
    const json = await response.json();
    const episodeData = TVEpisodeDetailsSchema.parse(json);
    // translations first: the default name repeats one of them, and an
    // untagged duplicate would strip that entry's language
    const titles: MetadataTitle[] = [];
    for (const translation of episodeData.translations?.translations ?? []) {
      const title = translation.data?.name;
      if (title && translation.iso_639_1) {
        titles.push({ title, language: translation.iso_639_1 });
      }
    }
    if (
      episodeData.name &&
      !titles.some((existing) => existing.title === episodeData.name)
    ) {
      titles.push({ title: episodeData.name });
    }
    const details: EpisodeDetails = {
      airDate: episodeData.air_date ?? undefined,
      runtime: episodeData.runtime ?? undefined,
      titles: titles.length ? deduplicateTitles(titles) : undefined,
    };
    await TMDBMetadata.episodeCache.set(cacheKey, details, EPISODE_CACHE_TTL);
    return details;
  }

  public async searchSeries(query: string): Promise<TMDBSeriesSearchResult[]> {
    return TMDBMetadata.searchCache.wrap(
      async () => {
        const url = new URL(API_BASE_URL + '/search/tv');
        url.searchParams.set('query', query);
        this.addSearchParams(url);
        const response = await makeRequest(url.toString(), {
          timeout: 5000,
          headers: this.getHeaders(),
        });
        if (!response.ok) {
          throw new Error(`Failed to search series: ${response.statusText}`);
        }
        const data = TVSearchResultsSchema.parse(await response.json());
        return data.results.map((r) => {
          const year = r.first_air_date
            ? new Date(r.first_air_date).getFullYear()
            : undefined;
          return {
            tmdbId: r.id,
            name: r.name,
            originalName: r.original_name,
            year: year && !Number.isNaN(year) ? year : undefined,
            country: normaliseCountryCode(r.origin_country?.[0]),
            popularity: r.popularity,
          };
        });
      },
      query.toLowerCase(),
      SEARCH_CACHE_TTL
    );
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

    return this.getEpisodeDetails(tmdbId, nextSeason, nextEpisode).then(
      (details) => details?.airDate
    );
  }

  private async getJson(path: string, params: Record<string, string> = {}) {
    const url = new URL(API_BASE_URL + path);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`TMDB ${path} failed: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * The person a name most likely means: an exact match before a partial one,
   * then the most popular.
   */
  public async findPersonId(name: string): Promise<number | undefined> {
    const key = name.trim().toLowerCase();
    const cached = await TMDBMetadata.personIdCache.get(key);
    if (cached !== undefined) return cached || undefined;
    const json = await this.getJson('/search/person', { query: name });
    const results = json ? PersonSearchResultsSchema.parse(json).results : [];
    const exact = results.filter((r) => r.name.trim().toLowerCase() === key);
    const best = (exact.length ? exact : results).sort(
      (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)
    )[0];
    // 0 remembers that nobody matched, so the search is not repeated.
    await TMDBMetadata.personIdCache.set(key, best?.id ?? 0, SEARCH_CACHE_TTL);
    return best?.id;
  }

  /** A person's details and every credit, cast and crew merged per title. */
  public async getPerson(tmdbId: number): Promise<TMDBPerson | undefined> {
    const key = String(tmdbId);
    const cached = await TMDBMetadata.personCache.get(key);
    if (cached) return cached;
    const json = await this.getJson(`/person/${tmdbId}`, {
      append_to_response: 'combined_credits',
    });
    if (!json) return undefined;
    const data = PersonDetailsSchema.parse(json);
    const credits = [
      ...(data.combined_credits?.cast ?? []).map((c) => ({
        ...c,
        role: c.character,
      })),
      ...(data.combined_credits?.crew ?? []).map((c) => ({
        ...c,
        role: c.job,
      })),
    ];
    const byTitle = new Map<string, TMDBPersonCredit>();
    for (const credit of credits) {
      if (credit.media_type !== 'movie' && credit.media_type !== 'tv') continue;
      const title = credit.title ?? credit.name;
      if (!title) continue;
      const role = credit.role?.trim();
      const titleKey = `${credit.media_type}:${credit.id}`;
      const existing = byTitle.get(titleKey);
      if (existing) {
        if (role && !existing.roles.includes(role)) existing.roles.push(role);
        continue;
      }
      byTitle.set(titleKey, {
        tmdbId: credit.id,
        mediaType: credit.media_type,
        title,
        date: (credit.release_date ?? credit.first_air_date) || undefined,
        overview: credit.overview || undefined,
        posterPath: credit.poster_path ?? undefined,
        backdropPath: credit.backdrop_path ?? undefined,
        genreIds: credit.genre_ids ?? [],
        popularity: credit.popularity ?? 0,
        voteCount: credit.vote_count ?? 0,
        roles: role ? [role] : [],
      });
    }
    const person: TMDBPerson = {
      tmdbId: data.id,
      name: data.name,
      biography: data.biography || undefined,
      birthday: data.birthday || undefined,
      deathday: data.deathday || undefined,
      placeOfBirth: data.place_of_birth || undefined,
      profilePath: data.profile_path ?? undefined,
      imdbId: data.imdb_id || undefined,
      department: data.known_for_department ?? undefined,
      credits: [...byTitle.values()],
    };
    await TMDBMetadata.personCache.set(key, person, PERSON_CACHE_TTL);
    return person;
  }

  /**
   * What TMDB recommends alongside a title; its `similar` list is keyword
   * matching and much noisier.
   */
  public async getRecommendations(
    mediaType: 'movie' | 'tv',
    tmdbId: number
  ): Promise<TMDBTitle[]> {
    return TMDBMetadata.recommendationCache.wrap(
      async () => {
        const json = await this.getJson(
          `/${mediaType}/${tmdbId}/recommendations`
        );
        const results = json ? TitleListSchema.parse(json).results : [];
        return results.flatMap((r): TMDBTitle[] => {
          const title = r.title ?? r.name;
          if (!title) return [];
          return [
            {
              tmdbId: r.id,
              mediaType,
              title,
              date: (r.release_date ?? r.first_air_date) || undefined,
              overview: r.overview || undefined,
              posterPath: r.poster_path ?? undefined,
              backdropPath: r.backdrop_path ?? undefined,
              genreIds: r.genre_ids ?? [],
              popularity: r.popularity ?? 0,
              voteCount: r.vote_count ?? 0,
            },
          ];
        });
      },
      `${mediaType}:${tmdbId}`,
      RECOMMENDATION_CACHE_TTL
    );
  }

  /** The IMDb id of a movie or show, for meta addons that only take those. */
  public async getImdbId(
    mediaType: 'movie' | 'tv',
    tmdbId: number
  ): Promise<string | undefined> {
    const key = `${mediaType}:${tmdbId}`;
    const cached = await TMDBMetadata.imdbIdCache.get(key);
    if (cached !== undefined) return cached || undefined;
    const json = await this.getJson(`/${mediaType}/${tmdbId}/external_ids`);
    const imdbId = json
      ? (ExternalIdsSchema.parse(json).imdb_id ?? undefined)
      : undefined;
    await TMDBMetadata.imdbIdCache.set(key, imdbId ?? '', ID_CACHE_TTL);
    return imdbId;
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
