import { UserData } from '../db/schemas.js';
import { MetadataService, MetadataServiceConfig } from '../metadata/service.js';
import { Metadata } from '../metadata/utils.js';
import { ReleaseDate, TMDBMetadata } from '../metadata/tmdb.js';
import {
  AnimeDatabase,
  AnimeEntry,
  IdParser,
  ParsedId,
  createLogger,
  getTimeTakenSincePoint,
  getSeaDexInfoHashes,
  enrichParsedIdWithAnimeEntry,
} from '../utils/index.js';
import { SeaDexResult } from '../utils/seadex.js';
import { calculateAbsoluteEpisode } from '../builtins/utils/general.js';
import { iso6391ToLanguage } from '../formatters/utils.js';

const logger = createLogger('stream-context');

/**
 * Extended metadata that includes additional fields computed during context build
 */
export interface ExtendedMetadata extends Metadata {
  absoluteEpisode?: number;
}

/**
 * StreamContext encapsulates all request-specific data that can be shared
 * across filtering, sorting, precomputing, and expression evaluation.
 *
 */
export class StreamContext {
  // Core request info
  public readonly type: string;
  public readonly id: string;
  public readonly parsedId: ParsedId | null;

  // Anime-related data (cached from AnimeDatabase)
  public readonly isAnime: boolean;
  public readonly animeEntry: AnimeEntry | null;
  public readonly queryType: string; // 'anime.movie', 'anime.series', 'movie', 'series'

  // Metadata (fetched from TMDB/TVDB/IMDB)
  private _metadata: ExtendedMetadata | undefined;
  private _metadataPromise: Promise<ExtendedMetadata | undefined> | undefined;
  private _metadataFetched: boolean = false;

  // Release dates for digital release filter (movie only)
  private _releaseDates: ReleaseDate[] | undefined;
  private _releaseDatesPromise: Promise<ReleaseDate[] | undefined> | undefined;

  // Episode air date for series digital release filter
  private _episodeAirDate: string | undefined;
  private _episodeAirDatePromise: Promise<string | undefined> | undefined;

  // SeaDex data (for anime)
  private _seadex: SeaDexResult | undefined;
  private _seadexPromise: Promise<SeaDexResult | undefined> | undefined;
  private _seadexFetched: boolean = false;

  // Year within title (for year matching)
  // public readonly yearWithinTitle: string | undefined;
  // public readonly yearWithinTitleRegex: RegExp | undefined;

  // User data reference
  private readonly userData: UserData;

  private constructor(
    type: string,
    id: string,
    userData: UserData,
    options: {
      parsedId: ParsedId | null;
      isAnime: boolean;
      animeEntry: AnimeEntry | null;
      queryType: string;
    }
  ) {
    this.type = type;
    this.id = id;
    this.userData = userData;
    this.parsedId = options.parsedId;
    this.isAnime = options.isAnime;
    this.animeEntry = options.animeEntry;
    this.queryType = options.queryType;
  }

  /**
   * Create a StreamContext for a request.
   * This performs initial synchronous lookups from the AnimeDatabase.
   */
  public static create(
    type: string,
    id: string,
    userData: UserData
  ): StreamContext {
    const start = Date.now();
    const parsedId = IdParser.parse(id, type);
    let isAnime = id.startsWith('kitsu');

    const animeDb = AnimeDatabase.getInstance();
    if (animeDb.isAnime(id)) {
      isAnime = true;
    }

    let animeEntry: AnimeEntry | null = null;
    if (parsedId) {
      animeEntry = animeDb.getEntryById(
        parsedId.type,
        parsedId.value,
        parsedId.season ? Number(parsedId.season) : undefined,
        parsedId.episode ? Number(parsedId.episode) : undefined
      );

      // Enrich parsedId with anime entry data if available and no season specified
      if (animeEntry && !parsedId.season) {
        enrichParsedIdWithAnimeEntry(parsedId, animeEntry);
      }
    }

    const queryType = isAnime ? `anime.${type}` : type;

    logger.debug(
      `Created StreamContext for ${id} (${type}) in ${getTimeTakenSincePoint(start)}`,
      {
        isAnime,
        hasAnimeEntry: !!animeEntry,
        queryType,
      }
    );

    return new StreamContext(type, id, userData, {
      parsedId,
      isAnime,
      animeEntry,
      queryType,
    });
  }

  /**
   * Start fetching metadata asynchronously.
   * Call this early (e.g., when starting addon fetches) to parallelize.
   */
  public startMetadataFetch(): void {
    if (this._metadataPromise || this._metadataFetched) {
      return;
    }

    const needsMetadata =
      this.userData.bitrate?.useMetadataRuntime ||
      this.userData.titleMatching?.enabled ||
      (this.userData.digitalReleaseFilter?.enabled &&
        ['movie', 'series', 'anime'].includes(this.type)) ||
      this.userData.yearMatching?.enabled ||
      this.userData.seasonEpisodeMatching?.enabled ||
      // Always fetch if user might need genres in expressions
      this.userData.excludedStreamExpressions?.length ||
      this.userData.requiredStreamExpressions?.length ||
      this.userData.includedStreamExpressions?.length;

    if (!needsMetadata || !this.parsedId) {
      this._metadataFetched = true;
      return;
    }

    const metadataStart = Date.now();
    this._metadataPromise = (async () => {
      try {
        const service = new MetadataService({
          tmdbAccessToken: this.userData.tmdbAccessToken,
          tmdbApiKey: this.userData.tmdbApiKey,
          tvdbApiKey: this.userData.tvdbApiKey,
        });

        const metadata = await service.getMetadata(
          this.parsedId!,
          this.type as any
        );

        // Calculate absolute episode for anime
        let absoluteEpisode: number | undefined;
        if (
          this.isAnime &&
          this.parsedId!.season &&
          this.parsedId!.episode &&
          metadata.seasons
        ) {
          const seasons = metadata.seasons.map(
            ({ season_number, episode_count }) => ({
              number: season_number.toString(),
              episodes: episode_count,
            })
          );
          absoluteEpisode = Number(
            calculateAbsoluteEpisode(
              this.parsedId!.season,
              this.parsedId!.episode,
              seasons
            )
          );
          if (this.animeEntry?.imdb?.nonImdbEpisodes && absoluteEpisode) {
            const nonImdbEpisodesBefore =
              this.animeEntry.imdb.nonImdbEpisodes.filter(
                (ep: number) => ep < absoluteEpisode!
              ).length;
            if (nonImdbEpisodesBefore > 0) {
              absoluteEpisode += nonImdbEpisodesBefore;
            }
          }
        }

        const extendedMetadata: ExtendedMetadata = {
          ...metadata,
          absoluteEpisode,
        };

        logger.info(`Fetched metadata for context`, {
          id: this.id,
          time: getTimeTakenSincePoint(metadataStart),
          title: metadata.title,
          year: metadata.year,
          hasGenres: !!metadata.genres?.length,
        });

        return extendedMetadata;
      } catch (error) {
        logger.warn(`Error fetching metadata for ${this.id}: ${error}`);
        return undefined;
      } finally {
        this._metadataFetched = true;
      }
    })();
  }

  /**
   * Start fetching release dates asynchronously (for digital release filter).
   */
  public startReleaseDatesFetch(): void {
    if (
      this._releaseDatesPromise ||
      !this.userData.digitalReleaseFilter?.enabled
    ) {
      return;
    }

    this._releaseDatesPromise = (async () => {
      const metadata = await this.getMetadata();
      if (!metadata?.tmdbId) {
        return undefined;
      }

      if (this.type === 'movie') {
        try {
          return await new TMDBMetadata({
            accessToken: this.userData.tmdbAccessToken,
            apiKey: this.userData.tmdbApiKey,
          }).getReleaseDates(metadata.tmdbId);
        } catch (error) {
          logger.warn(`Error fetching release dates for ${this.id}: ${error}`);
          return undefined;
        }
      }
      return undefined;
    })();
  }

  /**
   * Start fetching episode air date asynchronously (for series digital release filter).
   */
  public startEpisodeAirDateFetch(): void {
    if (
      this._episodeAirDatePromise ||
      !this.userData.digitalReleaseFilter?.enabled ||
      (this.type !== 'series' && !this.isAnime)
    ) {
      return;
    }

    this._episodeAirDatePromise = (async () => {
      const metadata = await this.getMetadata();
      if (
        !metadata?.tmdbId ||
        !this.parsedId?.season ||
        !this.parsedId?.episode
      ) {
        return undefined;
      }

      try {
        return await new TMDBMetadata({
          accessToken: this.userData.tmdbAccessToken,
          apiKey: this.userData.tmdbApiKey,
        }).getEpisodeAirDate(
          metadata.tmdbId,
          Number(this.parsedId.season),
          Number(this.parsedId.episode)
        );
      } catch (error) {
        logger.warn(`Error fetching episode air date for ${this.id}: ${error}`);
        return undefined;
      }
    })();
  }

  /**
   * Start fetching SeaDex data asynchronously.
   * Call this early to parallelize with addon fetches.
   */
  public startSeaDexFetch(): void {
    if (
      this._seadexPromise ||
      this._seadexFetched ||
      !this.isAnime ||
      this.userData.enableSeadex === false
    ) {
      return;
    }

    const anilistIdRaw = this.animeEntry?.mappings?.anilistId;
    if (!anilistIdRaw) {
      logger.debug(
        `No AniList ID found for ${this.id}, skipping SeaDex lookup`
      );
      this._seadexFetched = true;
      return;
    }

    const anilistId =
      typeof anilistIdRaw === 'string'
        ? parseInt(anilistIdRaw, 10)
        : anilistIdRaw;
    if (isNaN(anilistId)) {
      logger.debug(
        `Invalid AniList ID ${anilistIdRaw}, skipping SeaDex lookup`
      );
      this._seadexFetched = true;
      return;
    }

    this._seadexPromise = (async () => {
      try {
        return await getSeaDexInfoHashes(anilistId);
      } catch (error) {
        logger.warn(`Error fetching SeaDex data for ${this.id}: ${error}`);
        return undefined;
      } finally {
        this._seadexFetched = true;
      }
    })();
  }

  /**
   * Start all async fetches in parallel.
   * Call this when starting addon fetches to maximize parallelism.
   */
  public startAllFetches(): void {
    this.startMetadataFetch();
    this.startSeaDexFetch();
    // Release dates and episode air date depend on metadata, so they're fetched after
  }

  /**
   * Get metadata, waiting for fetch if needed.
   */
  public async getMetadata(): Promise<ExtendedMetadata | undefined> {
    if (this._metadata !== undefined) {
      return this._metadata;
    }

    if (!this._metadataPromise) {
      this.startMetadataFetch();
    }

    if (this._metadataPromise) {
      this._metadata = await this._metadataPromise;
    }

    return this._metadata;
  }

  /**
   * Get release dates, waiting for fetch if needed.
   */
  public async getReleaseDates(): Promise<ReleaseDate[] | undefined> {
    if (this._releaseDates !== undefined) {
      return this._releaseDates;
    }

    if (!this._releaseDatesPromise) {
      this.startReleaseDatesFetch();
    }

    if (this._releaseDatesPromise) {
      this._releaseDates = await this._releaseDatesPromise;
    }

    return this._releaseDates;
  }

  /**
   * Get episode air date, waiting for fetch if needed.
   */
  public async getEpisodeAirDate(): Promise<string | undefined> {
    if (this._episodeAirDate !== undefined) {
      return this._episodeAirDate;
    }

    if (!this._episodeAirDatePromise) {
      this.startEpisodeAirDateFetch();
    }

    if (this._episodeAirDatePromise) {
      this._episodeAirDate = await this._episodeAirDatePromise;
    }

    return this._episodeAirDate;
  }

  /**
   * Get SeaDex data, waiting for fetch if needed.
   */
  public async getSeaDex(): Promise<SeaDexResult | undefined> {
    if (this._seadex !== undefined) {
      return this._seadex;
    }

    if (!this._seadexPromise) {
      this.startSeaDexFetch();
    }

    if (this._seadexPromise) {
      this._seadex = await this._seadexPromise;
    }

    return this._seadex;
  }

  /**
   * Convert context to a plain object for expression evaluation.
   */
  public toExpressionContext(): Record<string, any> {
    return {
      type: this.type,
      id: this.id,
      isAnime: this.isAnime,
      queryType: this.queryType,
      season: this.parsedId?.season ? Number(this.parsedId.season) : undefined,
      episode: this.parsedId?.episode
        ? Number(this.parsedId.episode)
        : undefined,
      // Metadata fields
      title: this._metadata?.title,
      titles: this._metadata?.titles,
      year: this._metadata?.year,
      yearEnd: this._metadata?.yearEnd,
      genres: this._metadata?.genres ?? [],
      runtime: this._metadata?.runtime,
      originalLanguage: iso6391ToLanguage(
        this._metadata?.originalLanguage || ''
      ),
      absoluteEpisode: this._metadata?.absoluteEpisode,
      // Anime entry data
      anilistId: this.animeEntry?.mappings?.anilistId,
      malId: this.animeEntry?.mappings?.malId,
      // SeaDex availability
      hasSeaDex: !!this._seadex?.allHashes?.size,
    };
  }
}
