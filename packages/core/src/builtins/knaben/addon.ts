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
import KnabenAPI, { KnabenCategory, knabenApiUrl } from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import {
  extractInfoHashFromMagnet,
  extractTrackersFromMagnet,
  validateInfoHash,
} from '../utils/debrid.js';
import { createQueryLimit, useAllTitles } from '../utils/general.js';

const logger = createLogger('knaben');

export const KnabenAddonConfigSchema = BaseDebridConfigSchema;

export type KnabenAddonConfig = z.infer<typeof KnabenAddonConfigSchema>;

const BLACKLISTED_CATEGORIES = [
  KnabenCategory.AnimeLiterature,
  KnabenCategory.AnimeMusic,
  KnabenCategory.AnimeMusicVideo,
];

export class KnabenAddon extends BaseDebridAddon<KnabenAddonConfig> {
  readonly id = 'knaben';
  readonly name = 'Knaben';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly api: KnabenAPI;

  constructor(userData: KnabenAddonConfig, clientIp?: string) {
    super(userData, KnabenAddonConfigSchema, clientIp);
    this.api = new KnabenAPI();
  }

  protected async _searchNzbs(_parsedId: ParsedId): Promise<NZB[]> {
    return [];
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    const queryLimit = createQueryLimit();
    let categories: number[] = [];
    const metadata = await this.getSearchMetadata();
    if (!metadata.primaryTitle) {
      return [];
    }

    const queries = this.buildQueries(parsedId, metadata, {
      useAllTitles: useAllTitles(knabenApiUrl),
    });

    if (queries.length === 0) {
      return [];
    }

    categories = [
      ...(parsedId.mediaType === 'movie' ? [KnabenCategory.Movies] : []),
      ...(parsedId.mediaType === 'series' || metadata.isAnime
        ? [KnabenCategory.TV]
        : []),
      ...(metadata.isAnime ? [KnabenCategory.Anime] : []),
    ];

    logger.info(`Performing knaben search`, { queries, categories });

    const searchPromises = queries.map((q) =>
      queryLimit(async () => {
        const start = Date.now();
        const { hits } = await this.api.search({
          query: q,
          categories,
          size: 300,
          hideUnsafe: false,
        });
        logger.info(
          `Knaben search for ${q} took ${getTimeTakenSincePoint(start)}`,
          {
            results: hits.length,
          }
        );
        return hits;
      })
    );

    const allResults = await Promise.all(searchPromises);
    const hits = allResults
      .flat()
      .filter(
        (hit) =>
          !BLACKLISTED_CATEGORIES.some((category) =>
            hit.categoryId.includes(category)
          )
      );

    const seenTorrents = new Set<string>();
    const torrents: UnprocessedTorrent[] = [];
    for (const hit of hits) {
      const hash = validateInfoHash(
        hit.hash ??
          (hit.magnetUrl ? extractInfoHashFromMagnet(hit.magnetUrl) : undefined)
      );
      if (!hash && !hit.link) {
        logger.warn(
          `Knaben search hit has no hash or download url: ${JSON.stringify(hit)}`
        );
        continue;
      }
      if (seenTorrents.has(hash ?? hit.link ?? '')) {
        continue;
      }
      let sources: string[] = [];
      if (hit.magnetUrl) {
        sources = extractTrackersFromMagnet(hit.magnetUrl);
      }

      torrents.push({
        hash: hash ?? undefined,
        downloadUrl: hit.link ?? undefined,
        sources,
        indexer: hit.tracker,
        seeders: hit.seeders,
        title: hit.title,
        size: hit.bytes,
        type: 'torrent',
      });
    }
    return torrents;
  }
}
