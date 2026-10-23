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
import { config as appConfig } from '../../config/index.js';
import KnabenAPI, { KnabenCategory, knabenApiUrl } from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import {
  extractInfoHashFromMagnet,
  extractTrackersFromMagnet,
  validateInfoHash,
} from '../utils/debrid.js';
import { createQueryLimit, getTitleLanguagesForUrl } from '../utils/general.js';
import { getYearlessQueries } from '../utils/yearless.js';

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
      titleLanguages: getTitleLanguagesForUrl(knabenApiUrl, this.id),
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

    const runQueries = async (queryList: string[]) => {
      logger.info(`Performing knaben search`, {
        queries: queryList,
        categories,
      });
      return (
        await Promise.all(
          queryList.map((q) =>
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
                { results: hits.length }
              );
              return hits;
            })
          )
        )
      ).flat();
    };

    const isAllowedCategory = (
      hit: Awaited<ReturnType<typeof runQueries>>[number]
    ) =>
      !BLACKLISTED_CATEGORIES.some((category) =>
        hit.categoryId.includes(category)
      );
    let hits = await runQueries(queries);
    const yearlessFallback = appConfig.builtins.scrape.yearlessMovieFallback;
    if (
      parsedId.mediaType === 'movie' &&
      metadata.year &&
      yearlessFallback.enabled
    ) {
      const identity = (hit: (typeof hits)[number]) => {
        const hash = validateInfoHash(
          hit.hash ??
            (hit.magnetUrl
              ? extractInfoHashFromMagnet(hit.magnetUrl)
              : undefined)
        );
        return (
          hash ||
          (appConfig.builtins.knaben.downloadTorrents ? hit.link : undefined)
        );
      };
      const uniqueCount = new Set(
        hits.filter(isAllowedCategory).map(identity).filter(Boolean)
      ).size;
      if (uniqueCount < yearlessFallback.resultThreshold) {
        const yearlessQueries = getYearlessQueries(queries, metadata.year);
        if (yearlessQueries.length > 0) {
          logger.info(
            'Year-constrained Knaben movie search returned too few unique results; retrying without year',
            {
              uniqueResults: uniqueCount,
              threshold: yearlessFallback.resultThreshold,
              queries: yearlessQueries,
            }
          );
          try {
            hits.push(...(await runQueries(yearlessQueries)));
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

    hits = hits.filter(isAllowedCategory);

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
      if (!hash && hit.link && !appConfig.builtins.knaben.downloadTorrents) {
        continue;
      }
      if (seenTorrents.has(hash ?? hit.link ?? '')) {
        continue;
      }
      seenTorrents.add(hash ?? hit.link ?? '');

      let sources: string[] = [];
      if (hit.magnetUrl) sources = extractTrackersFromMagnet(hit.magnetUrl);
      let age = undefined;
      if (hit.lastSeen) {
        const lastSeenDate = new Date(hit.lastSeen);
        const now = new Date();
        const diffMs = now.getTime() - lastSeenDate.getTime();
        age = Math.floor(diffMs / (1000 * 60 * 60));
      }
      torrents.push({
        hash: hash ?? undefined,
        downloadUrl: hit.link ?? undefined,
        sources,
        age,
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
