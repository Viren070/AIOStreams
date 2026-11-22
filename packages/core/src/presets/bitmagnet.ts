import { Addon, Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';
import {
  mediaTypesOption,
  nameOption,
  paginateOption,
  searchModeOption,
  seasonEpisodeStrategyOption,
  servicesOption,
  timeoutOption,
  useMultipleInstancesOption,
} from './options.js';

export class BitmagnetPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      nameOption('Bitmagnet'),
      timeoutOption(
        appConfig.builtins.bitmagnet.timeout ?? appConfig.presets.defaultTimeout
      ),
      mediaTypesOption(),
      servicesOption(StremThruPreset.supportedServices),
      searchModeOption('query'),
      seasonEpisodeStrategyOption(),
      useMultipleInstancesOption(),
      paginateOption(),
    ];

    return {
      ID: 'bitmagnet',
      NAME: 'Bitmagnet',
      LOGO: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/bitmagnet.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/torznab`],
      TIMEOUT:
        appConfig.builtins.bitmagnet.timeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'An addon to get debrid results from Bitmagnet, a self-hosted BitTorrent indexer and DHT crawler.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
      DISABLED: !appConfig.builtins.bitmagnet.url
        ? {
            reason: 'Not configured',
            disabled: true,
          }
        : undefined,
    };
  }

  static override async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    // configs saved before searchMode was exposed always forced query search
    return super.generateAddons(userData, {
      ...options,
      searchMode: options.searchMode ?? 'query',
    });
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, any>
  ): string {
    if (!appConfig.builtins.bitmagnet.url) {
      throw new Error('The Bitmagnet URL is not set');
    }

    const config = {
      ...this.getBaseConfig(userData, services),
      url: `${appConfig.builtins.bitmagnet.url.replace(/\/$/, '')}/torznab`,
      apiPath: '/api',
      forceQuerySearch: options.forceQuerySearch ?? true,
      paginate: options.paginate ?? false,
      seasonEpisodeStrategy: options.seasonEpisodeStrategy ?? 'episode',
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${appConfig.bootstrap.internalUrl}/builtins/torznab/${configString}/manifest.json`;
  }
}
