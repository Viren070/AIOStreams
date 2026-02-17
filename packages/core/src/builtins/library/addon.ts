import { BaseDebridAddon, BaseDebridConfigSchema } from '../base/debrid.js';
import { z } from 'zod';
import { createLogger, ParsedId, BuiltinServiceId } from '../../utils/index.js';
import { NZB, UnprocessedTorrent, DebridFile } from '../../debrid/index.js';
import { Manifest, Meta, MetaPreview, Stream } from '../../db/schemas.js';

// Sub-modules
import {
  LIBRARY_ID_PREFIX,
  buildIdPrefixes,
  buildCatalogs,
  fetchCatalog,
  parseExtras,
} from './catalog.js';
import { parseLibraryId, fetchItem, buildMeta } from './meta.js';
import { createLibraryStream } from './streams.js';
import { searchTorrents, searchNzbs } from './matching.js';

const logger = createLogger('library');

export const LibraryAddonConfigSchema = BaseDebridConfigSchema.extend({
  sources: z.array(z.enum(['torrent', 'nzb'])).optional(),
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
    const catalogs = buildCatalogs(
      this.userData.services,
      this.userData.sources
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

    const { skip, sort, sortDirection } = parseExtras(extras);
    return fetchCatalog(
      serviceId,
      service.credential,
      this.clientIp,
      skip,
      sort,
      sortDirection,
      this.userData.sources
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

    const item = await fetchItem(
      serviceId,
      service.credential,
      itemType,
      itemId,
      this.clientIp
    );

    return buildMeta(id, item, service, itemType);
  }

  /**
   * Override getStreams to handle both normal stream requests (imdb/kitsu/etc IDs)
   * and library catalog stream requests (${LIBRARY_ID_PREFIX}* IDs).
   *
   * For library IDs, the format is:
   *   ${LIBRARY_ID_PREFIX}<serviceId>.<itemType>.<itemId>:<fileIdentifier>
   * where fileIdentifier is either 'default' (whole item) or a file index number.
   */
  public override async getStreams(
    type: string,
    id: string
  ): Promise<Stream[]> {
    if (!id.startsWith(LIBRARY_ID_PREFIX)) {
      return super.getStreams(type, id);
    }

    // Library catalog stream request
    const lastColon = id.lastIndexOf(':');
    if (lastColon === -1) {
      throw new Error(`Invalid library stream ID: ${id}`);
    }

    const metaId = id.substring(0, lastColon);
    const fileIdentifier = id.substring(lastColon + 1);

    const { serviceId, itemType, itemId } = parseLibraryId(metaId);

    const service = this.userData.services.find((s) => s.id === serviceId);
    if (!service) {
      logger.warn(
        `Received stream request for ${serviceId} but it is not configured`
      );
      return [];
    }

    const item = await fetchItem(
      serviceId,
      service.credential,
      itemType,
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

    return [createLibraryStream(item, service, itemType, fileIndex, file)];
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
