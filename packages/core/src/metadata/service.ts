import { DistributedLock } from '../utils/distributed-lock.js';
import { Metadata } from './utils.js';
import { TMDBMetadata } from './tmdb.js';
import { getTraktAliases } from './trakt.js';
import { IMDBMetadata } from './imdb.js';
import { createLogger, getTimeTakenSincePoint } from '../utils/logger.js';
import { TYPES } from '../utils/constants.js';
import { AnimeDatabase, IdParser, ParsedId, Env } from '../utils/index.js';
import { withRetry } from '../utils/general.js';
import { Meta } from '../db/schemas.js';
import { TVDBMetadata } from './tvdb.js';

const logger = createLogger('metadata-service');

export interface MetadataServiceConfig {
  tmdbAccessToken?: string;
  tmdbApiKey?: string;
  tvdbApiKey?: string;
}

export class MetadataService {
  private readonly lock: DistributedLock;
  private readonly config: MetadataServiceConfig;

  public constructor(config: MetadataServiceConfig) {
    this.lock = DistributedLock.getInstance();
    this.config = config;
  }

  public async getMetadata(
    id: ParsedId,
    type: (typeof TYPES)[number]
  ): Promise<Metadata> {
    return withRetry(
      async () => {
        const { result } = await this.lock.withLock(
          `metadata:${id.mediaType}:${id.type}:${id.value}${this.config.tmdbAccessToken || this.config.tmdbApiKey ? ':tmdb' : ''}${this.config.tvdbApiKey ? ':tvdb' : ''}`,
          async () => {
            const start = Date.now();
            const titles: string[] = [];
            let releaseDate: string | undefined;
            let year: number | undefined;
            let yearEnd: number | undefined;
            let runtime: number | undefined;
            let seasons:
              | {
                  season_number: number;
                  episode_count: number;
                }[]
              | undefined;

            // Check anime database first
            const animeEntry = AnimeDatabase.getInstance().getEntryById(
              id.type,
              id.value,
              id.season ? Number(id.season) : undefined,
              id.episode ? Number(id.episode) : undefined
            );

            let tmdbId: number | null =
              id.type === 'themoviedbId'
                ? Number(id.value)
                : animeEntry?.mappings?.themoviedbId
                  ? Number(animeEntry.mappings.themoviedbId)
                  : null;
            const imdbId: string | null =
              id.type === 'imdbId'
                ? id.value.toString()
                : (animeEntry?.mappings?.imdbId?.toString() ?? null);
            let tvdbId: number | null =
              id.type === 'thetvdbId'
                ? Number(id.value)
                : animeEntry?.mappings?.thetvdbId && type === 'series'
                  ? Number(animeEntry.mappings.thetvdbId)
                  : null;

            if (animeEntry) {
              if (animeEntry.imdb?.title) titles.push(animeEntry.imdb.title);
              if (animeEntry.trakt?.title) titles.push(animeEntry.trakt.title);
              if (animeEntry.title) titles.push(animeEntry.title);
              if (animeEntry.synonyms) titles.push(...animeEntry.synonyms);
              year = animeEntry.animeSeason?.year ?? undefined;
            }

            // Setup parallel API requests
            const promises = [];

            // TMDB metadata
            const idForTmdb = tmdbId
              ? `tmdb:${tmdbId}`
              : (imdbId ?? (tvdbId ? `tvdb:${tvdbId}` : null));
            const parsedIdForTmdb = idForTmdb
              ? IdParser.parse(idForTmdb, type)
              : null;
            if (parsedIdForTmdb) {
              promises.push(
                (async () => {
                  return new TMDBMetadata({
                    accessToken: this.config.tmdbAccessToken,
                    apiKey: this.config.tmdbApiKey,
                  }).getMetadata(parsedIdForTmdb);
                })()
              );
            } else {
              promises.push(Promise.resolve(undefined));
            }

            // TVDB metadata
            const idForTvdb = tvdbId
              ? `tvdb:${tvdbId}`
              : (imdbId ?? (tmdbId ? `tmdb:${tmdbId}` : null));
            const parsedIdForTvdb = idForTvdb
              ? IdParser.parse(idForTvdb, type)
              : null;
            if (parsedIdForTvdb) {
              promises.push(
                (async () => {
                  return new TVDBMetadata({
                    apiKey: this.config.tvdbApiKey,
                  }).getMetadata(parsedIdForTvdb);
                })()
              );
            } else {
              promises.push(Promise.resolve(undefined));
            }

            // Trakt aliases
            if (imdbId && Env.FETCH_TRAKT_ALIASES) {
              promises.push(getTraktAliases(id));
            } else {
              promises.push(Promise.resolve(undefined));
            }

            // IMDb metadata
            if (imdbId) {
              const imdbMetadata = new IMDBMetadata();
              promises.push(imdbMetadata.getCinemetaData(imdbId, type));
              promises.push(imdbMetadata.getImdbSuggestionData(imdbId, type));
            } else {
              promises.push(Promise.resolve(undefined));
              promises.push(Promise.resolve(undefined));
            }

            // Execute all promises in parallel
            const [
              tmdbResult,
              tvdbResult,
              traktResult,
              imdbResult,
              imdbSuggestionResult,
            ] = (await Promise.allSettled(promises)) as [
              PromiseSettledResult<(Metadata & { tmdbId: string }) | undefined>,
              PromiseSettledResult<(Metadata & { tvdbId: number }) | undefined>,
              PromiseSettledResult<string[] | undefined>,
              PromiseSettledResult<Meta | undefined>,
              PromiseSettledResult<Metadata | undefined>,
            ];

            // Process TMDB results
            if (tmdbResult.status === 'fulfilled' && tmdbResult.value) {
              const tmdbMetadata = tmdbResult.value;
              logger.debug(`TMDB metadata: ${JSON.stringify(tmdbMetadata)}`);
              if (tmdbMetadata.title) titles.unshift(tmdbMetadata.title);
              if (tmdbMetadata.titles) titles.push(...tmdbMetadata.titles);
              if (tmdbMetadata.year) year = tmdbMetadata.year;
              if (tmdbMetadata.yearEnd) yearEnd = tmdbMetadata.yearEnd;
              if (tmdbMetadata.releaseDate)
                releaseDate = tmdbMetadata.releaseDate;
              if (tmdbMetadata.seasons)
                seasons = tmdbMetadata.seasons.sort(
                  (a, b) => a.season_number - b.season_number
                );
              if (tmdbMetadata.runtime) runtime = tmdbMetadata.runtime;
              tmdbId = tmdbMetadata.tmdbId;
            } else if (tmdbResult.status === 'rejected') {
              logger.warn(
                `Failed to fetch TMDB metadata for ${id.fullId}: ${tmdbResult.reason}`
              );
            }

            // Process TVDB results
            if (tvdbResult.status === 'fulfilled' && tvdbResult.value) {
              const tvdbMetadata = tvdbResult.value;
              if (tvdbMetadata.title) titles.unshift(tvdbMetadata.title);
              if (tvdbMetadata.titles) titles.push(...tvdbMetadata.titles);
              if (tvdbMetadata.year) year = tvdbMetadata.year;
              if (tvdbMetadata.yearEnd) yearEnd = tvdbMetadata.yearEnd;
              if (tvdbMetadata.runtime && !runtime) runtime = tvdbMetadata.runtime;
              tvdbId = tvdbMetadata.tvdbId;
            } else if (tvdbResult.status === 'rejected') {
              logger.warn(
                `Failed to fetch TVDB metadata for ${id.fullId}: ${tvdbResult.reason}`
              );
            }
            // Process Trakt results
            if (traktResult.status === 'fulfilled' && traktResult.value) {
              titles.push(...traktResult.value);
            } else if (traktResult.status === 'rejected') {
              logger.warn(
                `Failed to fetch Trakt aliases for ${id.fullId}: ${traktResult.reason}`
              );
            }

            // Process IMDb results
            if (imdbResult.status === 'fulfilled' && imdbResult.value) {
              const cinemetaData = imdbResult.value;
              if (cinemetaData.name) titles.unshift(cinemetaData.name);
              if (cinemetaData.releaseInfo && !year) {
                if (cinemetaData.releaseInfo) {
                  const parts = cinemetaData.releaseInfo
                    .toString()
                    .split(/[-–—]/);
                  const start = parts[0]?.trim();
                  const end = parts[1]?.trim();

                  if (start) {
                    year = Number(start);
                  }

                  if (end) {
                    // Handles 'YYYY-YYYY'
                    yearEnd = Number(end);
                  } else if (parts.length > 1) {
                    // Handles 'YYYY-' (ongoing series)
                    yearEnd = new Date().getFullYear();
                  }
                } else if (cinemetaData.year) {
                  year = Number.isInteger(Number(cinemetaData.year))
                    ? Number(cinemetaData.year)
                    : undefined;
                }
              }
              if (cinemetaData.videos) {
                const seasonMap = new Map<number, Set<number>>();
                for (const video of cinemetaData.videos) {
                  if (
                    typeof video.season === 'number' &&
                    typeof video.episode === 'number'
                  ) {
                    if (!seasonMap.has(video.season)) {
                      seasonMap.set(video.season, new Set());
                    }
                    seasonMap.get(video.season)!.add(video.episode);
                  }
                }
                const imdbSeasons = Array.from(seasonMap.entries()).map(
                  ([season_number, episodes]) => ({
                    season_number,
                    episode_count: episodes.size,
                  })
                );
                if (imdbSeasons.length) {
                  seasons = imdbSeasons.sort(
                    (a, b) => a.season_number - b.season_number
                  );
                }
              }

              if (
                !releaseDate &&
                cinemetaData.released &&
                typeof cinemetaData.released === 'string'
              ) {
                const parsedReleaseDate = new Date(cinemetaData.released);
                if (!isNaN(parsedReleaseDate.getTime())) {
                  releaseDate = parsedReleaseDate.toISOString().split('T')[0];
                }
              }
            } else if (imdbResult.status === 'rejected') {
              logger.warn(
                `Failed to fetch IMDb metadata for ${imdbId}: ${imdbResult.reason}`
              );
            }

            if (
              imdbSuggestionResult.status === 'fulfilled' &&
              imdbSuggestionResult.value
            ) {
              const imdbSuggestionData = imdbSuggestionResult.value;
              if (imdbSuggestionData.title)
                titles.unshift(imdbSuggestionData.title);
              if (imdbSuggestionData.year && !year)
                year = imdbSuggestionData.year;
              if (imdbSuggestionData.yearEnd && !yearEnd)
                yearEnd = imdbSuggestionData.yearEnd;
            }

            // Deduplicate titles, lowercase all before deduplication
            const uniqueTitles = [
              ...new Set(titles.map((title) => title.toLowerCase())),
            ];

            if (
              !uniqueTitles.length ||
              (year === undefined && id.mediaType === 'movie')
            ) {
              throw new Error(`Could not find metadata for ${id.fullId}`);
            }
            logger.debug(
              `Found metadata for ${id.fullId} in ${getTimeTakenSincePoint(start)}`,
              {
                title: uniqueTitles[0],
                aliases: uniqueTitles.slice(1).length,
                year,
                yearEnd,
                seasons: seasons?.length,
              }
            );
            return {
              title: uniqueTitles[0],
              titles: uniqueTitles,
              year,
              yearEnd,
              seasons,
              releaseDate,
              tmdbId,
              tvdbId,
              runtime,
            };
          },
          {
            timeout: 10000,
            ttl: 12000,
            retryInterval: 100,
            type: 'memory',
          }
        );

        return result;
      },
      {
        getContext: () => `metadata ${id.fullId}`,
      }
    );
  }
}
