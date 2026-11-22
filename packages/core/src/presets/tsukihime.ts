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

export class TsukihimePreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const supportedServices = [
      ...StremThruPreset.supportedServices,
      constants.NZBDAV_SERVICE,
      constants.ALTMOUNT_SERVICE,
      constants.STREMIO_NNTP_SERVICE,
      constants.STREMTHRU_NEWZ_SERVICE,
      constants.AIOSTREAMS_SERVICE,
    ] as constants.ServiceId[];
    const options: Option[] = [
      nameOption('TsukiHime'),
      timeoutOption(
        appConfig.builtins.tsukihime.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      servicesOption(supportedServices),
      mediaTypesOption(['anime']),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'tsukihime',
      NAME: 'TsukiHime',
      LOGO: 'https://tsukihime.org/favicon.svg',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/tsukihime`],
      TIMEOUT:
        appConfig.builtins.tsukihime.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'An anime-only public torrent indexer via the TsukiHime API, resolving releases by MAL/AniDB id with a text-search fallback. Processed releases carry precise audio/subtitle language info extracted from the actual file; skipped or still-processing releases may not have it yet. NZBs for its own uploads are sent to your usenet services; TorBox always gets the torrent.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.DEBRID_STREAM_TYPE,
        constants.USENET_STREAM_TYPE,
      ],
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
    return `${appConfig.bootstrap.internalUrl}/builtins/tsukihime/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
