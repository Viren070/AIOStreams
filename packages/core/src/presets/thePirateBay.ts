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

export class ThePirateBayPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      nameOption('The Pirate Bay'),
      timeoutOption(
        appConfig.builtins.thePirateBay.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      servicesOption(StremThruPreset.supportedServices),
      mediaTypesOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'the-pirate-bay',
      NAME: 'The Pirate Bay',
      LOGO: '/assets/the-pirate-bay_logo.jpg',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/the-pirate-bay`],
      TIMEOUT:
        appConfig.builtins.thePirateBay.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'A general-purpose public torrent indexer (movies, TV and anime), via the apibay.org API. Searches by title and, when available, by IMDB ID.',
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
    return `${appConfig.bootstrap.internalUrl}/builtins/the-pirate-bay/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
