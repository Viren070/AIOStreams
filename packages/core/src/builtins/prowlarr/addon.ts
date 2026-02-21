import { BaseDebridAddon, BaseDebridConfigSchema } from '../base/debrid.js';
import { z } from 'zod';
import {
  createLogger,
  Env,
  getTimeTakenSincePoint,
} from '../../utils/index.js';
import ProwlarrApi, {
  ProwlarrApiIndexer,
  ProwlarrApiSearchItem,
  ProwlarrApiError,
  ProwlarrApiTagItem,
} from './api.js';
import { ParsedId } from '../../utils/id-parser.js';
import { SearchMetadata } from '../base/debrid.js';
import { Torrent, NZB, UnprocessedTorrent } from '../../debrid/index.js';
import {
  extractInfoHashFromMagnet,
  extractTrackersFromMagnet,
  validateInfoHash,
} from '../utils/debrid.js';
import { createQueryLimit, useAllTitles } from '../utils/general.js';
import { hashNzbUrl } from '../../debrid/utils.js';

export const ProwlarrAddonConfigSchema = BaseDebridConfigSchema.extend({
  url: z.string(),
  apiKey: z.string(),
  indexers: z.array(z.string()),
  tags: z.array(z.string()),
  sources: z.array(z.string()).optional(),
});

export type ProwlarrAddonConfig = z.infer<typeof ProwlarrAddonConfigSchema>;

const logger = createLogger('prowlarr');

export class ProwlarrAddon extends BaseDebridAddon<ProwlarrAddonConfig> {
  readonly id = 'prowlarr';
  readonly name = 'Prowlarr';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly api: ProwlarrApi;

  public static preconfiguredIndexers: ProwlarrApiIndexer[] | undefined;

  private readonly preconfiguredInstance: boolean;
  private readonly indexers: string[] = [];
  private readonly tags: string[] = [];
  private readonly sources: string[] = [];
  constructor(config: ProwlarrAddonConfig, clientIp?: string) {
    super(config, ProwlarrAddonConfigSchema, clientIp);

    this.preconfiguredInstance =
      Env.BUILTIN_PROWLARR_URL === config.url &&
      Env.BUILTIN_PROWLARR_API_KEY === config.apiKey;
    this.indexers = config.indexers.map((x) => x.toLowerCase());
    this.tags = config.tags.map((x) => x.toLowerCase());
    this.sources = (config.sources ?? []).map((x) => x.toLowerCase());
    this.api = new ProwlarrApi({
      baseUrl: config.url,
      apiKey: config.apiKey,
      timeout: Env.BUILTIN_PROWLARR_SEARCH_TIMEOUT,
    });
  }

  public static async fetchpreconfiguredIndexers(): Promise<void> {
    if (this.preconfiguredIndexers) return;
    if (!Env.BUILTIN_PROWLARR_URL || !Env.BUILTIN_PROWLARR_API_KEY) return;
    const api = new ProwlarrApi({
      baseUrl: Env.BUILTIN_PROWLARR_URL,
      apiKey: Env.BUILTIN_PROWLARR_API_KEY,
      timeout: 5000,
    });
    const { data } = await api.indexers();
    logger.debug(`Fetched ${data.length} preconfigured indexers`);
    let filterReasons: Map<string, number> = new Map();

    this.preconfiguredIndexers = data.filter((indexer) => {
      if (!indexer.enable) {
        filterReasons.set(
          'not enabled',
          (filterReasons.get('not enabled') ?? 0) + 1
        );
        return false;
      }
      // if (indexer.protocol !== 'torrent') {
      //   filterReasons.set(
      //     'not torrent protocol',
      //     (filterReasons.get('not torrent protocol') ?? 0) + 1
      //   );
      //   return false;
      // }
      if (Env.BUILTIN_PROWLARR_INDEXERS?.length) {
        if (
          ![
            indexer.name.toLowerCase(),
            indexer.sortName.toLowerCase(),
            indexer.definitionName.toLowerCase(),
          ].some((x) =>
            Env.BUILTIN_PROWLARR_INDEXERS?.map((x) => x.toLowerCase()).includes(
              x
            )
          )
        ) {
          filterReasons.set(
            'not in preconfigured indexers',
            (filterReasons.get('not in preconfigured indexers') ?? 0) + 1
          );
          return false;
        }
      }
      return true;
    });
    logger.debug(
      `Set ${this.preconfiguredIndexers?.length} preconfigured indexers`
    );
    if (filterReasons.size > 0) {
      logger.debug(
        `Filter reasons: ${Array.from(filterReasons.entries())
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')}`
      );
    }
  }

  /**
   * Get indexers filtered by protocol (torrent or usenet)
   */
  private async getIndexersByProtocol(
    protocol: 'torrent' | 'usenet'
  ): Promise<ProwlarrApiIndexer[]> {
    let availableIndexers: ProwlarrApiIndexer[] = [];
    let chosenTags: number[] = [];

    if (this.preconfiguredInstance && ProwlarrAddon.preconfiguredIndexers) {
      availableIndexers = ProwlarrAddon.preconfiguredIndexers;
    } else {
      try {
        const { data } = await this.api.indexers();
        availableIndexers = data;
      } catch (error) {
        if (error instanceof ProwlarrApiError) {
          throw new Error(
            `Failed to get Prowlarr indexers: ${error.message}: ${error.status} - ${error.statusText}`
          );
        }
        throw new Error(`Failed to get Prowlarr indexers: ${error}`);
      }
    }

    try {
      const { data } = await this.api.tags();
      chosenTags = data
        .filter((tag) => this.tags.includes(tag.label.toLowerCase()))
        .map((tag) => tag.id);
    } catch (error) {
      logger.warn(`Failed to get Prowlarr tags: ${error}`);
    }

    const chosenIndexers = availableIndexers.filter(
      (indexer) =>
        indexer.enable &&
        indexer.protocol === protocol &&
        ((!this.indexers.length && !chosenTags.length) ||
          (chosenTags.length &&
            indexer.tags.some((tag) => chosenTags.includes(tag))) ||
          (this.indexers.length &&
            (this.indexers.includes(indexer.name.toLowerCase()) ||
              this.indexers.includes(indexer.definitionName.toLowerCase()) ||
              this.indexers.includes(indexer.sortName.toLowerCase()))))
    );

    this.logger.info(
      `Chosen ${protocol} indexers: ${chosenIndexers.map((indexer) => indexer.name).join(', ')}`
    );

    return chosenIndexers;
  }

  /**
   * Common search method that performs the actual Prowlarr API search
   * @param protocol - The protocol type ('torrent' or 'usenet')
   * @param parsedId - The parsed content ID
   * @param metadata - Search metadata
   * @returns Array of search results from Prowlarr
   */
  private async performSearch(
    protocol: 'torrent' | 'usenet',
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<{
    results: ProwlarrApiSearchItem[];
    privateIndexerIds: Set<number>;
  }> {
    if (this.sources.length > 0 && !this.sources.includes(protocol)) {
      return { results: [], privateIndexerIds: new Set() };
    }

    const queryLimit = createQueryLimit();
    const chosenIndexers = await this.getIndexersByProtocol(protocol);

    if (chosenIndexers.length === 0) {
      this.logger.warn(`No ${protocol} indexers available`);
      return { results: [], privateIndexerIds: new Set() };
    }

    const privateIndexerIds = new Set(
      chosenIndexers
        .filter((i) => i.privacy === 'private' || i.privacy === 'semiPrivate')
        .map((i) => i.id)
    );

    const queries = this.buildQueries(parsedId, metadata, {
      useAllTitles: useAllTitles(this.userData.url),
      keepApostrophes: true,
    });
    if (queries.length === 0) {
      return { results: [], privateIndexerIds };
    }

    // Pass Newznab categories so Prowlarr only queries indexers that support
    // the content type (e.g. PTP won't receive TV queries).
    const categories =
      parsedId.mediaType === 'movie' ? [2000] : // Movies (all subcategories)
      parsedId.mediaType === 'series' ? [5000] : // TV (all subcategories)
      undefined;

    const searchPromises = queries.map((q) =>
      queryLimit(async () => {
        const start = Date.now();
        const { data } = await this.api.search({
          query: q,
          indexerIds: chosenIndexers.map((indexer) => indexer.id),
          categories,
          type: 'search',
          limit: 2000,
        });
        this.logger.info(
          `Prowlarr ${protocol} search for ${q} took ${getTimeTakenSincePoint(start)}`,
          {
            results: data.length,
          }
        );
        return data;
      })
    );
    const allResults = await Promise.all(searchPromises);
    return { results: allResults.flat(), privateIndexerIds };
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    const metadata = await this.getSearchMetadata();
    const { results, privateIndexerIds } = await this.performSearch(
      'torrent',
      parsedId,
      metadata
    );
    if (results.length === 0) return [];

    const seenTorrents = new Set<string>();
    const torrents: UnprocessedTorrent[] = [];

    for (const result of results) {
      const magnetUrl = result.guid?.includes('magnet:')
        ? result.guid
        : undefined;
      const downloadUrl = result.magnetUrl?.startsWith('http')
        ? result.magnetUrl
        : result.downloadUrl;
      const infoHash = validateInfoHash(
        result.infoHash ||
          (magnetUrl ? extractInfoHashFromMagnet(magnetUrl) : undefined)
      );
      if (!infoHash && !downloadUrl) continue;
      if (seenTorrents.has(infoHash ?? downloadUrl!)) continue;
      seenTorrents.add(infoHash ?? downloadUrl!);

      const isPrivate = privateIndexerIds.has(result.indexerId) || undefined;

      torrents.push({
        hash: infoHash,
        downloadUrl: downloadUrl,
        sources: magnetUrl ? extractTrackersFromMagnet(magnetUrl) : [],
        seeders: result.seeders,
        title: result.title,
        size: result.size,
        indexer: result.indexer,
        type: 'torrent',
        private: isPrivate,
      });
    }
    return torrents;
  }

  protected async _searchNzbs(parsedId: ParsedId): Promise<NZB[]> {
    const metadata = await this.getSearchMetadata();
    const { results } = await this.performSearch('usenet', parsedId, metadata);
    if (results.length === 0) return [];

    const seenNzbs = new Set<string>();
    const nzbs: NZB[] = [];

    for (const result of results) {
      const nzbUrl = result.downloadUrl ?? result.guid;
      if (!nzbUrl) continue;
      if (seenNzbs.has(nzbUrl)) continue;
      seenNzbs.add(nzbUrl);

      const hash = hashNzbUrl(nzbUrl);

      nzbs.push({
        hash,
        nzb: nzbUrl,
        age: Math.ceil(result.age * 24),
        title: result.title,
        size: result.size,
        indexer: result.indexer,
        type: 'usenet',
      });
    }
    return nzbs;
  }
}
