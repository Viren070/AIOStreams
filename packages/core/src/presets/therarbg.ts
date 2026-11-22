import { Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';
import {
  mediaTypesOption,
  nameOption,
  servicesOption,
  timeoutOption,
  useMultipleInstancesOption,
} from './options.js';

export class TheRARBGPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      nameOption('TheRARBG'),
      timeoutOption(
        appConfig.builtins.therarbg.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      servicesOption(StremThruPreset.supportedServices),
      mediaTypesOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'therarbg',
      NAME: 'TheRARBG',
      LOGO: '/assets/therarbg_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/therarbg`],
      TIMEOUT:
        appConfig.builtins.therarbg.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'A general-purpose public torrent indexer (movies, TV and anime), inspired by the original RARBG. Searches by title and, when available, by IMDB ID. Serves the same results as TorrentGalaxy, so there is no need to enable both.',
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
    return `${appConfig.bootstrap.internalUrl}/builtins/therarbg/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
