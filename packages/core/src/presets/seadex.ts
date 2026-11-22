import { Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';
import {
  mediaTypesOption,
  nameOption,
  servicesOption,
  timeoutOption,
} from './options.js';

export class SeaDexPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      nameOption('SeaDex'),
      timeoutOption(),
      servicesOption(StremThruPreset.supportedServices),
      mediaTypesOption(['anime']),
    ];

    return {
      ID: 'seadex',
      NAME: 'SeaDex',
      LOGO: 'https://releases.moe/favicon.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/seadex`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'SeaDex is a curated database of the best anime releases. Get high-quality torrents for anime based on community recommendations.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, any>
  ): string {
    return `${appConfig.bootstrap.internalUrl}/builtins/seadex/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
