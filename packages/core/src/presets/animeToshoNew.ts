import { Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { baseOptions } from './preset.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';
import {
  mediaTypesOption,
  searchModeOption,
  seasonEpisodeStrategyOption,
  servicesOption,
  useMultipleInstancesOption,
} from './options.js';

export class AnimeToshoNewPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'Anime Tosho (New)',
        supportedResources,
        appConfig.builtins.animeToshoNew.timeout ??
          appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url' && option.id !== 'resources'),
      servicesOption(StremThruPreset.supportedServices),
      mediaTypesOption(),
      searchModeOption(),
      seasonEpisodeStrategyOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'anime-tosho-new',
      NAME: 'Anime Tosho (New)',
      LOGO: '/assets/animetosho_logo.png',
      URL: [appConfig.builtins.animeToshoNew.url],
      TIMEOUT:
        appConfig.builtins.animeToshoNew.timeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'An addon to get debrid results from Anime Tosho, mirroring Nyaa.si, TokyoTosho and other anime release sources. One of several community projects that continued after the original Anime Tosho stopped accepting new content.',
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
    const animeToshoNewUrl = this.DEFAULT_URL;

    const config = {
      ...this.getBaseConfig(userData, services),
      url: animeToshoNewUrl,
      apiPath: '/api',
      paginate: false,
      forceQuerySearch: options.forceQuerySearch ?? false,
      seasonEpisodeStrategy: options.seasonEpisodeStrategy ?? 'episode',
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${appConfig.bootstrap.internalUrl}/builtins/torznab/${configString}/manifest.json`;
  }
}
