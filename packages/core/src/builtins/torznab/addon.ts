import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import { createLogger } from '../../utils/index.js';
import { Torrent, NZB, UnprocessedTorrent } from '../../debrid/index.js';
import {
  extractTrackersFromMagnet,
  validateInfoHash,
} from '../utils/debrid.js';
import { BaseNabApi, Capabilities } from '../base/nab/api.js';
import {
  BaseNabAddon,
  NabAddonConfigSchema,
  NabAddonConfig,
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
      const infoHash = this.extractInfoHash(result);
      const downloadUrl = result.enclosure.find(
        (e: any) =>
          e.type === 'application/x-bittorrent' && !e.url.includes('magnet:')
      )?.url;

      if (!infoHash && !downloadUrl) continue;
      if (seenTorrents.has(infoHash ?? downloadUrl!)) continue;
      seenTorrents.add(infoHash ?? downloadUrl!);

      torrents.push({
        confirmed: meta.searchType === 'id',
        hash: infoHash,
        downloadUrl,
        sources: result.torznab?.magneturl?.toString()
          ? extractTrackersFromMagnet(result.torznab.magneturl.toString())
          : [],
        seeders:
          typeof result.torznab?.seeders === 'number' &&
          ![-1, 999].includes(result.torznab.seeders)
            ? result.torznab.seeders
            : undefined,
        indexer: result.jackettindexer?.name ?? undefined,
        title: result.title,
        size:
          result.size ??
          (result.torznab?.size ? Number(result.torznab.size) : 0),
        type: 'torrent',
      });
    }

    return torrents;
  }

  protected async _searchNzbs(_parsedId: ParsedId): Promise<NZB[]> {
    // This addon does not support NZBs, so we return an empty array.
    return [];
  }

  private extractInfoHash(result: any): string | undefined {
    return validateInfoHash(
      result.torznab?.infohash?.toString() ||
        (
          result.torznab?.magneturl ||
          result.enclosure.find(
            (e: any) =>
              e.type === 'application/x-bittorrent' && e.url.includes('magnet:')
          )?.url
        )
          ?.toString()
          ?.match(/(?:urn(?::|%3A)btih(?::|%3A))([a-f0-9]{40})/i)?.[1]
    );
  }
}
