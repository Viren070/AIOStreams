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

export class KnabenPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      nameOption('Knaben'),
      timeoutOption(
        appConfig.builtins.knaben.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      servicesOption(StremThruPreset.supportedServices),
      mediaTypesOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'knaben',
      NAME: 'Knaben',
      LOGO: '/assets/knaben_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/knaben`],
      TIMEOUT:
        appConfig.builtins.knaben.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'An addon to get debrid results from Knaben, an indexer proxy for several indexers, including The Pirate Bay, 1337x, RARBG, YTS, Nyaa.si and more.',
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
    return `${appConfig.bootstrap.internalUrl}/builtins/knaben/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
