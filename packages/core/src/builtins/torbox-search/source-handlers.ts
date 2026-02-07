import { number, z } from 'zod';
import { CacheAndPlay, Stream } from '../../db/index.js';
import {
  AnimeDatabase,
  BuiltinServiceId,
  Cache,
  Env,
  SERVICE_DETAILS,
  createLogger,
  encryptString,
  getSimpleTextHash,
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
  generatePlaybackUrl,
  metadataStore,
} from '../../debrid/utils.js';
import { DebridFile, FileInfo, PlaybackInfo } from '../../debrid/index.js';
import { getTraktAliases } from '../../metadata/trakt.js';
import { formatHours } from '../../formatters/utils.js';
import { parseAgeString } from '../../parser/utils.js';

const logger = createLogger('torbox-search');

export interface TitleMetadata {
  titles: string[];
  year?: number;
  seasonYear?: number;
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  relativeAbsoluteEpisode?: number;
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
    protected readonly searchUserEngines: boolean,
    protected readonly cacheAndPlay: CacheAndPlay,
    protected readonly autoRemoveDownloads?: boolean
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
    torrentOrNzb: TorrentWithSelectedFile | NZBWithSelectedFile,
    encryptedStoreAuths: Record<BuiltinServiceId, string>,
    metadataId: string
  ): Stream {
    // Handle debrid streaming
    const encryptedStoreAuth = torrentOrNzb.service
      ? encryptedStoreAuths?.[torrentOrNzb.service?.id]
      : undefined;

    const fileInfo: FileInfo | undefined = torrentOrNzb.service
      ? torrentOrNzb.type === 'torrent'
        ? {
            type: 'torrent',
            downloadUrl: torrentOrNzb.downloadUrl,
            hash: torrentOrNzb.hash,
            private: torrentOrNzb.private,
            sources: torrentOrNzb.sources,
            index: torrentOrNzb.file.index,
            cacheAndPlay:
              this.cacheAndPlay?.enabled &&
              this.cacheAndPlay?.streamTypes?.includes('torrent'),
            autoRemoveDownloads: this.autoRemoveDownloads,
          }
        : {
            type: 'usenet',
            nzb: torrentOrNzb.nzb,
            hash: torrentOrNzb.hash,
            index: torrentOrNzb.file.index,
            cacheAndPlay:
              this.cacheAndPlay?.enabled &&
              this.cacheAndPlay?.streamTypes?.includes('usenet'),
            autoRemoveDownloads: this.autoRemoveDownloads,
          }
      : undefined;

    const svcMeta = torrentOrNzb.service
      ? SERVICE_DETAILS[torrentOrNzb.service.id]
      : undefined;
    // const svcMeta = SERVICE_DETAILS[torrentOrNzb.service.id];
    const shortCode = svcMeta?.shortName || 'P2P';
    const cacheIndicator = torrentOrNzb.service
      ? torrentOrNzb.service.cached
        ? '⚡'
        : '⏳'
      : '';

    const age =
      typeof torrentOrNzb.age === 'number'
        ? torrentOrNzb.age
        : typeof torrentOrNzb.age === 'string'
          ? parseAgeString(torrentOrNzb.age)
          : undefined;

    const name = `[${shortCode} ${cacheIndicator}${torrentOrNzb.service?.library ? ' ☁️' : ''}] TorBox Search`;
    const description = `${torrentOrNzb.title}\n${torrentOrNzb.file.name}\n${
      torrentOrNzb.indexer ? `🔍 ${torrentOrNzb.indexer}` : ''
    } ${'seeders' in torrentOrNzb && torrentOrNzb.seeders ? `👤 ${torrentOrNzb.seeders}` : ''} ${
      age ? `🕒 ${formatHours(age)}` : ''
    }`;

    return {
      url: torrentOrNzb.service
        ? generatePlaybackUrl(
            encryptedStoreAuth!,
            metadataId!,
            fileInfo!,
            torrentOrNzb.file.name ?? torrentOrNzb.title
          )
        : undefined,
      name,
      description,
      type: torrentOrNzb.type,
      age: age,
      infoHash: torrentOrNzb.hash,
      fileIdx: torrentOrNzb.file.index,
      behaviorHints: {
        videoSize: torrentOrNzb.file.size,
        filename: torrentOrNzb.file.name,
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
          if (
            animeEntry?.imdb?.nonImdbEpisodes &&
            absoluteEpisode &&
            parsedId.type === 'imdbId'
          ) {
            const nonImdbEpisodesBefore =
              animeEntry.imdb.nonImdbEpisodes.filter(
                (ep) => ep < absoluteEpisode!
              ).length;
            if (nonImdbEpisodesBefore > 0) {
              absoluteEpisode += nonImdbEpisodesBefore;
            }
          }
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
    cacheAndPlay: CacheAndPlay,
    autoRemoveDownloads?: boolean,
    clientIp?: string
  ) {
    super(searchApi, searchUserEngines, cacheAndPlay, autoRemoveDownloads);
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
      fetchResult.torrents.map((torrent) => {
        return {
          ...torrent,
          type: 'torrent',
        };
      }),
      this.services,
      parsedId.fullId,
      fetchResult.metadata,
      this.clientIp
    );

    results.forEach((result) => {
      result.service!.library =
        fetchResult.torrents.find((torrent) => torrent.hash === result.hash)
          ?.owned ?? false;
    });

    const encryptedStoreAuths = userData.services.reduce(
      (acc, service) => {
        const auth = {
          id: service.id,
          credential: service.credential,
        };
        acc[service.id] = encryptString(JSON.stringify(auth)).data ?? '';
        return acc;
      },
      {} as Record<BuiltinServiceId, string>
    );

    const metadataId = getSimpleTextHash(JSON.stringify(fetchResult.metadata));
    if (fetchResult.metadata) {
      await metadataStore().set(
        metadataId,
        fetchResult.metadata,
        Env.BUILTIN_PLAYBACK_LINK_VALIDITY
      );
    }

    return results.map((result) =>
      this.createStream(result, encryptedStoreAuths, metadataId)
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
        {
          ...data.metadata,
          title: data.metadata.title ?? undefined,
        },
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
    cacheAndPlay: CacheAndPlay,
    autoRemoveDownloads?: boolean,
    clientIp?: string
  ) {
    super(searchApi, searchUserEngines, cacheAndPlay, autoRemoveDownloads);
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
    let torrents: Torrent[] | undefined = await this.searchCache.get(cacheKey);
    let titleMetadata: TitleMetadata | undefined = await this.metadataCache.get(
      `metadata:${type}:${value}`
    );

    if (!torrents || !titleMetadata) {
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

        if (data.metadata && data.metadata.title) {
          titleMetadata = await this.processMetadata(
            parsedId,
            // data.metadata,
            {
              ...data.metadata,
              title: data.metadata.title,
            },
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
        confirmed: true,
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
      result.service!.library =
        nzbs.find((nzb) => nzb.hash === result.hash)?.owned ?? false;
    });

    const encryptedStoreAuths = userData.services.reduce(
      (acc, service) => {
        const auth = {
          id: service.id,
          credential: service.credential,
        };
        acc[service.id] = encryptString(JSON.stringify(auth)).data ?? '';
        return acc;
      },
      {} as Record<BuiltinServiceId, string>
    );

    const metadataId = getSimpleTextHash(JSON.stringify(titleMetadata));
    if (titleMetadata) {
      await metadataStore().set(
        metadataId,
        titleMetadata,
        Env.BUILTIN_PLAYBACK_LINK_VALIDITY
      );
    }

    return results.map((result) =>
      this.createStream(result, encryptedStoreAuths, metadataId)
    );
  }
}
