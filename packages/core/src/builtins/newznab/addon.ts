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
const DEFAULT_HEALTH_PROXY_ENDPOINT =
  Env.HEALTH_PROXY_ENDPOINT?.trim() || 'https://zyclops.elfhosted.com';
const DEFAULT_HEALTH_PROXY_PATH = '/api';

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
  healthProxyEnabled: z.boolean().optional(),
  healthProxyEndpoint: z.string().optional(),
  healthProxyPath: z.string().optional(),
  healthProxyTarget: z.string().optional(),
  healthProxyBackbone: z.array(z.string().min(1)).optional(),
  healthProxyProviderHost: z.string().optional(),
  healthProxyShowUnknown: z.boolean().optional(),
  healthProxySingleIp: z.boolean().optional(),
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
    const healthProxyConfig = this.buildHealthProxyConfig();
    this.api = new NewznabApi(
      healthProxyConfig?.endpoint ?? this.userData.url,
      this.userData.apiKey,
      healthProxyConfig?.path ?? this.userData.apiPath,
      healthProxyConfig?.extraParams
    );
  }

  private buildHealthProxyConfig(): HealthProxyConfig | undefined {
    if (!this.userData.healthProxyEnabled) {
      return undefined;
    }

    const endpointInput =
      typeof this.userData.healthProxyEndpoint === 'string'
        ? this.userData.healthProxyEndpoint.trim()
        : '';
    const endpoint = endpointInput || DEFAULT_HEALTH_PROXY_ENDPOINT;
    if (!endpoint) {
      this.logger.warn(
        'Crowdsourced health checks are enabled for Newznab but no proxy endpoint was provided.'
      );
      return undefined;
    }

    const pathInput =
      typeof this.userData.healthProxyPath === 'string'
        ? this.userData.healthProxyPath.trim()
        : '';
    const path = pathInput || DEFAULT_HEALTH_PROXY_PATH;
    const extraParams: Record<string, string | number | boolean> = {};

    const resolveApiPath = (value?: string) => {
      const raw = typeof value === 'string' ? value.trim() : '';
      const withoutTrailing = raw.replace(/\/+$/, '');
      if (!withoutTrailing) {
        return '/api';
      }
      return withoutTrailing.startsWith('/')
        ? withoutTrailing
        : `/${withoutTrailing}`;
    };

    const upstreamBase =
      typeof this.userData.url === 'string'
        ? this.userData.url.trim().replace(/\/+$/, '')
        : '';
    const upstreamApiPath = resolveApiPath(this.userData.apiPath);
    const fallbackTarget = upstreamBase
      ? `${upstreamBase}${upstreamApiPath}`
      : this.userData.url;

    const target =
      (typeof this.userData.healthProxyTarget === 'string'
        ? this.userData.healthProxyTarget.trim()
        : '') || fallbackTarget;
    extraParams.target = target;

    const setBooleanParam = (key: string, value?: boolean) => {
      if (typeof value === 'boolean') {
        extraParams[key] = value ? '1' : '0';
      }
    };

    const selectedBackbones = (this.userData.healthProxyBackbone || [])
      .map((backbone) => backbone?.trim())
      .filter((backbone): backbone is string => Boolean(backbone));
    const userProviderHosts = (this.userData.healthProxyProviderHost || '')
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0);

    const hasBackbone = selectedBackbones.length > 0;
    let providerHosts: string[] = [];

    if (userProviderHosts.length > 0) {
      providerHosts = userProviderHosts;
    }

    const hasProviderHost = providerHosts.length > 0;

    if (hasBackbone && hasProviderHost && userProviderHosts.length > 0) {
      throw new Error(
        'Crowdsourced health checks only accept one identifier. Choose either a backbone selection or a provider host.'
      );
    }

    if (!hasBackbone && !hasProviderHost) {
      throw new Error(
        'Crowdsourced health checks require either a backbone selection or a provider host to be configured.'
      );
    }

    if (hasBackbone) {
      extraParams.backbone = selectedBackbones.join(',');
    } else if (hasProviderHost) {
      extraParams.provider_host = providerHosts.join(',');
    }

    setBooleanParam('show_unknown', this.userData.healthProxyShowUnknown);
    setBooleanParam('single_ip', this.userData.healthProxySingleIp);

    this.logger.info('Routing Newznab traffic through health proxy', {
      endpoint,
      target,
      mode: hasBackbone ? 'backbone' : 'provider_host',
      identifier: hasBackbone ? selectedBackbones : providerHosts,
    });

    return {
      endpoint: endpoint.replace(/\/$/, ''),
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
