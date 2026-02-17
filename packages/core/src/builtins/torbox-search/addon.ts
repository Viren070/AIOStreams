import { z } from 'zod';
import { BaseDebridAddon, BaseDebridConfigSchema } from '../base/debrid.js';
import {
  createLogger,
  getTimeTakenSincePoint,
  ParsedId,
  Cache,
  Env,
} from '../../utils/index.js';
import { IdType } from '../../utils/id-parser.js';
import TorboxSearchApi, {
  TorboxSearchApiError,
  supportedIdTypes,
  TorboxSearchApiIdType,
} from './search-api.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';
import { convertDataToTorrents, Torrent } from './torrent.js';

const logger = createLogger('torbox-search');

export const TorBoxSearchAddonConfigSchema = BaseDebridConfigSchema.extend({
  torBoxApiKey: z.string(),
  sources: z
    .array(z.enum(['torrent', 'usenet']))
    .min(1, 'At least one source must be configured'),
  searchUserEngines: z.boolean().default(false),
  onlyShowUserSearchResults: z.boolean().default(false),
});

export type TorBoxSearchAddonConfig = z.infer<
  typeof TorBoxSearchAddonConfigSchema
>;

export class TorBoxSearchAddon extends BaseDebridAddon<TorBoxSearchAddonConfig> {
  readonly id = 'torbox-search';
  readonly name = 'TorBox Search';
  readonly version = '1.0.0';
  readonly logger = logger;

  private readonly searchApi: TorboxSearchApi;

  protected static override readonly supportedIdTypes: IdType[] =
    supportedIdTypes;

  private readonly searchCache = Cache.getInstance<string, Torrent[]>(
    'tb-search:torrents'
  );

  constructor(userData: TorBoxSearchAddonConfig, clientIp?: string) {
    super(userData, TorBoxSearchAddonConfigSchema, clientIp);
    this.searchApi = new TorboxSearchApi(this.userData.torBoxApiKey);
  }

  private get useCache(): boolean {
    return (
      !this.userData.searchUserEngines ||
      Env.BUILTIN_TORBOX_SEARCH_CACHE_PER_USER_SEARCH_ENGINE
    );
  }

  private getCacheKey(parsedId: ParsedId, type: 'torrent' | 'usenet'): string {
    let cacheKey = `${type}:${parsedId.type}:${parsedId.value}:${parsedId.season}:${parsedId.episode}`;
    if (this.userData.searchUserEngines) {
      cacheKey += `:${this.searchApi.apiKey}`;
    }
    return cacheKey;
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    if (!this.userData.sources.includes('torrent')) {
      return [];
    }

    const cacheKey = this.getCacheKey(parsedId, 'torrent');
    const cachedTorrents = await this.searchCache.get(cacheKey);

    if (cachedTorrents && this.useCache) {
      logger.info(
        `Found ${cachedTorrents.length} (cached) torrents for ${parsedId.type}:${parsedId.value}`
      );
      return cachedTorrents
        .filter((t) => t.hash)
        .map((t) => this.torrentToUnprocessed(t));
    }

    const start = Date.now();
    let data;
    try {
      data = await this.searchApi.getTorrentsById(
        parsedId.externalType as TorboxSearchApiIdType,
        parsedId.value.toString(),
        {
          search_user_engines: this.userData.searchUserEngines
            ? 'true'
            : 'false',
          season: parsedId.season,
          episode: parsedId.episode,
          metadata: 'false',
          check_owned: 'true',
        }
      );
    } catch (error) {
      if (
        error instanceof TorboxSearchApiError &&
        error.errorCode === 'BAD_TOKEN'
      ) {
        throw new Error('Invalid/expired TorBox credentials');
      }
      throw error;
    }

    let torrents = convertDataToTorrents(data.torrents);
    logger.info(
      `Found ${torrents.length} torrents for ${parsedId.type}:${parsedId.value} in ${getTimeTakenSincePoint(start)}`
    );

    if (torrents.length === 0) return [];

    if (this.userData.onlyShowUserSearchResults) {
      const userSearchResults = torrents.filter((t) => t.userSearch);
      logger.info(
        `Filtered out ${torrents.length - userSearchResults.length} torrents that were not user search results`
      );
      if (userSearchResults.length > 0) {
        torrents = userSearchResults;
      } else {
        return [];
      }
    }

    if (this.useCache) {
      await this.searchCache.set(
        cacheKey,
        torrents.filter(
          (t) =>
            !t.userSearch ||
            (this.userData.searchUserEngines &&
              Env.BUILTIN_TORBOX_SEARCH_CACHE_PER_USER_SEARCH_ENGINE)
        ),
        Env.BUILTIN_TORBOX_SEARCH_SEARCH_API_CACHE_TTL
      );
    }

    return torrents
      .filter((t) => t.hash)
      .map((t) => this.torrentToUnprocessed(t));
  }

  protected async _searchNzbs(parsedId: ParsedId): Promise<NZB[]> {
    if (!this.userData.sources.includes('usenet')) {
      return [];
    }

    // Usenet on TorBox Search only works with TorBox service
    if (!this.userData.services.some((s) => s.id === 'torbox')) {
      return [];
    }

    const cacheKey = this.getCacheKey(parsedId, 'usenet');
    const cachedTorrents = await this.searchCache.get(cacheKey);

    if (cachedTorrents && this.useCache) {
      logger.info(
        `Found ${cachedTorrents.length} (cached) NZBs for ${parsedId.type}:${parsedId.value}`
      );
      return cachedTorrents
        .filter((t) => t.nzb)
        .map((t) => this.torrentToNzb(t));
    }

    const start = Date.now();
    let data;
    try {
      data = await this.searchApi.getUsenetById(
        parsedId.externalType as TorboxSearchApiIdType,
        parsedId.value.toString(),
        {
          season: parsedId.season,
          episode: parsedId.episode,
          check_cache: 'true',
          check_owned: 'true',
          search_user_engines: this.userData.searchUserEngines
            ? 'true'
            : 'false',
          metadata: 'false',
        }
      );
    } catch (error) {
      if (
        error instanceof TorboxSearchApiError &&
        error.errorCode === 'BAD_TOKEN'
      ) {
        throw new Error('Invalid/expired TorBox credentials');
      }
      throw error;
    }

    const torrents = convertDataToTorrents(data.nzbs);
    logger.info(
      `Found ${torrents.length} NZBs for ${parsedId.type}:${parsedId.value} in ${getTimeTakenSincePoint(start)}`
    );

    if (torrents.length === 0) return [];

    let filteredTorrents = torrents;
    if (this.userData.onlyShowUserSearchResults) {
      const userSearchResults = filteredTorrents.filter((t) => t.userSearch);
      logger.info(
        `Filtered out ${filteredTorrents.length - userSearchResults.length} NZBs that were not user search results`
      );
      if (userSearchResults.length > 0) {
        filteredTorrents = userSearchResults;
      } else {
        return [];
      }
    }

    if (this.useCache) {
      await this.searchCache.set(
        cacheKey,
        filteredTorrents,
        Env.BUILTIN_TORBOX_SEARCH_SEARCH_API_CACHE_TTL
      );
    }

    return filteredTorrents
      .filter((t) => t.nzb)
      .map((t) => this.torrentToNzb(t));
  }

  private torrentToUnprocessed(torrent: Torrent): UnprocessedTorrent {
    return {
      type: 'torrent',
      hash: torrent.hash || undefined,
      sources: torrent.sources,
      title: torrent.title,
      size: torrent.size,
      indexer: torrent.indexer,
      seeders: torrent.seeders,
      age: torrent.age,
    };
  }

  private torrentToNzb(torrent: Torrent): NZB {
    return {
      type: 'usenet',
      hash: torrent.hash,
      nzb: torrent.nzb!,
      title: torrent.title,
      size: torrent.size,
      indexer: torrent.indexer,
      age: torrent.age,
    };
  }
}
