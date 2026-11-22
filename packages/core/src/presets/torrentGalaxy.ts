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

export class TorrentGalaxyPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      nameOption('TorrentGalaxy'),
      timeoutOption(
        appConfig.builtins.torrentGalaxy.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      servicesOption(StremThruPreset.supportedServices),
      mediaTypesOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'torrent-galaxy',
      NAME: 'TorrentGalaxy',
      LOGO: '',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/torrent-galaxy`],
      TIMEOUT:
        appConfig.builtins.torrentGalaxy.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'A public torrent indexer for movies, TV and anime. Searches by title and, when available, by IMDB ID. Serves the same results as TheRARBG, so there is no need to enable both.',
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
    return `${appConfig.bootstrap.internalUrl}/builtins/torrent-galaxy/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
