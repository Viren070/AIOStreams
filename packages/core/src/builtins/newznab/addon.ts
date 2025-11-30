import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import { constants, createLogger, Env } from '../../utils/index.js';
import { Torrent, NZB } from '../../debrid/index.js';
import { SearchMetadata } from '../base/debrid.js';
import { createHash } from 'crypto';
import { BaseNabApi, SearchResultItem } from '../base/nab/api.js';
import {
  BaseNabAddon,
  NabAddonConfigSchema,
  NabAddonConfig,
} from '../base/nab/addon.js';
import { BuiltinProxy, createProxy } from '../../proxy/index.js';

const logger = createLogger('newznab');

class NewznabApi extends BaseNabApi<'newznab'> {
  constructor(baseUrl: string, apiKey?: string, apiPath?: string) {
    super('newznab', logger, baseUrl, apiKey, apiPath);
  }
}

export const NewznabAddonConfigSchema = NabAddonConfigSchema.extend({
  proxyAuth: z.string().optional(),
});
export type NewznabAddonConfig = z.infer<typeof NewznabAddonConfigSchema>;

// Addon class
export class NewznabAddon extends BaseNabAddon<NewznabAddonConfig, NewznabApi> {
  readonly name = 'Newznab';
  readonly version = '1.0.0';
  readonly id = 'newznab';
  readonly logger = logger;
  readonly api: NewznabApi;
  constructor(userData: NewznabAddonConfig, clientIp?: string) {
    super(userData, NewznabAddonConfigSchema, clientIp);

    if (
      userData.services.some(
        (s) =>
          ![
            constants.TORBOX_SERVICE,
            constants.NZBDAV_SERVICE,
            constants.ALTMOUNT_SERVICE,
            constants.STREMIO_NNTP_SERVICE,
          ].includes(s.id)
      )
    ) {
      throw new Error(
        'The Newznab addon only supports TorBox and NZB DAV services'
      );
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
    const { results, meta } = await this.performSearch(parsedId, metadata);
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
          (1000 * 60 * 60)
      );

      nzbs.push({
        confirmed: meta.searchType === 'id',
        hash: md5,
        nzb: nzbUrl,
        age: age,
        title: result.title,
        indexer: result.newznab?.hydraIndexerName?.toString() ?? undefined,
        size:
          result.size ??
          (result.newznab?.size ? Number(result.newznab.size) : 0),
        type: 'usenet',
      });
    }

    if (this.userData.proxyAuth) {
      try {
        BuiltinProxy.validateAuth(this.userData.proxyAuth);
      } catch (error) {
        throw new Error('Invalid AIOStreams Proxy Auth Credentials');
      }
      const proxy = createProxy({
        id: constants.BUILTIN_SERVICE,
        url: Env.BASE_URL,
        credentials: this.userData.proxyAuth,
      });
      const urlsToProxy = nzbs.map((nzb) => nzb.nzb);
      const proxiedUrls = await proxy.generateUrls(
        urlsToProxy.map((url) => ({
          url,
          filename: url.split('/').pop(),
        })),
        false // don't encrypt NZB URLs to make sure the URLs stay the same.
      );
      if (!proxiedUrls) {
        throw new Error('Failed to proxy NZBs');
      }
      for (let i = 0; i < nzbs.length; i++) {
        nzbs[i].nzb = proxiedUrls[i];
        nzbs[i].hash = createHash('md5').update(nzbs[i].nzb).digest('hex');
      }
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
