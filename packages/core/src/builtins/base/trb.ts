import { BaseDebridAddon, BaseDebridConfig } from './debrid.js';
import { z } from 'zod';
import type { Logger } from '../../logging/logger.js';
import {
  createLogger,
  getTimeTakenSincePoint,
  ParsedId,
} from '../../utils/index.js';
import { TrbAPI, TrbCategory, TrbSite } from './trb-api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import { validateInfoHash } from '../utils/debrid.js';
import { createQueryLimit, getTitleLanguagesForUrl } from '../utils/general.js';

export abstract class TrbBaseAddon<
  T extends BaseDebridConfig,
> extends BaseDebridAddon<T> {
  readonly id: string;
  readonly name: string;
  readonly version = '1.0.0';
  readonly logger: Logger;
  readonly api: TrbAPI;

  constructor(
    userData: T,
    configSchema: z.ZodType<T>,
    clientIp: string | undefined,
    private readonly site: TrbSite
  ) {
    super(userData, configSchema, clientIp);
    this.id = site.id;
    this.name = site.name;
    this.logger = createLogger(site.id);
    this.api = new TrbAPI(site);
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
      titleLanguages: getTitleLanguagesForUrl(
        this.site.getConfig().url,
        this.id
      ),
    });
    if (metadata.imdbId) {
      queries.push(metadata.imdbId);
    }

    if (queries.length === 0) {
      return [];
    }

    const categories = [
      ...(parsedId.mediaType === 'movie' ? [TrbCategory.Movies] : []),
      ...(parsedId.mediaType === 'series'
        ? [TrbCategory.TV, TrbCategory.TVShows]
        : []),
      ...(metadata.isAnime ? [TrbCategory.Anime] : []),
    ];

    this.logger.info(`Performing ${this.site.name} search`, {
      queries,
      categories,
    });

    const searchPromises = queries.map((q) =>
      queryLimit(async () => {
        const start = Date.now();

        this.logger.debug(`Fetching first page for query "${q}"`);
        const firstPageResponse = await this.api.search({
          query: q,
          page: 1,
          categories,
        });

        const { total, pageSize } = firstPageResponse;
        let allResults = [...firstPageResponse.results];

        const totalPages = Math.min(
          Math.ceil(total / pageSize),
          this.site.getConfig().pageLimit
        );

        if (totalPages <= 1) {
          this.logger.info(
            `${this.site.name} search for ${q} took ${getTimeTakenSincePoint(start)}`,
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

        this.logger.debug(
          `Fetching ${pageNumbers.length} additional pages in parallel for query "${q}"`
        );

        const pagePromises = pageNumbers.map(async (pageNum) => {
          const { results } = await this.api.search({
            query: q,
            page: pageNum,
            categories,
          });
          this.logger.debug(`Fetched page ${pageNum} for query "${q}"`, {
            newResults: results.length,
          });
          return results;
        });

        const remainingResults = await Promise.all(pagePromises);
        allResults.push(...remainingResults.flat());

        this.logger.info(
          `${this.site.name} search for ${q} took ${getTimeTakenSincePoint(start)}`,
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
        this.logger.warn(
          `${this.site.name} search hit has no hash: ${JSON.stringify(result)}`
        );
        continue;
      }
      const downloadUrl = `https://itorrents.org/${hash.toUpperCase()}.torrent?title=${encodeURIComponent(result.name)}`;
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
        indexer: `${this.site.indexerLabel} | ${result.user}`,
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
