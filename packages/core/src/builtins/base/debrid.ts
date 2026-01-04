import {
  CacheAndPlaySchema,
  Manifest,
  Meta,
  NNTPServersSchema,
  Stream,
} from '../../db/schemas.js';
import { z, ZodError } from 'zod';
import { IdParser, IdType, ParsedId } from '../../utils/id-parser.js';
import {
  AnimeDatabase,
  BuiltinServiceId,
  constants,
  encryptString,
  Env,
  formatZodError,
  fromUrlSafeBase64,
  getSimpleTextHash,
  getTimeTakenSincePoint,
  SERVICE_DETAILS,
} from '../../utils/index.js';
import { TorrentClient } from '../../utils/torrent.js';
import {
  BuiltinDebridServices,
  PlaybackInfo,
  Torrent,
  NZB,
  TorrentWithSelectedFile,
  NZBWithSelectedFile,
  UnprocessedTorrent,
  ServiceAuth,
  DebridError,
  generatePlaybackUrl,
  TitleMetadata as DebridTitleMetadata,
  metadataStore,
  FileInfo,
} from '../../debrid/index.js';
import { processTorrents, processNZBs } from '../utils/debrid.js';
import { calculateAbsoluteEpisode } from '../utils/general.js';
import { TitleMetadata } from '../torbox-search/source-handlers.js';
import { MetadataService } from '../../metadata/service.js';
import { Logger } from 'winston';
import pLimit from 'p-limit';
import { cleanTitle } from '../../parser/utils.js';
import { NzbDavConfig, NzbDAVService } from '../../debrid/nzbdav.js';
import { AltmountConfig, AltmountService } from '../../debrid/altmount.js';
import { createProxy } from '../../proxy/index.js';
import { formatHours } from '../../formatters/utils.js';

export interface SearchMetadata extends TitleMetadata {
  primaryTitle?: string;
  year?: number;
  imdbId?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | null;
  isAnime?: boolean;
}

export const BaseDebridConfigSchema = z.object({
  services: BuiltinDebridServices,
  tmdbApiKey: z.string().optional(),
  tmdbReadAccessToken: z.string().optional(),
  tvdbApiKey: z.string().optional(),
  cacheAndPlay: CacheAndPlaySchema.optional(),
  cleanupAfterResolve: z.boolean().optional(),
  checkOwned: z.boolean().optional().default(true),
});
export type BaseDebridConfig = z.infer<typeof BaseDebridConfigSchema>;

export abstract class BaseDebridAddon<T extends BaseDebridConfig> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;

  get addonId(): string {
    return `com.${this.name.toLowerCase().replace(/\s/g, '')}.viren070`;
  }

  abstract readonly logger: Logger;

  protected readonly userData: T;
  protected readonly clientIp?: string;

  private static readonly supportedIdTypes: IdType[] = [
    'imdbId',
    'kitsuId',
    'malId',
    'themoviedbId',
    'thetvdbId',
  ];

  constructor(userData: T, configSchema: z.ZodType<T>, clientIp?: string) {
    try {
      this.userData = configSchema.parse(userData);
    } catch (error) {
      throw new Error(
        `Invalid user data: ${formatZodError(error as ZodError)}`
      );
    }

    this.clientIp = clientIp;
  }

  public getManifest(): Manifest {
    return {
      id: this.addonId,
      name: this.name,
      version: this.version,
      types: ['movie', 'series', 'anime'],
      catalogs: [],
      description: `${this.name} addon`,
      resources: [
        {
          name: 'stream',
          types: ['movie', 'series', 'anime'],
          idPrefixes: IdParser.getPrefixes(BaseDebridAddon.supportedIdTypes),
        },
      ],
    };
  }

  public async getStreams(type: string, id: string): Promise<Stream[]> {
    const parsedId = IdParser.parse(id, type);
    const errorStreams: Stream[] = [];
    if (
      !parsedId ||
      !BaseDebridAddon.supportedIdTypes.includes(parsedId.type)
    ) {
      throw new Error(`Unsupported ID: ${id}`);
    }

    this.logger.info(`Handling stream request for ${this.name}`, {
      requestType: type,
      requestId: id,
    });

    let searchMetadata: SearchMetadata;
    try {
      searchMetadata = await this._getSearchMetadata(parsedId, type);
      if (searchMetadata.primaryTitle) {
        searchMetadata.primaryTitle = cleanTitle(searchMetadata.primaryTitle);
        this.logger.debug(
          `Cleaned primary title for ${id}: ${searchMetadata.primaryTitle}`
        );
      }
    } catch (error) {
      this.logger.error(`Failed to get search metadata for ${id}: ${error}`);
      return [
        this._createErrorStream({
          title: `${this.name}`,
          description: 'Failed to get metadata',
        }),
      ];
    }

    const searchPromises = await Promise.allSettled([
      this._searchTorrents(parsedId, searchMetadata),
      this._searchNzbs(parsedId, searchMetadata),
    ]);

    let torrentResults =
      searchPromises[0].status === 'fulfilled' ? searchPromises[0].value : [];
    const nzbResults =
      searchPromises[1].status === 'fulfilled' ? searchPromises[1].value : [];

    if (searchPromises[0].status === 'rejected') {
      errorStreams.push(
        this._createErrorStream({
          title: `${this.name}`,
          description: searchPromises[0].reason.message,
        })
      );
    }
    if (searchPromises[1].status === 'rejected') {
      errorStreams.push(
        this._createErrorStream({
          title: `${this.name}`,
          description: searchPromises[1].reason.message,
        })
      );
    }

    const torrentsToDownload = torrentResults.filter(
      (t) => !t.hash && t.downloadUrl
    );
    torrentResults = torrentResults.filter((t) => t.hash);
    if (torrentsToDownload.length > 0) {
      this.logger.info(
        `Fetching metadata for ${torrentsToDownload.length} torrents`
      );
      const start = Date.now();
      const metadataPromises = torrentsToDownload.map(async (torrent) => {
        try {
          const metadata = await TorrentClient.getMetadata(torrent);
          if (!metadata) {
            return torrent.hash ? (torrent as Torrent) : null;
          }
          return {
            ...torrent,
            hash: metadata.hash,
            sources: metadata.sources,
            files: metadata.files,
          } as Torrent;
        } catch (error) {
          return torrent.hash ? (torrent as Torrent) : null;
        }
      });

      const enrichedResults = (await Promise.all(metadataPromises)).filter(
        (r): r is Torrent => r !== null
      );
      this.logger.info(
        `Got info for ${enrichedResults.length} torrents in ${getTimeTakenSincePoint(start)}`
      );
      torrentResults = [...torrentResults, ...enrichedResults];
    }

    const torrentServices = this.userData.services.filter(
      (s) => !['nzbdav', 'altmount'].includes(s.id) // usenet only services excluded
    );
    const nzbServices = this.userData.services.filter(
      (s) => ['nzbdav', 'altmount', 'torbox', 'stremio_nntp'].includes(s.id) // only keep services that support usenet
    );

    if (torrentServices.length === 0 && torrentResults.length > 0) {
      errorStreams.push(
        this._createErrorStream({
          title: `${this.name}`,
          description: `No torrent debrid services configured to process torrent results.`,
        })
      );
    }
    if (
      nzbServices.length === 0 &&
      nzbResults.length > 0 &&
      !(
        // allow no true nzb service if all have easynewsUrl and easynews is present as service.
        (
          nzbResults.every((nzb) => (nzb.easynewsUrl ? true : false)) &&
          this.userData.services.some((s) => s.id === 'easynews')
        )
      )
    ) {
      errorStreams.push(
        this._createErrorStream({
          title: `${this.name}`,
          description: `No usenet services configured to process NZB results.`,
        })
      );
    }

    const [processedTorrents, processedNzbs] = await Promise.all([
      processTorrents(
        torrentResults as Torrent[],
        torrentServices,
        id,
        searchMetadata,
        this.clientIp,
        this.userData.cleanupAfterResolve
      ),
      processNZBs(
        nzbResults,
        nzbServices.concat(
          this.userData.services.filter((s) => s.id === 'easynews')
        ),
        id,
        searchMetadata,
        this.clientIp,
        this.userData.checkOwned
      ),
    ]);

    let servers: string[] | undefined;
    const encodedNntpServers = this.userData?.services.find(
      (s) => s.id === 'stremio_nntp'
    )?.credential;
    try {
      if (encodedNntpServers) {
        const nntpServers = NNTPServersSchema.parse(
          JSON.parse(
            Buffer.from(encodedNntpServers, 'base64').toString('utf-8')
          )
        );
        // servers - array, a list of strings that each represent a connection to a NNTP (usenet) server (for nzbUrl) in the form of nntp(s)://{user}:{pass}@{nntpDomain}:{nntpPort}/{nntpConnections} (nntps = SSL; nntp = no encryption) (example: nntps://myuser:mypass@news.example.com/4)
        servers = nntpServers.map(
          (s) =>
            `${s.ssl ? 'nntps' : 'nntp'}://${encodeURIComponent(
              s.username
            )}:${encodeURIComponent(s.password)}@${s.host}:${s.port}/${
              s.connections
            }`
        );
      }
    } catch (error) {
      if (error instanceof ZodError) {
        this.logger.error(
          `Failed to parse NNTP servers for Stremio NNTP stream: ${formatZodError(error)}`
        );
      }
      throw error;
    }

    const encryptedStoreAuths = this.userData.services.reduce(
      (acc, service) => {
        const auth = {
          id: service.id,
          credential: service.credential,
        };
        if (service.id === 'stremio_nntp' && servers) {
          acc[service.id] = servers;
        } else {
          acc[service.id] = encryptString(JSON.stringify(auth)).data ?? '';
        }
        return acc;
      },
      {} as Record<BuiltinServiceId, string | string[]>
    );
    const debridTitleMetadata: DebridTitleMetadata = {
      titles: searchMetadata.titles,
      year: searchMetadata.year,
      season: searchMetadata.season,
      episode: searchMetadata.episode,
      absoluteEpisode: searchMetadata.absoluteEpisode,
    };
    const metadataId = getSimpleTextHash(JSON.stringify(debridTitleMetadata));
    await metadataStore().set(
      metadataId,
      debridTitleMetadata,
      Env.BUILTIN_PLAYBACK_LINK_VALIDITY
    );

    const results = [...processedTorrents.results, ...processedNzbs.results];

    // Setup auth for both NzbDAV and Altmount
    let nzbdavAuth: z.infer<typeof NzbDavConfig> | undefined;
    let altmountAuth: z.infer<typeof AltmountConfig> | undefined;

    const encodedNzbdavAuth = this.userData.services.find(
      (s) => s.id === 'nzbdav'
    )?.credential;
    const encodedAltmountAuth = this.userData.services.find(
      (s) => s.id === 'altmount'
    )?.credential;

    if (encodedNzbdavAuth) {
      const { success, data } = NzbDavConfig.safeParse(
        JSON.parse(fromUrlSafeBase64(encodedNzbdavAuth))
      );
      if (success) {
        nzbdavAuth = data;
      }
    }

    if (encodedAltmountAuth) {
      const { success, data } = AltmountConfig.safeParse(
        JSON.parse(fromUrlSafeBase64(encodedAltmountAuth))
      );
      if (success) {
        altmountAuth = data;
      }
    }

    // Collect indices for proxying
    const nzbdavProxyIndices: number[] = [];
    const altmountProxyIndices: number[] = [];

    if (nzbdavAuth && nzbdavAuth.aiostreamsAuth) {
      nzbdavProxyIndices.push(
        ...results
          .map((result, index) => ({ result, index }))
          .filter(({ result }) => result.service?.id === 'nzbdav')
          .map(({ index }) => index)
      );
    }

    if (altmountAuth && altmountAuth.aiostreamsAuth) {
      altmountProxyIndices.push(
        ...results
          .map((result, index) => ({ result, index }))
          .filter(({ result }) => result.service?.id === 'altmount')
          .map(({ index }) => index)
      );
    }

    let resultStreams = await Promise.all(
      results.map((result) => {
        const stream = this._createStream(
          result,
          metadataId,
          encryptedStoreAuths
        );
        if (
          result.service?.id === 'nzbdav' &&
          nzbdavAuth &&
          nzbdavAuth.webdavUser &&
          nzbdavAuth.webdavPassword
        ) {
          stream.behaviorHints = {
            ...stream.behaviorHints,
            notWebReady: true,
            proxyHeaders: {
              request: {
                Authorization: `Basic ${Buffer.from(
                  `${nzbdavAuth.webdavUser}:${nzbdavAuth.webdavPassword}`
                ).toString('base64')}`,
              },
            },
          };
        } else if (result.service?.id === 'altmount' && altmountAuth) {
          stream.behaviorHints = {
            ...stream.behaviorHints,
            notWebReady: true,
            proxyHeaders: {
              request: {
                Authorization: `Basic ${Buffer.from(
                  `${altmountAuth.webdavUser}:${altmountAuth.webdavPassword}`
                ).toString('base64')}`,
              },
            },
          };
        }
        return stream;
      })
    );
    // Proxy NzbDAV streams
    if (nzbdavProxyIndices.length > 0 && nzbdavAuth?.aiostreamsAuth) {
      const proxy = createProxy({
        id: 'builtin',
        enabled: true,
        credentials: nzbdavAuth.aiostreamsAuth,
      });

      const proxiedStreams = await proxy.generateUrls(
        nzbdavProxyIndices
          .map((i) => resultStreams[i])
          .map((stream) => ({
            url: stream.url!,
            filename: stream.behaviorHints?.filename ?? undefined,
            headers:
              nzbdavAuth.webdavUser && nzbdavAuth.webdavPassword
                ? {
                    request: {
                      Authorization: `Basic ${Buffer.from(
                        `${nzbdavAuth.webdavUser}:${nzbdavAuth.webdavPassword}`
                      ).toString('base64')}`,
                    },
                  }
                : undefined,
          }))
      );

      if (proxiedStreams && !('error' in proxiedStreams)) {
        for (let i = 0; i < nzbdavProxyIndices.length; i++) {
          const index = nzbdavProxyIndices[i];
          const proxiedUrl = proxiedStreams[i];
          if (proxiedUrl) {
            resultStreams[index].url = proxiedUrl;
            resultStreams[index].behaviorHints = {
              ...resultStreams[index].behaviorHints,
              notWebReady: undefined,
              proxyHeaders: undefined,
            };
          }
        }
      } else {
        errorStreams.push(
          this._createErrorStream({
            title: `${this.name}`,
            description: `Failed to proxy NzbDAV streams, ensure your proxy auth is correct.`,
          })
        );
        // remove all nzbdav streams
        resultStreams = resultStreams.filter(
          (_, i) => !nzbdavProxyIndices.includes(i)
        );
      }
    }

    // Proxy Altmount streams
    if (altmountProxyIndices.length > 0 && altmountAuth?.aiostreamsAuth) {
      const proxy = createProxy({
        id: 'builtin',
        enabled: true,
        credentials: altmountAuth.aiostreamsAuth,
      });

      const proxiedStreams = await proxy.generateUrls(
        altmountProxyIndices
          .map((i) => resultStreams[i])
          .map((stream) => ({
            url: stream.url!,
            filename: stream.behaviorHints?.filename ?? undefined,
            headers: {
              request: {
                Authorization: `Basic ${Buffer.from(
                  `${altmountAuth.webdavUser}:${altmountAuth.webdavPassword}`
                ).toString('base64')}`,
              },
            },
          }))
      );

      if (proxiedStreams && !('error' in proxiedStreams)) {
        for (let i = 0; i < altmountProxyIndices.length; i++) {
          const index = altmountProxyIndices[i];
          const proxiedUrl = proxiedStreams[i];
          if (proxiedUrl) {
            resultStreams[index].url = proxiedUrl;
            resultStreams[index].behaviorHints = {
              ...resultStreams[index].behaviorHints,
              notWebReady: undefined,
              proxyHeaders: undefined,
            };
          }
        }
      } else {
        errorStreams.push(
          this._createErrorStream({
            title: `${this.name}`,
            description: `Failed to proxy Altmount streams, ensure your proxy auth is correct.`,
          })
        );
        // remove all altmount streams
        resultStreams = resultStreams.filter(
          (_, i) => !altmountProxyIndices.includes(i)
        );
      }
    }

    [...processedTorrents.errors, ...processedNzbs.errors].forEach((error) => {
      let errMsg = error.error.message;
      if (error instanceof DebridError) {
        switch (error.code) {
          case 'UNAUTHORIZED':
            errMsg = 'Invalid Credentials';
        }
      }
      errorStreams.push(
        this._createErrorStream({
          title: `${this.name}`,
          description: `[${constants.SERVICE_DETAILS[error.serviceId].shortName}] ${errMsg}`,
        })
      );
    });

    return [...resultStreams, ...errorStreams];
  }

  protected buildQueries(
    parsedId: ParsedId,
    metadata: SearchMetadata,
    options?: {
      addYear?: boolean;
      addSeasonEpisode?: boolean;
      useAllTitles?: boolean;
    }
  ): string[] {
    const { addYear, addSeasonEpisode, useAllTitles } = {
      addYear: true,
      addSeasonEpisode: true,
      useAllTitles: false,
      ...options,
    };
    let queries: string[] = [];
    if (!metadata.primaryTitle) {
      return [];
    }
    const titles = useAllTitles
      ? metadata.titles.slice(0, Env.BUILTIN_SCRAPE_TITLE_LIMIT).map(cleanTitle)
      : [metadata.primaryTitle];
    const titlePlaceholder = '<___title___>';
    const addQuery = (query: string) => {
      titles.forEach((title) => {
        queries.push(query.replace(titlePlaceholder, title));
      });
    };
    if (parsedId.mediaType === 'movie' && addYear) {
      addQuery(
        `${titlePlaceholder}${metadata.year ? ` ${metadata.year}` : ''}`
      );
    } else if (parsedId.mediaType === 'series' && addSeasonEpisode) {
      if (
        parsedId.season &&
        (parsedId.episode ? Number(parsedId.episode) < 100 : true)
      ) {
        addQuery(
          `${titlePlaceholder} S${parsedId.season!.toString().padStart(2, '0')}`
        );
      }
      if (metadata.absoluteEpisode) {
        addQuery(
          `${titlePlaceholder} ${metadata.absoluteEpisode!.toString().padStart(2, '0')}`
        );
      } else if (parsedId.episode && !parsedId.season) {
        addQuery(
          `${titlePlaceholder} E${parsedId.episode!.toString().padStart(2, '0')}`
        );
      }
      if (parsedId.season && parsedId.episode) {
        addQuery(
          `${titlePlaceholder} S${parsedId.season!.toString().padStart(2, '0')}E${parsedId.episode!.toString().padStart(2, '0')}`
        );
      }
    } else {
      addQuery(titlePlaceholder);
    }
    return queries;
  }

  protected abstract _searchTorrents(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<UnprocessedTorrent[]>;
  protected abstract _searchNzbs(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<NZB[]>;

  protected async _getSearchMetadata(
    parsedId: ParsedId,
    type: string
  ): Promise<SearchMetadata> {
    const start = Date.now();

    const animeEntry = AnimeDatabase.getInstance().getEntryById(
      parsedId.type,
      parsedId.value
    );

    // Update season from anime entry if available
    if (animeEntry && !parsedId.season) {
      parsedId.season =
        animeEntry.imdb?.fromImdbSeason?.toString() ??
        animeEntry.trakt?.season?.number?.toString();
      if (
        animeEntry.imdb?.fromImdbEpisode &&
        animeEntry.imdb?.fromImdbEpisode !== 1 &&
        parsedId.episode &&
        ['malId', 'kitsuId'].includes(parsedId.type)
      ) {
        parsedId.episode = (
          animeEntry.imdb.fromImdbEpisode +
          Number(parsedId.episode) -
          1
        ).toString();
      }
    }

    const metadata = await new MetadataService({
      tmdbAccessToken: this.userData.tmdbReadAccessToken,
      tmdbApiKey: this.userData.tmdbApiKey,
      tvdbApiKey: this.userData.tvdbApiKey,
    }).getMetadata(parsedId, type === 'movie' ? 'movie' : 'series');

    // Calculate absolute episode if needed
    let absoluteEpisode: number | undefined;
    if (animeEntry && parsedId.season && parsedId.episode && metadata.seasons) {
      const seasons = metadata.seasons.map(
        ({ season_number, episode_count }) => ({
          number: season_number.toString(),
          episodes: episode_count,
        })
      );
      this.logger.debug(
        `Calculating absolute episode with current season and episode: ${parsedId.season}, ${parsedId.episode} and seasons: ${JSON.stringify(seasons)}`
      );
      // Calculate base absolute episode
      absoluteEpisode = Number(
        calculateAbsoluteEpisode(parsedId.season, parsedId.episode, seasons)
      );

      // Adjust for non-IMDB episodes if they exist
      if (
        animeEntry?.imdb?.nonImdbEpisodes &&
        absoluteEpisode &&
        parsedId.type === 'imdbId'
      ) {
        const nonImdbEpisodesBefore = animeEntry.imdb.nonImdbEpisodes.filter(
          (ep) => ep < absoluteEpisode!
        ).length;
        if (nonImdbEpisodesBefore > 0) {
          absoluteEpisode += nonImdbEpisodesBefore;
        }
      }
    }

    // // Map IDs
    const imdbId =
      parsedId.type === 'imdbId'
        ? parsedId.value.toString()
        : animeEntry?.mappings?.imdbId?.toString();
    // const tmdbId =
    //   parsedId.type === 'themoviedbId'
    //     ? parsedId.value.toString()
    //     : (animeEntry?.mappings?.themoviedbId?.toString() ?? null);
    // const tvdbId =
    //   parsedId.type === 'thetvdbId'
    //     ? parsedId.value.toString()
    //     : (animeEntry?.mappings?.thetvdbId?.toString() ?? null);

    const searchMetadata: SearchMetadata = {
      primaryTitle: metadata.title,
      titles: metadata.titles ?? [],
      season: parsedId.season ? Number(parsedId.season) : undefined,
      episode: parsedId.episode ? Number(parsedId.episode) : undefined,
      absoluteEpisode,
      year: metadata.year,
      imdbId,
      tmdbId: metadata.tmdbId ?? null,
      tvdbId: metadata.tvdbId ?? null,
      isAnime: animeEntry ? true : false,
    };

    this.logger.debug(
      `Got search metadata for ${parsedId.type}:${parsedId.value} in ${getTimeTakenSincePoint(start)}`,
      {
        ...searchMetadata,
        titles: searchMetadata.titles.length,
      }
    );

    return searchMetadata;
  }

  protected _createStream(
    torrentOrNzb: TorrentWithSelectedFile | NZBWithSelectedFile,
    metadataId: string,
    encryptedStoreAuths: Record<BuiltinServiceId, string | string[]>
  ): Stream {
    // Handle debrid streaming
    const encryptedStoreAuth = torrentOrNzb.service
      ? encryptedStoreAuths?.[torrentOrNzb.service?.id]
      : undefined;

    const fileInfo: FileInfo | undefined = torrentOrNzb.service
      ? torrentOrNzb.type === 'torrent'
        ? {
            type: 'torrent',
            hash: torrentOrNzb.hash,
            sources: torrentOrNzb.sources,
            index: torrentOrNzb.file.index,
            cacheAndPlay:
              this.userData.cacheAndPlay?.enabled &&
              this.userData.cacheAndPlay?.streamTypes?.includes('torrent'),
            cleanupAfterResolve: this.userData.cleanupAfterResolve,
          }
        : {
            type: 'usenet',
            nzb: torrentOrNzb.nzb,
            hash: torrentOrNzb.hash,
            index: torrentOrNzb.file.index,
            easynewsUrl:
              torrentOrNzb.service?.id === 'easynews'
                ? torrentOrNzb.easynewsUrl
                : undefined,
            cacheAndPlay:
              this.userData.cacheAndPlay?.enabled &&
              this.userData.cacheAndPlay?.streamTypes?.includes('usenet'),
            cleanupAfterResolve: this.userData.cleanupAfterResolve,
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

    const name = `[${shortCode} ${cacheIndicator}${torrentOrNzb.service?.library ? ' ☁️' : ''}] ${this.name}`;
    const description = `${torrentOrNzb.title}\n${torrentOrNzb.file.name}\n${
      torrentOrNzb.indexer ? `🔍 ${torrentOrNzb.indexer}` : ''
    } ${'seeders' in torrentOrNzb && torrentOrNzb.seeders ? `👤 ${torrentOrNzb.seeders}` : ''} ${
      torrentOrNzb.age ? `🕒 ${formatHours(torrentOrNzb.age)}` : ''
    }`;

    return {
      url:
        torrentOrNzb.service && torrentOrNzb.service.id != 'stremio_nntp'
          ? generatePlaybackUrl(
              encryptedStoreAuth! as string,
              metadataId!,
              fileInfo!,
              torrentOrNzb.title,
              torrentOrNzb.file.name
            )
          : undefined,
      nzbUrl: torrentOrNzb.type === 'usenet' ? torrentOrNzb.nzb : undefined,
      servers:
        torrentOrNzb.service?.id === 'stremio_nntp'
          ? (encryptedStoreAuth as string[])
          : undefined,
      name,
      description,
      type:
        torrentOrNzb.service?.id === 'stremio_nntp'
          ? 'stremio-usenet'
          : torrentOrNzb.type,
      age: torrentOrNzb.age,
      duration: torrentOrNzb.duration,
      infoHash: torrentOrNzb.hash,
      fileIdx: torrentOrNzb.file.index,
      behaviorHints: {
        videoSize: torrentOrNzb.file.size,
        filename: torrentOrNzb.file.name,
      },
    };
  }

  protected _createErrorStream({
    title,
    description,
  }: {
    title: string;
    description: string;
  }): Stream {
    return {
      name: `[❌] ${title}`,
      description: description,
      externalUrl: 'stremio:///',
    };
  }
}
