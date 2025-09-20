import { number, z } from 'zod';
import { Stream } from '../../db/index.js';
import {
  AnimeDatabase,
  Cache,
  Env,
  SERVICE_DETAILS,
  createLogger,
  getTimeTakenSincePoint,
} from '../../utils/index.js';
// import { DebridService, DebridFile } from './debrid-service';
import { IdParser, ParsedId } from '../../utils/id-parser.js';
import { TorBoxSearchAddonUserDataSchema } from './schemas.js';
import TorboxSearchApi, {
  TorboxSearchApiError,
  TorboxSearchApiIdType,
} from './search-api.js';
import { Torrent, convertDataToTorrents } from './torrent.js';
import { TMDBMetadata } from '../../metadata/tmdb.js';
import { calculateAbsoluteEpisode } from '../utils/general.js';
import { TorboxApi } from '@torbox/torbox-api';
import { processNZBs, processTorrents } from '../utils/debrid.js';
import {
  NZBWithSelectedFile,
  TorrentWithSelectedFile,
} from '../../debrid/utils.js';
import { DebridFile, PlaybackInfo } from '../../debrid/index.js';
import { getTraktAliases } from '../../metadata/trakt.js';

const logger = createLogger('torbox-search');

export interface TitleMetadata {
  titles: string[];
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
}

abstract class SourceHandler {
  protected searchCache = Cache.getInstance<string, Torrent[]>(
    'tb-search:torrents'
  );
  protected metadataCache = Cache.getInstance<string, TitleMetadata>(
    'tb-search:metadata'
  );

  protected errorStreams: Stream[] = [];
  protected readonly useCache: boolean;

  constructor(
    protected searchApi: TorboxSearchApi,
    protected readonly searchUserEngines: boolean
  ) {
    this.useCache =
      !this.searchUserEngines ||
      Env.BUILTIN_TORBOX_SEARCH_CACHE_PER_USER_SEARCH_ENGINE;
  }

  abstract getStreams(
    parsedId: ParsedId,
    userData: z.infer<typeof TorBoxSearchAddonUserDataSchema>
  ): Promise<Stream[]>;

  protected getCacheKey(
    parsedId: ParsedId,
    type: 'torrent' | 'usenet'
  ): string {
    let cacheKey = `${type}:${parsedId.type}:${parsedId.value}:${parsedId.season}:${parsedId.episode}`;
    if (this.searchUserEngines) {
      cacheKey += `:${this.searchApi.apiKey}`;
    }
    return cacheKey;
  }

  protected createStream(
    id: ParsedId,
    torrentOrNZB: TorrentWithSelectedFile | NZBWithSelectedFile,
    userData: z.infer<typeof TorBoxSearchAddonUserDataSchema>,
    titleMetadata?: TitleMetadata
  ): Stream & { type: 'torrent' | 'usenet' } {
    if (!torrentOrNZB.service) {
      throw new Error('Torrent or NZB has no service');
    }
    const storeAuth = {
      id: torrentOrNZB.service.id,
      credential: userData.services.find(
        (service) => service.id === torrentOrNZB.service!.id
      )?.credential,
    };

    // const playbackInfo: PlaybackInfo = {
    //   type: 'usenet',
    //   hash: torrent.hash,
    //   magnet: torrent.type === 'torrent' ? torrent.magnet : undefined,
    //   title: torrent.title,
    //   nzb: torrent.type === 'usenet' ? torrent.nzb : undefined,
    //   file: torrent.file,
    //   metadata: titleMetadata,
    // };
    const playbackInfo: PlaybackInfo =
      torrentOrNZB.type === 'torrent'
        ? {
            type: 'torrent',
            hash: torrentOrNZB.hash,
            sources: torrentOrNZB.sources,
            // magnet: torrentOrNZB.magnet,
            title: torrentOrNZB.title,
            file: torrentOrNZB.file,
            metadata: titleMetadata,
          }
        : {
            type: 'usenet',
            nzb: torrentOrNZB.nzb,
            title: torrentOrNZB.title,
            hash: torrentOrNZB.hash,
            file: torrentOrNZB.file,
            metadata: titleMetadata,
          };

    const svcMeta = SERVICE_DETAILS[torrentOrNZB.service.id];
    const name = `[${svcMeta.shortName} ${torrentOrNZB.service.cached ? '⚡' : '⏳'}${torrentOrNZB.service.owned ? ' ☁️' : ''}] TorBox Search`;
    const description = `${torrentOrNZB.title}\n${torrentOrNZB.file.name}\n${torrentOrNZB.indexer ? `🔍 ${torrentOrNZB.indexer}` : ''} ${torrentOrNZB.seeders ? `👤 ${torrentOrNZB.seeders}` : ''} ${torrentOrNZB.age && torrentOrNZB.age !== '0d' ? `🕒 ${torrentOrNZB.age}` : ''}`;

    return {
      url: `${Env.BASE_URL}/api/v1/debrid/playback/${encodeURIComponent(Buffer.from(JSON.stringify(storeAuth)).toString('base64'))}/${encodeURIComponent(Buffer.from(JSON.stringify(playbackInfo)).toString('base64'))}/${encodeURIComponent(torrentOrNZB.file.name || torrentOrNZB.title || 'unknown')}`,
      name,
      description,
      type: torrentOrNZB.type,
      infoHash: torrentOrNZB.hash,
      behaviorHints: {
        videoSize: torrentOrNZB.file.size,
        filename: torrentOrNZB.file.name,
      },
    };
  }

  protected createErrorStream(error: {
    title: string;
    description: string;
  }): Stream {
    return {
      name: `[❌] TorBox Search ${error.title}`,
      description: error.description,
      externalUrl: 'stremio:///',
    };
  }

  protected async processMetadata(
    parsedId: ParsedId,
    metadata?: {
      tmdb_id?: string | number | null;
      titles: string[];
      globalID?: string;
      title?: string;
      imdb_id?: string | null;
    },
    tmdbAccessToken?: string
  ): Promise<TitleMetadata | undefined> {
    if (!metadata) return undefined;

    const { tmdb_id, titles } = metadata;
    let absoluteEpisode;

    const animeEntry = AnimeDatabase.getInstance().getEntryById(
      parsedId.type,
      parsedId.value
    );
    const tmdbId =
      animeEntry?.mappings?.themoviedbId || tmdb_id
        ? IdParser.parse(
            `tmdb:${animeEntry?.mappings?.themoviedbId || tmdb_id}`,
            'series'
          )
        : null;

    const traktAliases = await getTraktAliases(parsedId);

    // For anime sources, fetch additional season info from TMDB
    if (animeEntry && parsedId.season && parsedId.episode && tmdbId) {
      const seasonFetchStart = Date.now();
      try {
        const tmdbMetadata = await new TMDBMetadata({
          accessToken: tmdbAccessToken,
        }).getMetadata(tmdbId);

        const seasons = tmdbMetadata?.seasons?.map(
          ({ season_number, episode_count }) => ({
            number: season_number.toString(),
            episodes: episode_count,
          })
        );

        if (seasons) {
          absoluteEpisode = calculateAbsoluteEpisode(
            parsedId.season.toString(),
            parsedId.episode.toString(),
            seasons
          );
        }

        logger.debug(
          `Fetched additional season info for ${parsedId.type}:${parsedId.value} in ${getTimeTakenSincePoint(seasonFetchStart)}`
        );
      } catch (error) {
        logger.error(
          `Failed to fetch TMDB metadata for ${parsedId.type}:${parsedId.value} - ${error}`
        );
      }
    }

    const titleMetadata: TitleMetadata = {
      titles: [...new Set([...(traktAliases ?? []), ...titles])],
      season: parsedId.season ? Number(parsedId.season) : undefined,
      episode: parsedId.episode ? Number(parsedId.episode) : undefined,
      absoluteEpisode: absoluteEpisode ? Number(absoluteEpisode) : undefined,
    };

    // Store metadata in cache
    await this.metadataCache.set(
      `metadata:${parsedId.type}:${parsedId.value}`,
      titleMetadata,
      Env.BUILTIN_TORBOX_SEARCH_METADATA_CACHE_TTL
    );

    return titleMetadata;
  }
}

export class TorrentSourceHandler extends SourceHandler {
  // private readonly debridServices: DebridService[];
  private readonly services: z.infer<
    typeof TorBoxSearchAddonUserDataSchema
  >['services'];
  private readonly clientIp?: string;

  constructor(
    searchApi: TorboxSearchApi,
    services: z.infer<typeof TorBoxSearchAddonUserDataSchema>['services'],
    searchUserEngines: boolean,
    clientIp?: string
  ) {
    super(searchApi, searchUserEngines);
    this.services = services;
    this.clientIp = clientIp;
  }

  async getStreams(
    parsedId: ParsedId,
    userData: z.infer<typeof TorBoxSearchAddonUserDataSchema>
  ): Promise<Stream[]> {
    const { type, value, season, episode } = parsedId;
    let fetchResult: { torrents: Torrent[]; metadata?: TitleMetadata };
    try {
      fetchResult = await this.fetchTorrents(
        parsedId,
        userData.tmdbAccessToken
      );
    } catch (error) {
      if (error instanceof TorboxSearchApiError) {
        switch (error.errorCode) {
          case 'BAD_TOKEN':
            return [
              this.createErrorStream({
                title: ``,
                description: 'Invalid/expired credentials',
              }),
            ];
          default:
            logger.error(
              `Error fetching torrents for ${type}:${value}: ${error}`
            );
            throw error;
        }
      }
      logger.error(
        `Unexpected error fetching torrents for ${type}:${value}: ${error}`
      );
      throw error;
    }

    if (fetchResult.torrents.length === 0) return [];

    if (userData.onlyShowUserSearchResults) {
      const userSearchResults = fetchResult.torrents.filter(
        (torrent) => torrent.userSearch
      );
      logger.info(
        `Filtered out ${fetchResult.torrents.length - userSearchResults.length} torrents that were not user search results`
      );
      if (userSearchResults.length > 0) {
        fetchResult.torrents = userSearchResults;
      } else {
        return [];
      }
    }

    const { results, errors } = await processTorrents(
      fetchResult.torrents.map((torrent) => ({
        ...torrent,
        type: 'torrent',
      })),
      this.services,
      parsedId.fullId,
      fetchResult.metadata,
      this.clientIp
    );

    results.forEach((result) => {
      result.service!.owned =
        fetchResult.torrents.find((torrent) => torrent.hash === result.hash)
          ?.owned ?? false;
    });

    return results.map((result) =>
      this.createStream(parsedId, result, userData, fetchResult.metadata)
    );
  }

  private async fetchTorrents(
    parsedId: ParsedId,
    tmdbAccessToken?: string
  ): Promise<{ torrents: Torrent[]; metadata?: TitleMetadata }> {
    const { type, value, season, episode, externalType } = parsedId;
    const cacheKey = this.getCacheKey(parsedId, 'torrent');

    const cachedTorrents = await this.searchCache.get(cacheKey);
    const cachedMetadata = await this.metadataCache.get(
      `metadata:${type}:${value}`
    );

    if (
      cachedTorrents &&
      (!this.searchUserEngines ||
        Env.BUILTIN_TORBOX_SEARCH_CACHE_PER_USER_SEARCH_ENGINE)
    ) {
      logger.info(
        `Found ${cachedTorrents.length} (cached) torrents for ${type}:${value}`
      );
      return { torrents: cachedTorrents, metadata: cachedMetadata };
    }

    const start = Date.now();
    const data = await this.searchApi.getTorrentsById(
      externalType as TorboxSearchApiIdType,
      value.toString(),
      {
        search_user_engines: this.searchUserEngines ? 'true' : 'false',
        season,
        episode,
        metadata: 'true',
        check_owned: 'true',
      }
    );

    const torrents = convertDataToTorrents(data.torrents);
    logger.info(
      `Found ${torrents.length} torrents for ${type}:${value} in ${getTimeTakenSincePoint(start)}`
    );

    let titleMetadata: TitleMetadata | undefined;
    if (data.metadata) {
      titleMetadata = await this.processMetadata(
        parsedId,
        data.metadata,
        tmdbAccessToken
      );
    }

    if (torrents.length === 0) {
      return { torrents: [], metadata: titleMetadata };
    }

    if (this.useCache) {
      await this.searchCache.set(
        cacheKey,
        torrents.filter(
          (torrent) =>
            !torrent.userSearch ||
            (this.searchUserEngines &&
              Env.BUILTIN_TORBOX_SEARCH_CACHE_PER_USER_SEARCH_ENGINE)
        ),
        Env.BUILTIN_TORBOX_SEARCH_SEARCH_API_CACHE_TTL
      );
    }

    return { torrents, metadata: titleMetadata };
  }
}

export class UsenetSourceHandler extends SourceHandler {
  private readonly torboxApi: TorboxApi;
  private readonly services: z.infer<
    typeof TorBoxSearchAddonUserDataSchema
  >['services'];
  private readonly clientIp?: string;

  constructor(
    searchApi: TorboxSearchApi,
    torboxApi: TorboxApi,
    searchUserEngines: boolean,
    services: z.infer<typeof TorBoxSearchAddonUserDataSchema>['services'],
    clientIp?: string
  ) {
    super(searchApi, searchUserEngines);
    this.torboxApi = torboxApi;
    this.services = services.filter((service) => service.id === 'torbox');
    this.clientIp = clientIp;
  }

  async getStreams(
    parsedId: ParsedId,
    userData: z.infer<typeof TorBoxSearchAddonUserDataSchema>
  ): Promise<Stream[]> {
    const { type, value, season, episode, externalType } = parsedId;
    const cacheKey = this.getCacheKey(parsedId, 'usenet');
    let titleMetadata: TitleMetadata | undefined;

    let torrents = await this.searchCache.get(cacheKey);

    if (!torrents) {
      const start = Date.now();
      try {
        const data = await this.searchApi.getUsenetById(
          externalType as TorboxSearchApiIdType,
          value.toString(),
          {
            season,
            episode,
            check_cache: 'true',
            check_owned: 'true',
            search_user_engines: this.searchUserEngines ? 'true' : 'false',
            metadata: 'true',
          }
        );
        torrents = convertDataToTorrents(data.nzbs);
        logger.info(
          `Found ${torrents.length} NZBs for ${parsedId.type}:${parsedId.value} in ${getTimeTakenSincePoint(start)}`
        );

        if (data.metadata) {
          titleMetadata = await this.processMetadata(
            parsedId,
            data.metadata,
            userData.tmdbAccessToken
          );
        }

        if (torrents.length === 0) {
          return [];
        }
        if (this.useCache) {
          await this.searchCache.set(
            cacheKey,
            torrents,
            Env.BUILTIN_TORBOX_SEARCH_SEARCH_API_CACHE_TTL
          );
        }
      } catch (error) {
        if (error instanceof TorboxSearchApiError) {
          switch (error.errorCode) {
            case 'BAD_TOKEN':
              return [
                this.createErrorStream({
                  title: ``,
                  description: 'Invalid/expired credentials',
                }),
              ];
            default:
              logger.error(
                `Error fetching NZBs for ${type}:${value}: ${error.message}`
              );
              throw error;
          }
        }
        logger.error(
          `Unexpected error fetching NZBs for ${type}:${value}: ${error}`
        );
        throw error;
      }
    } else {
      logger.info(
        `Found ${torrents.length} (cached) NZBs for ${type}:${value}`
      );
    }

    if (userData.onlyShowUserSearchResults) {
      const userSearchResults = torrents.filter(
        (torrent) => torrent.userSearch
      );
      logger.info(
        `Filtered out ${torrents.length - userSearchResults.length} NZBs that were not user search results`
      );
      if (userSearchResults.length > 0) {
        torrents = userSearchResults;
      } else {
        return [];
      }
    }

    const nzbs = torrents
      .filter((torrent) => torrent.nzb)
      .map((torrent) => ({
        ...torrent,
        type: 'usenet' as const,
        nzb: torrent.nzb!,
      }));

    const { results, errors } = await processNZBs(
      nzbs,
      this.services,
      parsedId.fullId,
      titleMetadata,
      this.clientIp
    );

    results.forEach((result) => {
      result.service!.owned =
        nzbs.find((nzb) => nzb.hash === result.hash)?.owned ?? false;
    });

    return results.map((result) =>
      this.createStream(parsedId, result, userData, titleMetadata)
    );
  }
}
