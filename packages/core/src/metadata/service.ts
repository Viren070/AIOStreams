import { DistributedLock } from '../utils/distributed-lock.js';
import { Metadata } from './utils.js';
import { TMDBMetadata } from './tmdb.js';
import { getTraktAliases } from './trakt.js';
import { IMDBMetadata } from './imdb.js';
import { createLogger, getTimeTakenSincePoint } from '../utils/logger.js';
import { TYPES } from '../utils/constants.js';
import { AnimeDatabase, IdParser, ParsedId } from '../utils/index.js';
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
    const { result } = await this.lock.withLock(
      `metadata:${id.mediaType}:${id.type}:${id.value}`,
      async () => {
        const start = Date.now();
        const titles: string[] = [];
        let year: number | undefined;
        let yearEnd: number | undefined;
        let seasons:
          | {
              season_number: number;
              episode_count: number;
            }[]
          | undefined;

        // Check anime database first
        const animeEntry = AnimeDatabase.getInstance().getEntryById(
          id.type,
          id.value
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
            : animeEntry?.mappings?.thetvdbId
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
        if (imdbId) {
          promises.push(getTraktAliases(id));
        } else {
          promises.push(Promise.resolve(undefined));
        }

        // IMDb metadata
        if (imdbId) {
          promises.push(new IMDBMetadata().getCinemetaData(imdbId, type));
        } else {
          promises.push(Promise.resolve(undefined));
        }

        // Execute all promises in parallel
        const [tmdbResult, tvdbResult, traktResult, imdbResult] =
          (await Promise.allSettled(promises)) as [
            PromiseSettledResult<(Metadata & { tmdbId: string }) | undefined>,
            PromiseSettledResult<(Metadata & { tvdbId: number }) | undefined>,
            PromiseSettledResult<string[] | undefined>,
            PromiseSettledResult<Meta | undefined>,
          ];

        // Process TMDB results
        if (tmdbResult.status === 'fulfilled' && tmdbResult.value) {
          const tmdbMetadata = tmdbResult.value;
          logger.debug(`TMDB metadata: ${JSON.stringify(tmdbMetadata)}`);
          if (tmdbMetadata.title) titles.unshift(tmdbMetadata.title);
          if (tmdbMetadata.titles) titles.push(...tmdbMetadata.titles);
          if (!year && tmdbMetadata.year) year = tmdbMetadata.year;
          if (tmdbMetadata.yearEnd) yearEnd = tmdbMetadata.yearEnd;
          if (tmdbMetadata.seasons)
            seasons = tmdbMetadata.seasons.sort(
              (a, b) => a.season_number - b.season_number
            );
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
          if (!year && tvdbMetadata.year) year = tvdbMetadata.year;
          if (tvdbMetadata.yearEnd) yearEnd = tvdbMetadata.yearEnd;
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
              const parts = cinemetaData.releaseInfo.toString().split(/[-–—]/);
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
        } else if (imdbResult.status === 'rejected') {
          logger.warn(
            `Failed to fetch IMDb metadata for ${imdbId}: ${imdbResult.reason}`
          );
        }

        if (id.type === 'malId' || id.type === 'kitsuId') {
          // if the requested ID is a mal or kitsu ID, we can safely use the title from the anime entry
          // if the requested ID was an IMDB ID instead, the entry would only be for the first season entry which may not be the correct title
          if (animeEntry?.title) {
            titles.unshift(animeEntry.title);
          }
        }
        // Deduplicate titles, lowercase all before deduplication
        const uniqueTitles = [
          ...new Set(titles.map((title) => title.toLowerCase())),
        ];

        if (
          !uniqueTitles.length ||
          (year === undefined && id.mediaType !== 'movie')
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
          tmdbId,
          tvdbId,
        };
      },
      {
        timeout: 2500, // metadata does not take long to fetch so keep it low
        ttl: 5000,
        retryInterval: 100,
      }
    );

    return result;
  }
}
