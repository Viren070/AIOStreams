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

export class ZileanPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'Zilean',
        supportedResources,
        appConfig.builtins.zilean.timeout ?? appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url' && option.id !== 'resources'),
      {
        id: 'url',
        name: 'URL',
        description: 'Optionally override the URL of the Zilean instance',
        type: 'url',
        required: false,
        showInSimpleMode: false,
      },
      mediaTypesOption(),
      servicesOption(StremThruPreset.supportedServices),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'zilean',
      NAME: 'Zilean',
      LOGO: '/assets/zilean_logo.jpg',
      URL: [appConfig.builtins.zilean.url],
      TIMEOUT:
        appConfig.builtins.zilean.timeout ?? appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'An addon to get debrid results from Zilean, a DMM hashlist scraper.',
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
    const zileanUrl = (options.url || this.DEFAULT_URL).replace(/\/$/, '');

    const config = {
      ...this.getBaseConfig(userData, services),
      url: `${zileanUrl}/torznab`,
      apiPath: '/api',
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${appConfig.bootstrap.internalUrl}/builtins/torznab/${configString}/manifest.json`;
  }
}
