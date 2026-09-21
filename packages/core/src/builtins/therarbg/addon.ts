import { BaseDebridAddon, BaseDebridConfigSchema } from '../base/debrid.js';
import { z } from 'zod';
import {
  createLogger,
  getTimeTakenSincePoint,
  ParsedId,
} from '../../utils/index.js';
import TheRARBGAPI, { TheRARBGCategory, getTheRARBGUrl } from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import { validateInfoHash } from '../utils/debrid.js';
import { config as appConfig } from '../../config/index.js';
import { createQueryLimit, getTitleLanguagesForUrl } from '../utils/general.js';

const logger = createLogger('therarbg');

export const TheRARBGAddonConfigSchema = BaseDebridConfigSchema;

export type TheRARBGAddonConfig = z.infer<typeof TheRARBGAddonConfigSchema>;

export class TheRARBGAddon extends BaseDebridAddon<TheRARBGAddonConfig> {
  readonly id = 'therarbg';
  readonly name = 'TheRARBG';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly api: TheRARBGAPI;

  constructor(userData: TheRARBGAddonConfig, clientIp?: string) {
    super(userData, TheRARBGAddonConfigSchema, clientIp);
    this.api = new TheRARBGAPI();
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
      titleLanguages: getTitleLanguagesForUrl(getTheRARBGUrl(), this.id),
    });
    if (metadata.imdbId) {
      queries.push(metadata.imdbId);
    }

    if (queries.length === 0) {
      return [];
    }

    const categories = [
      ...(parsedId.mediaType === 'movie' ? [TheRARBGCategory.Movies] : []),
      ...(parsedId.mediaType === 'series'
        ? [TheRARBGCategory.TV, TheRARBGCategory.TVShows]
        : []),
      ...(metadata.isAnime ? [TheRARBGCategory.Anime] : []),
    ];

    logger.info(`Performing TheRARBG search`, { queries, categories });

    const searchPromises = queries.map((q) =>
      queryLimit(async () => {
        const start = Date.now();

        logger.debug(`Fetching first page for query "${q}"`);
        const firstPageResponse = await this.api.search({
          query: q,
          page: 1,
          categories,
        });

        const { total, pageSize } = firstPageResponse;
        let allResults = [...firstPageResponse.results];

        const totalPages = Math.min(
          Math.ceil(total / pageSize),
          appConfig.builtins.therarbg.pageLimit
        );

        if (totalPages <= 1) {
          logger.info(
            `TheRARBG search for ${q} took ${getTimeTakenSincePoint(start)}`,
            {
              results: allResults.length,
              pages: 1,
            }
          );
          return allResults;
        }

        // page 1 was already fetched above
        const pageNumbers = Array.from(
          { length: totalPages - 1 },
          (_, i) => i + 2
        );

        logger.debug(
          `Fetching ${pageNumbers.length} additional pages in parallel for query "${q}"`
        );

        const pagePromises = pageNumbers.map(async (pageNum) => {
          const { results } = await this.api.search({
            query: q,
            page: pageNum,
            categories,
          });
          logger.debug(`Fetched page ${pageNum} for query "${q}"`, {
            newResults: results.length,
          });
          return results;
        });

        const remainingResults = await Promise.all(pagePromises);
        allResults.push(...remainingResults.flat());

        logger.info(
          `TheRARBG search for ${q} took ${getTimeTakenSincePoint(start)}`,
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
          !result.imdbId ||
          !metadata.imdbId ||
          result.imdbId === metadata.imdbId
      );

    const seenTorrents = new Set<string>();
    const torrents: UnprocessedTorrent[] = [];
    for (const result of results) {
      const hash = validateInfoHash(result.hash);
      if (!hash) {
        logger.warn(
          `TheRARBG search hit has no hash: ${JSON.stringify(result)}`
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
        indexer: `TheRARBG | ${result.user}`,
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
