import { BaseDebridAddon, BaseDebridConfigSchema } from '../base/debrid.js';
import { z } from 'zod';
import {
  createLogger,
  ParsedId,
  IdParser,
  BuiltinServiceId,
  constants,
  encryptString,
  Env,
  getSimpleTextHash,
} from '../../utils/index.js';
import {
  NZB,
  UnprocessedTorrent,
  DebridFile,
  generatePlaybackUrl,
  FileInfo,
  metadataStore,
  TitleMetadata,
} from '../../debrid/index.js';
import { Manifest, Meta, MetaPreview, Stream } from '../../db/schemas.js';

// Sub-modules
import {
  LIBRARY_ID_PREFIX,
  buildIdPrefixes,
  buildCatalogs,
  fetchCatalog,
  parseExtras,
  preWarmLibraryCaches,
  refreshLibraryCacheForService,
} from './catalog.js';
import { parseLibraryId, fetchItem, buildMeta } from './meta.js';
import { createLibraryStream, createRefreshStream } from './streams.js';
import { searchTorrents, searchNzbs } from './matching.js';
import { cleanTitle } from '../../parser/utils.js';

const logger = createLogger('library');

export const LibraryAddonConfigSchema = BaseDebridConfigSchema.extend({
  sources: z.array(z.enum(['torrent', 'nzb'])).optional(),
  skipProcessing: z.boolean().optional(),
  showRefreshActions: z.array(z.enum(['catalog', 'stream'])).optional(),
});
export type LibraryAddonConfig = z.infer<typeof LibraryAddonConfigSchema>;

export class LibraryAddon extends BaseDebridAddon<LibraryAddonConfig> {
  readonly id = 'library';
  readonly name = 'Library';
  readonly version = '1.0.0';
  readonly logger = logger;

  constructor(userData: LibraryAddonConfig, clientIp?: string) {
    super(userData, LibraryAddonConfigSchema, clientIp);
  }

  public override getManifest(): Manifest {
    const baseManifest = super.getManifest();

    const showRefresh = this.userData.showRefreshActions ?? ['catalog'];
    const catalogs = buildCatalogs(
      this.userData.services,
      this.userData.sources,
      showRefresh
    );
    const idPrefixes = buildIdPrefixes(this.userData.services);

    return {
      ...baseManifest,
      catalogs,
      resources: [
        {
          name: 'stream',
          types: ['movie', 'series', 'library', 'other'],
          idPrefixes: [
            ...baseManifest.resources
              .filter(
                (r): r is Exclude<typeof r, string> => typeof r !== 'string'
              )
              .flatMap((r) => r.idPrefixes ?? []),
            ...idPrefixes,
          ],
        },
        ...(catalogs.length > 0
          ? [
              {
                name: 'catalog' as const,
                types: ['library'],
                idPrefixes: [LIBRARY_ID_PREFIX],
              },
              {
                name: 'meta' as const,
                types: ['library'],
                idPrefixes,
              },
            ]
          : []),
      ],
      types: [...baseManifest.types!, 'library'],
    };
  }

  public async getCatalog(
    type: string,
    catalogId: string,
    extras?: string
  ): Promise<MetaPreview[]> {
    if (!catalogId.startsWith(LIBRARY_ID_PREFIX)) {
      throw new Error(`Unsupported catalog: ${catalogId}`);
    }

    const serviceId = catalogId.replace(
      LIBRARY_ID_PREFIX,
      ''
    ) as BuiltinServiceId;
    const service = this.userData.services.find((s) => s.id === serviceId);
    if (!service) {
      logger.warn(
        `Received catalog request for ${serviceId} but it is not configured`
      );
      return [];
    }

    const { skip, sort, sortDirection, genre, search } = parseExtras(extras);
    return fetchCatalog(
      serviceId,
      service.credential,
      this.clientIp,
      this.userData.sources ?? [],
      skip,
      sort,
      sortDirection,
      genre,
      search
    );
  }

  public async getMeta(type: string, id: string): Promise<Meta> {
    const { serviceId, itemType, itemId } = parseLibraryId(id);

    const service = this.userData.services.find((s) => s.id === serviceId);
    if (!service) {
      logger.warn(
        `Received meta request for ${serviceId} but it is not configured`
      );
      return {
        id,
        name: 'Unknown',
        type: 'library',
        description: 'Service not configured',
        posterShape: 'landscape',
        videos: [],
        behaviorHints: {},
      };
    }

    // Handle action items
    if (itemType === 'action') {
      if (itemId === 'refresh') {
        logger.info(`Refreshing library cache for ${serviceId}`);
        try {
          await refreshLibraryCacheForService(
            serviceId,
            service.credential,
            this.clientIp,
            this.userData.sources
          );
          return {
            id,
            name: '✅ Library Refreshed',
            type: 'library',
            description: `The library cache for ${constants.SERVICE_DETAILS[serviceId].name} has been refreshed successfully. Go back to the catalog to see the updated list.`,
            posterShape: 'landscape',
            videos: [],
            behaviorHints: {},
          };
        } catch (error: any) {
          logger.error(
            `Failed to refresh library cache for ${serviceId}`,
            error
          );
          return {
            id,
            name: '❌ Refresh Failed',
            type: 'library',
            description: `Failed to refresh the library cache: ${error?.message ?? 'Unknown error'}. Please try again later.`,
            posterShape: 'landscape',
            videos: [],
            behaviorHints: {},
          };
        }
      }
      // Unknown action
      return {
        id,
        name: 'Unknown Action',
        type: 'library',
        description: 'This action is not recognized.',
        posterShape: 'landscape',
        videos: [],
        behaviorHints: {},
      };
    }

    const narrowedItemType: 'torrent' | 'usenet' = itemType;

    const item = await fetchItem(
      serviceId,
      service.credential,
      narrowedItemType,
      itemId,
      this.clientIp
    );

    return buildMeta(id, item, service, narrowedItemType);
  }

  /**
   * Override getStreams to handle both normal stream requests (imdb/kitsu/etc IDs)
   * and library catalog stream requests (${LIBRARY_ID_PREFIX}* IDs).
   *
   * For library IDs, the format is:
   *   ${LIBRARY_ID_PREFIX}<serviceId>.<itemType>.<itemId>:<fileIdentifier>
   * where fileIdentifier is either 'default' (whole item) or a file index number.
   *
   * When skipProcessing is enabled, normal stream requests bypass
   * processTorrents/processNZBs and create streams directly from
   * library search results, treating everything as cached.
   */
  public override async getStreams(
    type: string,
    id: string
  ): Promise<Stream[]> {
    if (!id.startsWith(LIBRARY_ID_PREFIX)) {
      if (this.userData.skipProcessing) {
        return this._getStreamsSkipProcessing(type, id);
      }
      const streams = await super.getStreams(type, id);

      // Append refresh stream action if configured
      const showRefresh = this.userData.showRefreshActions ?? ['catalog'];
      if (showRefresh.includes('stream')) {
        for (const service of this.userData.services) {
          streams.push(
            createRefreshStream(
              service.id,
              service.credential,
              this.userData.sources
            )
          );
        }
      }

      return streams;
    }

    // Library catalog stream request
    // Find the file identifier separator colon AFTER the prefix
    // (the prefix itself contains '::' which must be skipped)
    const colonAfterPrefix = id.indexOf(':', LIBRARY_ID_PREFIX.length);
    if (colonAfterPrefix === -1) {
      // No file identifier — could be an action item
      const { itemType } = parseLibraryId(id);
      if (itemType === 'action') {
        return [];
      }
      throw new Error(`Invalid library stream ID: ${id}`);
    }

    const metaId = id.substring(0, colonAfterPrefix);
    const fileIdentifier = id.substring(colonAfterPrefix + 1);

    const { serviceId, itemType, itemId } = parseLibraryId(metaId);

    const service = this.userData.services.find((s) => s.id === serviceId);
    if (!service) {
      logger.warn(
        `Received stream request for ${serviceId} but it is not configured`
      );
      return [];
    }

    // Action items don't have streams
    if (itemType === 'action') {
      return [];
    }

    const narrowedItemType: 'torrent' | 'usenet' = itemType;

    const item = await fetchItem(
      serviceId,
      service.credential,
      narrowedItemType,
      itemId,
      this.clientIp
    );

    // Determine which file to resolve
    let file: DebridFile | undefined;
    let fileIndex: number | undefined;

    if (fileIdentifier !== 'default') {
      const parsedIndex = parseInt(fileIdentifier, 10);
      if (!isNaN(parsedIndex)) {
        file = item.files?.find((f: DebridFile) => f.index === parsedIndex);
        fileIndex = parsedIndex;
      } else {
        file = item.files?.find((f: DebridFile) => f.name === fileIdentifier);
        fileIndex = file?.index;
      }
    }

    return [
      createLibraryStream(item, service, narrowedItemType, fileIndex, file),
    ];
  }

  /**
   * Skip processing mode: search library for matches but bypass
   * processTorrents/processNZBs entirely. Creates streams directly
   * from library results, marking everything as cached/library.
   */
  private async _getStreamsSkipProcessing(
    type: string,
    id: string
  ): Promise<Stream[]> {
    const parsedId = IdParser.parse(id, type);
    if (!parsedId) {
      throw new Error(`Unsupported ID: ${id}`);
    }

    this.logger.info(`Handling stream request (skip processing) for ${id}`);

    this._searchMetadataPromise = this._getSearchMetadata(parsedId, type).then(
      (metadata) => {
        if (metadata.primaryTitle) {
          metadata.primaryTitle = cleanTitle(metadata.primaryTitle);
        }
        return metadata;
      }
    );

    const [torrentResults, nzbResults] = await Promise.allSettled([
      this._searchTorrents(parsedId),
      this._searchNzbs(parsedId),
    ]);

    const torrents =
      torrentResults.status === 'fulfilled' ? torrentResults.value : [];
    const nzbs = nzbResults.status === 'fulfilled' ? nzbResults.value : [];

    // Build metadata ID for playback URLs
    let metadataId = 'library';
    try {
      const meta = await this.getSearchMetadata();
      const titleMetadata: TitleMetadata = {
        titles: meta.titles,
        year: meta.year,
        seasonYear: meta.seasonYear,
        season: meta.season,
        episode: meta.episode,
        absoluteEpisode: meta.absoluteEpisode,
        relativeAbsoluteEpisode: meta.relativeAbsoluteEpisode,
      };
      metadataId = getSimpleTextHash(JSON.stringify(titleMetadata));
      await metadataStore().set(
        metadataId,
        titleMetadata,
        Env.BUILTIN_PLAYBACK_LINK_VALIDITY
      );
    } catch {
      // metadata not critical for skip-processing
    }

    const streams: Stream[] = [];

    const encryptedStoreAuths = this.userData.services.reduce(
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

    for (const torrent of torrents) {
      const serviceId = torrent.indexer as BuiltinServiceId | undefined;
      const service = serviceId
        ? this.userData.services.find((s) => s.id === serviceId)
        : this.userData.services[0];
      if (!service) continue;

      const serviceMeta = constants.SERVICE_DETAILS[service.id];
      const encryptedStoreAuth = encryptedStoreAuths[service.id];

      const fileInfo: FileInfo = {
        type: 'torrent',
        hash: torrent.hash ?? '',
        sources: torrent.sources ?? [],
        cacheAndPlay: false,
        autoRemoveDownloads: false,
      };

      const fileName = torrent.title ?? 'unknown';
      const url = generatePlaybackUrl(
        encryptedStoreAuth,
        metadataId,
        fileInfo,
        fileName
      );

      streams.push({
        url,
        name: `🗃️ [⚡ ${serviceMeta.shortName}] Library `,
        description: torrent.title ?? '',
        type: 'torrent',
        infoHash: torrent.hash,
        behaviorHints: {
          filename: torrent.title,
          videoSize: torrent.size,
        },
      });
    }

    for (const nzb of nzbs) {
      const serviceId = nzb.indexer as BuiltinServiceId | undefined;
      const service = serviceId
        ? this.userData.services.find((s) => s.id === serviceId)
        : this.userData.services[0];
      if (!service) continue;

      const serviceMeta = constants.SERVICE_DETAILS[service.id];
      const encryptedStoreAuth = encryptedStoreAuths[service.id];
      const fileInfo: FileInfo = {
        type: 'usenet',
        hash: nzb.hash ?? nzb.title ?? '',
        nzb: '',
        cacheAndPlay: false,
        autoRemoveDownloads: false,
      };

      const fileName = nzb.title ?? 'unknown';
      const url = generatePlaybackUrl(
        encryptedStoreAuth,
        metadataId,
        fileInfo,
        fileName
      );

      streams.push({
        url,
        name: `🗃️ [⚡ ${serviceMeta.shortName}] Library `,
        description: nzb.title ?? '',
        type: 'usenet',
        behaviorHints: {
          filename: nzb.title,
          videoSize: nzb.size,
        },
      });
    }

    // Add refresh stream action if configured
    const showRefresh = this.userData.showRefreshActions ?? ['catalog'];
    if (showRefresh.includes('stream')) {
      for (const service of this.userData.services) {
        streams.push(
          createRefreshStream(
            service.id,
            service.credential,
            this.userData.sources
          )
        );
      }
    }

    return streams;
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    const sources = this.userData.sources;
    if (sources && sources.length > 0 && !sources.includes('torrent'))
      return [];
    const metadata = await this.getSearchMetadata();
    if (!metadata.primaryTitle) return [];
    return searchTorrents(
      this.userData.services,
      metadata,
      parsedId,
      this.clientIp
    );
  }

  protected async _searchNzbs(parsedId: ParsedId): Promise<NZB[]> {
    const sources = this.userData.sources;
    if (sources && sources.length > 0 && !sources.includes('nzb')) return [];
    const metadata = await this.getSearchMetadata();
    if (!metadata.primaryTitle) return [];
    return searchNzbs(
      this.userData.services,
      metadata,
      parsedId,
      this.clientIp
    );
  }
}
