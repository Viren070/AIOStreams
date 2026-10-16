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
  AnimeDatabase,
  normaliseParsedMediaInfo,
} from '../../utils/index.js';
import TsukihimeAPI, {
  TsukihimeTorrent,
  TsukihimeTorrentsResponse,
  getTsukihimeUrl,
  getTsukihimeNzbUrl,
} from './api.js';
import { NZB, UnprocessedTorrent, hashNzbUrl } from '../../debrid/utils.js';
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

  private results?: Promise<TsukihimeTorrent[]>;

  constructor(userData: TsukihimeAddonConfig, clientIp?: string) {
    super(userData, TsukihimeAddonConfigSchema, clientIp);
    this.api = new TsukihimeAPI();
  }

  // every NZB is also returned as a torrent, so TorBox never needs it
  protected override getNzbServices() {
    return super.getNzbServices().filter((s) => s.id !== 'torbox');
  }

  protected async _searchNzbs(parsedId: ParsedId): Promise<NZB[]> {
    if (this.getNzbServices().length === 0) {
      return [];
    }

    let results: TsukihimeTorrent[];
    try {
      results = await this.getResults(parsedId);
    } catch (error) {
      // the torrent search already reports the same failure
      if (this.getTorrentServices().length > 0) return [];
      throw error;
    }

    const seenNzbs = new Set<string>();
    const nzbs: NZB[] = [];
    for (const result of results) {
      if (!result.hasNzb) continue;
      const nzb = getTsukihimeNzbUrl(result);
      if (seenNzbs.has(nzb)) continue;
      seenNzbs.add(nzb);

      nzbs.push({
        ...this.toBaseFile(result),
        hash: hashNzbUrl(nzb),
        nzb,
        type: 'usenet',
      });
    }
    return nzbs;
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    if (this.getTorrentServices().length === 0) {
      return [];
    }

    const results = await this.getResults(parsedId);

    const seenTorrents = new Set<string>();
    const torrents: UnprocessedTorrent[] = [];
    for (const result of results) {
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

      torrents.push({
        ...this.toBaseFile(result),
        hash,
        sources: [],
        type: 'torrent',
      });
    }
    return torrents;
  }

  private toBaseFile(result: TsukihimeTorrent) {
    return {
      indexer: 'TsukiHime',
      group: result.group,
      age: Math.ceil(
        (Date.now() - result.sourceDate * 1000) / (1000 * 60 * 60)
      ),
      title: result.name,
      size: result.size,
      parsedMediaInfo: normaliseParsedMediaInfo({
        mediaInfoQuality: 'indexer',
        languages: result.audioLangs,
        subtitles: result.subLangs,
      }),
    };
  }

  private getResults(parsedId: ParsedId): Promise<TsukihimeTorrent[]> {
    this.results ??= this.search(parsedId);
    return this.results;
  }

  private async search(parsedId: ParsedId): Promise<TsukihimeTorrent[]> {
    const metadata = await this.getSearchMetadata();
    if (!metadata.isAnime) {
      logger.debug(`TsukiHime skipped: not anime content`);
      return [];
    }

    const animeId = await this.resolveAnimeId(parsedId);
    if (!animeId) {
      return this._querySearch(parsedId, metadata);
    }

    logger.info(`Performing TsukiHime search via anime id ${animeId}`);
    const listing = await this._paginate(
      (page) => this.api.getTorrentsForAnime(animeId, page),
      `anime ${animeId}`
    );
    if (!listing.truncated) {
      return listing.results;
    }
    // older episodes of long-runners fall outside the newest-first page limit
    const queryResults = await this._querySearch(parsedId, metadata).catch(
      (): TsukihimeTorrent[] => []
    );
    return [...listing.results, ...queryResults];
  }

  private async resolveAnimeId(parsedId: ParsedId): Promise<number | null> {
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
    return animeId;
  }

  private async _querySearch(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<TsukihimeTorrent[]> {
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
    const perQuery = await Promise.allSettled(
      queries.map((q) =>
        queryLimit(() =>
          this._paginate((page) => this.api.searchTorrents(q, page), q)
        )
      )
    );
    const fulfilled = perQuery.flatMap((r) =>
      r.status === 'fulfilled' ? [r.value.results] : []
    );
    if (fulfilled.length === 0) {
      throw (perQuery[0] as PromiseRejectedResult).reason;
    }
    return fulfilled.flat();
  }

  private async _paginate(
    fetchPage: (page: number) => Promise<TsukihimeTorrentsResponse>,
    label: string
  ): Promise<{ results: TsukihimeTorrent[]; truncated: boolean }> {
    const start = Date.now();
    const firstPage = await fetchPage(1);
    const allResults = [...firstPage.results];

    const availablePages = Math.ceil(firstPage.total / firstPage.limit);
    const totalPages = Math.min(
      availablePages,
      appConfig.builtins.tsukihime.pageLimit
    );

    let failedPages = 0;
    if (totalPages > 1) {
      const pageNumbers = Array.from(
        { length: totalPages - 1 },
        (_, i) => i + 2
      );
      const remainingPages = await Promise.allSettled(
        pageNumbers.map(fetchPage)
      );
      for (const page of remainingPages) {
        if (page.status === 'fulfilled') {
          allResults.push(...page.value.results);
        } else {
          failedPages++;
        }
      }
    }

    logger.info(
      `TsukiHime search for ${label} took ${getTimeTakenSincePoint(start)}`,
      { results: allResults.length, pages: totalPages, failedPages }
    );
    // a failed page is a gap the title search can fill, like the page limit
    return {
      results: allResults,
      truncated: availablePages > totalPages || failedPages > 0,
    };
  }
}
