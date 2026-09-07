import { BaseDebridAddon, BaseDebridConfigSchema } from '../base/debrid.js';
import { z } from 'zod';
import {
  createLogger,
  getTimeTakenSincePoint,
  ParsedId,
  AnimeDatabase,
  normaliseParsedMediaInfo,
} from '../../utils/index.js';
import TsukihimeAPI, {
  TsukihimeTorrent,
  TsukihimeTorrentsResponse,
  getTsukihimeUrl,
} from './api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import { validateInfoHash } from '../utils/debrid.js';
import { config as appConfig } from '../../config/index.js';
import { createQueryLimit, getTitleLanguagesForUrl } from '../utils/general.js';

const logger = createLogger('tsukihime');

export const TsukihimeAddonConfigSchema = BaseDebridConfigSchema;

export type TsukihimeAddonConfig = z.infer<typeof TsukihimeAddonConfigSchema>;

export class TsukihimeAddon extends BaseDebridAddon<TsukihimeAddonConfig> {
  readonly id = 'tsukihime';
  readonly name = 'TsukiHime';
  readonly version = '1.0.0';
  readonly logger = logger;
  readonly api: TsukihimeAPI;

  constructor(userData: TsukihimeAddonConfig, clientIp?: string) {
    super(userData, TsukihimeAddonConfigSchema, clientIp);
    this.api = new TsukihimeAPI();
  }

  protected async _searchNzbs(_parsedId: ParsedId): Promise<NZB[]> {
    return [];
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    const metadata = await this.getSearchMetadata();
    if (!metadata.isAnime) {
      logger.debug(`TsukiHime skipped: not anime content`);
      return [];
    }

    // A malId can be looked up on TsukiHime directly, skipping the anime-database.
    let animeId: number | null =
      parsedId.type === 'malId'
        ? await this.api.getAnimeId('mal', Number(parsedId.value))
        : null;

    if (!animeId) {
      const animeEntry = await AnimeDatabase.getInstance().getEntryById(
        parsedId.type,
        parsedId.value,
        parsedId.season ? Number(parsedId.season) : undefined,
        parsedId.episode ? Number(parsedId.episode) : undefined
      );

      const malId = animeEntry?.mappings?.malId;
      const anidbId = animeEntry?.mappings?.anidbId;
      const anilistId = animeEntry?.mappings?.anilistId;

      if (malId) {
        animeId = await this.api.getAnimeId('mal', malId);
      }
      if (!animeId && anidbId) {
        animeId = await this.api.getAnimeId('anidb', anidbId);
      }
      if (!animeId && anilistId) {
        animeId = await this.api.getAnimeId('anilist', anilistId);
      }
    }

    let allResults: TsukihimeTorrent[];

    if (animeId) {
      logger.info(`Performing TsukiHime search via anime id ${animeId}`);
      allResults = await this._paginate(
        (page) => this.api.getTorrentsForAnime(animeId!, page),
        `anime ${animeId}`
      );
    } else {
      if (!metadata.primaryTitle) {
        return [];
      }
      const queries = this.buildQueries(parsedId, metadata, {
        titleLanguages: getTitleLanguagesForUrl(getTsukihimeUrl(), this.id),
      });
      if (queries.length === 0) {
        return [];
      }
      logger.info(`Performing TsukiHime search`, { queries });
      const queryLimit = createQueryLimit();
      const perQueryResults = await Promise.all(
        queries.map((q) =>
          queryLimit(() =>
            this._paginate((page) => this.api.searchTorrents(q, page), q)
          )
        )
      );
      allResults = perQueryResults.flat();
    }

    const seenTorrents = new Set<string>();
    const torrents: UnprocessedTorrent[] = [];
    for (const result of allResults) {
      const hash = validateInfoHash(result.hash);
      if (!hash) {
        logger.warn(
          `TsukiHime search hit has no valid hash: ${JSON.stringify(result)}`
        );
        continue;
      }
      if (seenTorrents.has(hash)) {
        continue;
      }
      seenTorrents.add(hash);

      const age = Math.ceil(
        (Date.now() - result.sourceDate * 1000) / (1000 * 60 * 60)
      );

      torrents.push({
        hash,
        sources: [],
        indexer: 'TsukiHime',
        group: result.group,
        age,
        title: result.name,
        size: result.size,
        type: 'torrent',
        parsedMediaInfo: normaliseParsedMediaInfo({
          mediaInfoQuality: 'indexer',
          languages: result.audioLangs,
          subtitles: result.subLangs,
        }),
      });
    }
    return torrents;
  }

  private async _paginate(
    fetchPage: (page: number) => Promise<TsukihimeTorrentsResponse>,
    label: string
  ): Promise<TsukihimeTorrent[]> {
    const start = Date.now();
    const firstPage = await fetchPage(1);
    const allResults = [...firstPage.results];

    const totalPages = Math.min(
      Math.ceil(firstPage.total / firstPage.limit),
      appConfig.builtins.tsukihime.pageLimit
    );

    if (totalPages > 1) {
      const pageNumbers = Array.from(
        { length: totalPages - 1 },
        (_, i) => i + 2
      );
      const remainingPages = await Promise.all(pageNumbers.map(fetchPage));
      allResults.push(...remainingPages.flatMap((p) => p.results));
    }

    logger.info(
      `TsukiHime search for ${label} took ${getTimeTakenSincePoint(start)}`,
      { results: allResults.length, pages: totalPages }
    );
    return allResults;
  }
}
