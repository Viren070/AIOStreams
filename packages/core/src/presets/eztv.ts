import { Addon, Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';
import {
  nameOption,
  servicesOption,
  timeoutOption,
  useMultipleInstancesOption,
} from './options.js';

export class EztvPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      nameOption('EZTV'),
      timeoutOption(
        appConfig.builtins.eztv.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      servicesOption(StremThruPreset.supportedServices),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'eztv',
      NAME: 'EZTV',
      LOGO: '/assets/eztv_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/eztv`],
      TIMEOUT:
        appConfig.builtins.eztv.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'TV series only. Fetches torrents from EZTVx by IMDB ID and filters by season and episode.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  static override async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    // EZTV only has TV series, so skip it for other media types
    return super.generateAddons(userData, {
      ...options,
      mediaTypes: ['series'],
    });
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, unknown>
  ): string {
    return `${appConfig.bootstrap.internalUrl}/builtins/eztv/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
