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
  torrentGalaxyUrl,
} from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import {
  extractTrackersFromMagnet,
  validateInfoHash,
} from '../utils/debrid.js';
import { Env } from '../../utils/env.js';
import { createQueryLimit, useAllTitles } from '../utils/general.js';

const logger = createLogger('torrent-galaxy');

export const TorrentGalaxyAddonConfigSchema = BaseDebridConfigSchema;

export type TorrentGalaxyAddonConfig = z.infer<
  typeof TorrentGalaxyAddonConfigSchema
>;

const WHITELISTED_CATEGORIES = [
  TorrentGalaxyCategory.Anime,
  TorrentGalaxyCategory.TV,
  TorrentGalaxyCategory.Movies,
];

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

    const queries = this.buildQueries(parsedId, metadata, {
      useAllTitles: useAllTitles(torrentGalaxyUrl),
    });
    if (metadata.imdbId) {
      queries.push(metadata.imdbId);
    }

    if (queries.length === 0) {
      return [];
    }

    logger.info(`Performing torrent galaxy search`, { queries });

    const searchPromises = queries.map((q) =>
      queryLimit(async () => {
        const start = Date.now();

        // First fetch to get total and page size
        logger.debug(`Fetching first page for query "${q}"`);
        const firstPageResponse = await this.api.search({
          query: q,
          page: 1,
        });

        const { total, pageSize } = firstPageResponse;
        let allResults = [...firstPageResponse.results];

        // Calculate required pages
        const totalPages = Math.min(
          Math.ceil(total / pageSize),
          Env.BUILTIN_TORRENT_GALAXY_PAGE_LIMIT
        );

        if (totalPages <= 1) {
          logger.info(
            `Torrent Galaxy search for ${q} took ${getTimeTakenSincePoint(start)}`,
            {
              results: allResults.length,
              pages: 1,
            }
          );
          return allResults;
        }

        // Create array of page numbers to fetch (skip page 1 as we already have it)
        const pageNumbers = Array.from(
          { length: totalPages - 1 },
          (_, i) => i + 2
        );

        logger.debug(
          `Fetching ${pageNumbers.length} additional pages in parallel for query "${q}"`
        );

        // Fetch all remaining pages in parallel
        const pagePromises = pageNumbers.map(async (pageNum) => {
          const { results } = await this.api.search({
            query: q,
            page: pageNum,
          });
          logger.debug(`Fetched page ${pageNum} for query "${q}"`, {
            newResults: results.length,
          });
          return results;
        });

        const remainingResults = await Promise.all(pagePromises);
        allResults.push(...remainingResults.flat());

        logger.info(
          `Torrent Galaxy search for ${q} took ${getTimeTakenSincePoint(start)}`,
          {
            results: allResults.length,
            pages: totalPages,
          }
        );
        return allResults;
      })
    );

    const allResults = await Promise.all(searchPromises);
    const results = allResults
      .flat()
      .filter(
        (result) =>
          WHITELISTED_CATEGORIES.some(
            (category) => result.category === category
          ) ||
          (metadata.imdbId && result.imdbId
            ? result.imdbId === metadata.imdbId
            : true)
      );

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
        age: age,
        title: result.name,
        size: result.size,
        type: 'torrent',
      });
    }
    return torrents;
  }
}
