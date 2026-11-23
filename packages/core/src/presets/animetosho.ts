import { Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { baseOptions } from './preset.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';
import {
  mediaTypesOption,
  servicesOption,
  useMultipleInstancesOption,
} from './options.js';

export class AnimeToshoPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'Anime Tosho (ARCHIVED)',
        supportedResources,
        appConfig.builtins.animetosho.timeout ??
          appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url' && option.id !== 'resources'),
      servicesOption(StremThruPreset.supportedServices),
      mediaTypesOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'animetosho',
      NAME: 'Anime Tosho (ARCHIVED)',
      LOGO: '/assets/animetosho_logo.png',
      URL: [appConfig.builtins.animetosho.url],
      TIMEOUT:
        appConfig.builtins.animetosho.timeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'An addon to get debrid results from Anime Tosho which mirrors most results from Nyaa.si and TokyoTosho. Anime Tosho stopped accepting new content on 2026-05-09, and its feed server is being shut down in October 2026, after which this addon will stop returning results. Several community projects have picked up where it left off, including Anime Tosho (New), AmeNZB, Aninzb and TsukiHime.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, any>
  ): string {
    const animetoshoUrl = this.DEFAULT_URL;

    const config = {
      ...this.getBaseConfig(userData, services),
      url: animetoshoUrl,
      apiPath: '/api',
      paginate: false,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${appConfig.bootstrap.internalUrl}/builtins/torznab/${configString}/manifest.json`;
  }
}
