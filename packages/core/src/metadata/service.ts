import { DistributedLock } from '../utils/distributed-lock';
import { Metadata } from './utils';
import { TMDBMetadata } from './tmdb';
import { getTraktAliases } from './trakt';
import { IMDBMetadata } from './imdb';
import { createLogger, getTimeTakenSincePoint } from '../utils/logger';
import { TYPES } from '../utils/constants';
import { AnimeDatabase, ParsedId } from '../utils';
import { Meta } from '../db/schemas';

const logger = createLogger('metadata-service');

export interface MetadataServiceConfig {
  tmdbAccessToken?: string;
  tmdbApiKey?: string;
}

export class MetadataService {
  private readonly tmdbMetadata: TMDBMetadata;
  private readonly lock: DistributedLock;

  public constructor(config: MetadataServiceConfig) {
    this.tmdbMetadata = new TMDBMetadata({
      accessToken: config.tmdbAccessToken,
      apiKey: config.tmdbApiKey,
    });
    this.lock = DistributedLock.getInstance();
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

        const tmdbId =
          id.type === 'themoviedbId'
            ? id.value.toString()
            : (animeEntry?.mappings?.themoviedbId?.toString() ?? null);
        const imdbId =
          id.type === 'imdbId'
            ? id.value.toString()
            : (animeEntry?.mappings?.imdbId?.toString() ?? null);
        const tvdbId =
          id.type === 'thetvdbId'
            ? id.value.toString()
            : (animeEntry?.mappings?.thetvdbId?.toString() ?? null);

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

        if (tmdbId || imdbId || tvdbId) {
          let id = tmdbId
            ? `tmdb:${tmdbId}`
            : (imdbId ?? (tvdbId ? `tvdb:${tvdbId}` : null));
          promises.push(this.tmdbMetadata.getMetadata(id!, type));
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
        const [tmdbResult, traktResult, imdbResult] = (await Promise.allSettled(
          promises
        )) as [
          PromiseSettledResult<Metadata | undefined>,
          PromiseSettledResult<string[] | undefined>,
          PromiseSettledResult<Meta | undefined>,
        ];

        // Process TMDB results
        if (tmdbResult.status === 'fulfilled' && tmdbResult.value) {
          const tmdbMetadata = tmdbResult.value;
          if (tmdbMetadata.title) titles.unshift(tmdbMetadata.title);
          if (tmdbMetadata.titles) titles.push(...tmdbMetadata.titles);
          if (!year && tmdbMetadata.year) year = tmdbMetadata.year;
          if (tmdbMetadata.yearEnd) yearEnd = tmdbMetadata.yearEnd;
          if (tmdbMetadata.seasons)
            seasons = tmdbMetadata.seasons.sort(
              (a, b) => a.season_number - b.season_number
            );
        } else if (tmdbResult.status === 'rejected') {
          logger.warn(
            `Failed to fetch TMDB metadata for ${id.fullId}: ${tmdbResult.reason}`
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
            const releaseYear = Number(
              cinemetaData.releaseInfo.toString().split('-')[0]
            );
            if (!isNaN(releaseYear)) year = releaseYear;
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

        if (!uniqueTitles.length || !year) {
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
