import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import { constants, createLogger, Env } from '../../utils/index.js';
import {
  Torrent,
  NZB,
  NZBWithSelectedFile,
  TorrentWithSelectedFile,
} from '../../debrid/index.js';
import { SearchMetadata } from '../base/debrid.js';
import { createHash } from 'crypto';
import { BaseNabApi, SearchResultItem } from '../base/nab/api.js';
import {
  BaseNabAddon,
  NabAddonConfigSchema,
  NabAddonConfig,
} from '../base/nab/addon.js';
import { BuiltinProxy, createProxy } from '../../proxy/index.js';
import type { BuiltinServiceId } from '../../utils/index.js';
import type { Stream } from '../../db/index.js';

const logger = createLogger('newznab');

class NewznabApi extends BaseNabApi<'newznab'> {
  constructor(
    baseUrl: string,
    apiKey?: string,
    apiPath?: string,
    extraParams?: Record<string, string | number | boolean>
  ) {
    super('newznab', logger, baseUrl, apiKey, apiPath, extraParams);
  }
}

export const NewznabAddonConfigSchema = NabAddonConfigSchema.extend({
  proxyAuth: z.string().optional(),
  zyclopsHealthProxy: z
    .object({
      enabled: z.boolean().optional(),
      backbones: z.array(z.string().min(1)).optional(),
      providerHosts: z.array(z.string().min(1)).optional(),
      showUnknown: z.boolean().optional(),
      singleIp: z.boolean().optional(),
    })
    .optional(),
});
export type NewznabAddonConfig = z.infer<typeof NewznabAddonConfigSchema>;

interface HealthProxyConfig {
  endpoint: string;
  path: string;
  extraParams: Record<string, string | number | boolean>;
}

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
        (s: NonNullable<NewznabAddonConfig['services']>[number]) =>
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
    const zyclopsHealthProxyConfig = this.buildZyclopsHealthProxyConfig();
    this.api = new NewznabApi(
      zyclopsHealthProxyConfig?.endpoint ?? this.userData.url,
      this.userData.apiKey,
      zyclopsHealthProxyConfig?.path ?? this.userData.apiPath,
      zyclopsHealthProxyConfig?.extraParams
    );
  }

  private buildZyclopsHealthProxyConfig(): HealthProxyConfig | undefined {
    if (!this.userData.zyclopsHealthProxy?.enabled) {
      return undefined;
    }

    const endpoint = Env.ZYCLOPS_HEALTH_PROXY_ENDPOINT;
    const path = '/api';
    const extraParams: Record<string, string | number | boolean> = {};

    const upstreamBase = this.userData.url.trim().replace(/\/+$/, '');
    const upstreamApiPath = this.userData.apiPath?.startsWith('/')
      ? this.userData.apiPath
      : `/${this.userData.apiPath || 'api'}`;
    const target = upstreamBase
      ? `${upstreamBase}${upstreamApiPath}`
      : this.userData.url;

    extraParams.target = target;

    const selectedBackbones = (
      this.userData.zyclopsHealthProxy.backbones || []
    ).map((backbone) => backbone?.trim());

    let providerHosts: string[] = [];

    if (this.userData.zyclopsHealthProxy?.providerHosts?.length) {
      providerHosts = this.userData.zyclopsHealthProxy.providerHosts;
    }

    if (selectedBackbones.length > 0 && providerHosts.length > 0) {
      throw new Error(
        'Crowdsourced health checks only accept one identifier. Choose either a backbone selection or a provider host.'
      );
    }

    if (!selectedBackbones.length && !providerHosts.length) {
      throw new Error(
        'Crowdsourced health checks require either a backbone selection or a provider host to be configured.'
      );
    }

    if (selectedBackbones.length > 0) {
      extraParams.backbone = selectedBackbones.join(',');
    } else if (providerHosts.length > 0) {
      extraParams.provider_host = providerHosts.join(',');
    }

    extraParams.show_unknown = this.userData.zyclopsHealthProxy.showUnknown
      ? '1'
      : '0';
    extraParams.single_ip = this.userData.zyclopsHealthProxy.singleIp
      ? '1'
      : '0';

    this.logger.debug('Routing Newznab traffic through health proxy', {
      endpoint,
      target,
      mode: selectedBackbones.length > 0 ? 'backbone' : 'provider_host',
      identifier:
        selectedBackbones.length > 0 ? selectedBackbones : providerHosts,
    });

    return {
      endpoint,
      path,
      extraParams,
    };
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

      const zyclopsHealth = result.newznab?.zyclopsHealth?.toString();
      const md5 =
        result.newznab?.infohash?.toString() ||
        createHash('md5').update(nzbUrl).digest('hex');
      const age = Math.ceil(
        Math.abs(new Date().getTime() - new Date(result.pubDate).getTime()) /
          (1000 * 60 * 60)
      );

      const nzb: NZB = {
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
      };

      if (zyclopsHealth) {
        nzb.zyclopsHealth = zyclopsHealth;
      }

      nzbs.push(nzb);
    }

    if (this.userData.proxyAuth || Env.NZB_PROXY_PUBLIC_ENABLED) {
      const auth = this.userData.proxyAuth
        ? this.userData.proxyAuth
        : `${constants.PUBLIC_NZB_PROXY_USERNAME}:${Env.AIOSTREAMS_AUTH.get(
            constants.PUBLIC_NZB_PROXY_USERNAME
          )}`;
      try {
        BuiltinProxy.validateAuth(auth);
      } catch (error) {
        throw new Error('Invalid AIOStreams Proxy Auth Credentials');
      }
      const proxy = createProxy({
        id: constants.BUILTIN_SERVICE,
        url: Env.BASE_URL,
        credentials: auth,
      });
      const nzbsToProxy = nzbs.map((nzb) => ({
        url: nzb.nzb,
        filename: nzb.title,
      }));
      const proxiedUrls = await proxy.generateUrls(
        nzbsToProxy.map(({ url, filename }) => ({
          url,
          filename: filename || url.split('/').pop(),
          type: 'nzb',
        })),
        false // don't encrypt NZB URLs to make sure the URLs stay the same.
      );
      if (!proxiedUrls || 'error' in proxiedUrls) {
        throw new Error('Failed to proxy NZBs: ' + proxiedUrls?.error || '');
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

  protected override _createStream(
    torrentOrNzb: TorrentWithSelectedFile | NZBWithSelectedFile,
    metadataId: string,
    encryptedStoreAuths: Record<BuiltinServiceId, string | string[]>
  ): Stream {
    const stream = super._createStream(
      torrentOrNzb,
      metadataId,
      encryptedStoreAuths
    );

    if (
      torrentOrNzb.type === 'usenet' &&
      'zyclopsHealth' in torrentOrNzb &&
      torrentOrNzb.zyclopsHealth
    ) {
      (stream as Record<string, unknown>).zyclopsHealth =
        torrentOrNzb.zyclopsHealth;
    }

    return stream;
  }

  private getNzbUrl(result: any): string | undefined {
    return result.enclosure.find((e: any) => e.type === 'application/x-nzb')
      ?.url;
  }
}
