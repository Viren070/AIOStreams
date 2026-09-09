import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import { createLogger } from '../../utils/index.js';
import { Torrent, NZB, UnprocessedTorrent } from '../../debrid/index.js';
import { extractTrackersFromMagnet } from '../utils/debrid.js';
import {
  BaseNabApi,
  Capabilities,
  extractTorznabInfoHash,
} from '../base/nab/api.js';
import {
  BaseNabAddon,
  NabAddonConfigSchema,
  NabAddonConfig,
  parseNabParsedFileInfo,
} from '../base/nab/addon.js';

const logger = createLogger('torznab');

// API client is now just a thin wrapper
class TorznabApi extends BaseNabApi<'torznab'> {
  constructor(baseUrl: string, apiKey?: string, apiPath?: string) {
    super('torznab', logger, baseUrl, apiKey, apiPath);
  }
}

// Addon class
export class TorznabAddon extends BaseNabAddon<NabAddonConfig, TorznabApi> {
  readonly name = 'Torznab';
  readonly version = '1.0.0';
  readonly id = 'torznab';
  readonly logger = logger;
  readonly api: TorznabApi;

  constructor(userData: NabAddonConfig, clientIp?: string) {
    super(userData, NabAddonConfigSchema, clientIp);
    this.api = new TorznabApi(
      this.userData.url,
      this.userData.apiKey,
      this.userData.apiPath
    );
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    const metadata = await this.getSearchMetadata();
    const { results, meta } = await this.performSearch(parsedId, metadata);
    const seenTorrents = new Set<string>();

    const torrents: UnprocessedTorrent[] = [];

    for (const result of results) {
      const infoHash = extractTorznabInfoHash(result);
      const downloadUrl = result.enclosure.find(
        (e: any) =>
          e.type === 'application/x-bittorrent' && !e.url.includes('magnet:')
      )?.url;

      if (!infoHash && !downloadUrl) continue;
      if (seenTorrents.has(infoHash ?? downloadUrl!)) continue;
      seenTorrents.add(infoHash ?? downloadUrl!);

      const parsedMediaInfo = parseNabParsedFileInfo({
        audioLanguages: result.torznab?.language,
        subtitleLanguages: result.torznab?.subs,
      });

      torrents.push({
        confirmed: meta.searchType === 'id',
        hash: infoHash,
        guid: result.guid,
        downloadUrl,
        sources: result.torznab?.magneturl?.toString()
          ? extractTrackersFromMagnet(result.torznab.magneturl.toString())
          : [],
        seeders:
          typeof result.torznab?.seeders === 'number' &&
          ![-1, 999].includes(result.torznab.seeders)
            ? result.torznab.seeders
            : undefined,
        downloadvolumefactor:
          typeof result.torznab?.downloadvolumefactor === 'number'
            ? result.torznab.downloadvolumefactor
            : undefined,
        indexer:
          result.prowlarrindexer?.name ??
          result.jackettindexer?.name ??
          undefined,
        title: result.title,
        size:
          result.size ??
          (result.torznab?.size ? Number(result.torznab.size) : 0),
        type: 'torrent',
        private:
          typeof result?.type === 'string'
            ? result?.type === 'private'
            : undefined,
        parsedMediaInfo,
      });
    }

    return torrents;
  }

  protected async _searchNzbs(_parsedId: ParsedId): Promise<NZB[]> {
    // This addon does not support NZBs, so we return an empty array.
    return [];
  }
}
