import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import { constants, createLogger } from '../../utils/index.js';
import { Torrent, NZB } from '../../debrid/index.js';
import { SearchMetadata } from '../base/debrid.js';
import { createHash } from 'crypto';
import { BaseNabApi, SearchResultItem } from '../base/nab/api.js';
import {
  BaseNabAddon,
  NabAddonConfigSchema,
  NabAddonConfig,
} from '../base/nab/addon.js';

const logger = createLogger('newznab');

class NewznabApi extends BaseNabApi<'newznab'> {
  constructor(baseUrl: string, apiKey?: string, apiPath?: string) {
    super('newznab', logger, baseUrl, apiKey, apiPath);
  }
}

// Addon class
export class NewznabAddon extends BaseNabAddon<NabAddonConfig, NewznabApi> {
  readonly name = 'Newznab';
  readonly version = '1.0.0';
  readonly id = 'newznab';
  readonly logger = logger;
  readonly api: NewznabApi;
  constructor(userData: NabAddonConfig, clientIp?: string) {
    super(userData, NabAddonConfigSchema, clientIp);
    if (
      !userData.services.find((s) => s.id === constants.TORBOX_SERVICE) ||
      userData.services.length > 1
    ) {
      throw new Error('The Newznab addon only supports TorBox');
    }
    this.api = new NewznabApi(
      this.userData.url,
      this.userData.apiKey,
      this.userData.apiPath
    );
  }

  protected async _searchNzbs(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<NZB[]> {
    const results = await this.performSearch(parsedId, metadata);
    const seenNzbs = new Set<string>();

    const nzbs: NZB[] = [];
    for (const result of results) {
      const nzbUrl = this.getNzbUrl(result);
      if (!nzbUrl) continue;
      if (seenNzbs.has(nzbUrl)) continue;
      seenNzbs.add(nzbUrl);

      const md5 =
        result.newznab?.infohash?.toString() ||
        createHash('md5').update(nzbUrl).digest('hex');
      const age = Math.ceil(
        Math.abs(new Date().getTime() - new Date(result.pubDate).getTime()) /
          (1000 * 60 * 60 * 24)
      );

      nzbs.push({
        hash: md5,
        nzb: nzbUrl,
        age: `${age}d`,
        title: result.title,
        indexer: result.newznab?.hydraIndexerName?.toString() ?? undefined,
        size:
          result.size ??
          (result.newznab?.size ? Number(result.newznab.size) : 0),
        type: 'usenet',
      });
    }
    return nzbs;
  }

  protected async _searchTorrents(
    parsedId: ParsedId,
    metadata: SearchMetadata
  ): Promise<Torrent[]> {
    return [];
  }

  private getNzbUrl(result: any): string | undefined {
    return result.enclosure.find((e: any) => e.type === 'application/x-nzb')
      ?.url;
  }
}
