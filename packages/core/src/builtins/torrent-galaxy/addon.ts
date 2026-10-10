import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  SearchMetadata,
} from '../base/debrid.js';
import { z } from 'zod';
import {
  createLogger,
  getTimeTakenSincePoint,
  ParsedId,
} from '../../utils/index.js';
import TorrentGalaxyAPI, {
  TorrentGalaxyCategory,
  getTorrentGalaxyUrl,
} from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import {
  extractTrackersFromMagnet,
  validateInfoHash,
} from '../utils/debrid.js';
import { config as appConfig } from '../../config/index.js';
import { createQueryLimit, getTitleLanguagesForUrl } from '../utils/general.js';
import { getYearlessQueries } from '../utils/yearless.js';

const logger = createLogger('torrent-galaxy');

export const TorrentGalaxyAddonConfigSchema = BaseDebridConfigSchema;

export type TorrentGalaxyAddonConfig = z.infer<
  typeof TorrentGalaxyAddonConfigSchema
>;

export class TorrentGalaxyAddon extends BaseDebridAddon<TorrentGalaxyAddonConfig> {
  readonly id = 'torrent-galaxy';
  readonly name = 'Torrent Galaxy';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly api: TorrentGalaxyAPI;

  constructor(userData: TorrentGalaxyAddonConfig, clientIp?: string) {
    super(userData, TorrentGalaxyAddonConfigSchema, clientIp);
    this.api = new TorrentGalaxyAPI();
  }

  protected async _searchNzbs(_parsedId: ParsedId): Promise<NZB[]> {
    return [];
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    const queryLimit = createQueryLimit();
    const metadata = await this.getSearchMetadata();
    if (!metadata.primaryTitle) {
      return [];
    }

    const titleQueries = this.buildQueries(parsedId, metadata, {
      titleLanguages: getTitleLanguagesForUrl(getTorrentGalaxyUrl(), this.id),
    });
    if (titleQueries.length === 0 && !metadata.imdbId) {
      return [];
    }

    const categories = [
      ...(parsedId.mediaType === 'movie' ? [TorrentGalaxyCategory.Movies] : []),
      ...(parsedId.mediaType === 'series'
        ? [TorrentGalaxyCategory.TV, TorrentGalaxyCategory.TVShows]
        : []),
      ...(metadata.isAnime ? [TorrentGalaxyCategory.Anime] : []),
    ];

    const runQueries = async (queryList: string[]) =>
      (
        await Promise.all(
          queryList.map((q) =>
            queryLimit(async () => {
              const start = Date.now();
              // First fetch to get total and page size
              const firstPageResponse = await this.api.search({
                query: q,
                page: 1,
                categories,
              });
              const { total, pageSize } = firstPageResponse;
              let allResults = [...firstPageResponse.results];
              // Calculate required pages
              const totalPages = Math.min(
                Math.ceil(total / pageSize),
                appConfig.builtins.torrentGalaxy.pageLimit
              );
              if (totalPages > 1) {
                // Create array of page numbers to fetch (skip page 1 as we already have it)
                const pageNumbers = Array.from(
                  { length: totalPages - 1 },
                  (_, i) => i + 2
                );
                // Fetch all remaining pages in parallel
                const remainingResults = await Promise.all(
                  pageNumbers.map(async (pageNum) => {
                    const { results } = await this.api.search({
                      query: q,
                      page: pageNum,
                      categories,
                    });
                    return results;
                  })
                );
                allResults.push(...remainingResults.flat());
              }
              logger.info(
                `Torrent Galaxy search for ${q} took ${getTimeTakenSincePoint(start)}`,
                { results: allResults.length, pages: Math.max(totalPages, 1) }
              );
              return allResults;
            })
          )
        )
      ).flat();

    logger.info(`Performing torrent galaxy search`, {
      queries: titleQueries,
      categories,
    });
    const [titleResults, imdbResults] = await Promise.all([
      runQueries(titleQueries),
      metadata.imdbId ? runQueries([metadata.imdbId]) : Promise.resolve([]),
    ]);

    const matchesImdbId = (result: (typeof titleResults)[number]) =>
      !result.imdbId || !metadata.imdbId || result.imdbId === metadata.imdbId;

    const yearlessFallback = appConfig.builtins.scrape.yearlessMovieFallback;
    if (
      parsedId.mediaType === 'movie' &&
      metadata.year &&
      yearlessFallback.enabled
    ) {
      const uniqueCount = new Set(
        [...titleResults, ...imdbResults]
          .filter(matchesImdbId)
          .map((result) => validateInfoHash(result.hash))
          .filter(Boolean)
      ).size;
      if (uniqueCount < yearlessFallback.resultThreshold) {
        const yearlessQueries = getYearlessQueries(titleQueries, metadata.year);
        if (yearlessQueries.length > 0) {
          logger.info(
            'Initial Torrent Galaxy movie searches returned too few unique results; retrying without year',
            {
              uniqueResults: uniqueCount,
              threshold: yearlessFallback.resultThreshold,
              queries: yearlessQueries,
            }
          );
          try {
            titleResults.push(...(await runQueries(yearlessQueries)));
          } catch (error) {
            logger.warn(
              'Yearless movie fallback failed; keeping initial results',
              {
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      }
    }

    const results = [...titleResults, ...imdbResults].filter(matchesImdbId);

    const seenTorrents = new Set<string>();
    const torrents: UnprocessedTorrent[] = [];
    for (const result of results) {
      const hash = validateInfoHash(result.hash);
      if (!hash) {
        logger.warn(
          `TorrentGalaxy search hit has no hash: ${JSON.stringify(result)}`
        );
        continue;
      }
      const downloadUrl = `https://itorrents.org/${hash.toUpperCase()}.torrent?title=${result.name}`;
      if (seenTorrents.has(hash)) {
        continue;
      }
      seenTorrents.add(hash);
      // convert unix timestamp to age in hours
      const age = Math.ceil(
        (Date.now() - result.age * 1000) / (1000 * 60 * 60)
      );
      torrents.push({
        hash,
        downloadUrl,
        sources: [],
        indexer: `TGx | ${result.user}`,
        seeders: result.seeders,
        age,
        title: result.name,
        size: result.size,
        type: 'torrent',
      });
    }
    return torrents;
  }
}
