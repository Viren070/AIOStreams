import { Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';
import {
  mediaTypesOption,
  nameOption,
  preconfiguredInstanceNote,
  servicesOption,
  timeoutOption,
  useMultipleInstancesOption,
} from './options.js';

export class JackettPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'aggregateNote',
        name: '',
        description:
          "Uses Jackett's combined `all` indexer: one slow indexer delays every result, and only title search is possible. For better results, add each indexer as a Torznab addon using its URL from Jackett: `http://<jackett>/api/v2.0/indexers/<indexer>/results/torznab/api`. [More info](https://github.com/Jackett/Jackett#aggregate-indexers)",
        type: 'alert',
        intent: 'info',
      },
      nameOption('Jackett'),
      timeoutOption(
        appConfig.builtins.jackett.timeout ?? appConfig.presets.defaultTimeout
      ),
      servicesOption(StremThruPreset.supportedServices),
      ...preconfiguredInstanceNote(
        'Jackett',
        !!(appConfig.builtins.jackett.url && appConfig.builtins.jackett.apiKey)
      ),
      {
        id: 'jackettUrl',
        name: 'Jackett URL',
        description: 'The URL of the Jackett instance',
        type: 'url',
        required:
          !appConfig.builtins.jackett.url || !appConfig.builtins.jackett.apiKey,
        showInSimpleMode:
          appConfig.builtins.jackett.url && appConfig.builtins.jackett.apiKey
            ? false
            : undefined,
      },
      {
        id: 'jackettApiKey',
        name: 'Jackett API Key',
        description: 'The API key for the Jackett instance',
        type: 'password',
        required:
          !appConfig.builtins.jackett.url || !appConfig.builtins.jackett.apiKey,
        showInSimpleMode:
          appConfig.builtins.jackett.url && appConfig.builtins.jackett.apiKey
            ? false
            : undefined,
      },
      mediaTypesOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'jackett',
      NAME: 'Jackett',
      LOGO: 'https://raw.githubusercontent.com/Jackett/Jackett/refs/heads/master/src/Jackett.Common/Content/jacket_medium.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/torznab`],
      TIMEOUT:
        appConfig.builtins.jackett.timeout ?? appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION: 'An addon to get debrid results from a Jackett instance.',
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
    let jackettUrl = undefined;
    let jackettApiKey = undefined;

    if (options.jackettUrl || options.jackettApiKey) {
      jackettUrl = options.jackettUrl;
      jackettApiKey = options.jackettApiKey;
    } else {
      jackettUrl = appConfig.builtins.jackett.url;
      jackettApiKey = appConfig.builtins.jackett.apiKey;
    }

    if (!jackettUrl || !jackettApiKey) {
      throw new Error('Jackett URL and API Key are required');
    }

    const config = {
      ...this.getBaseConfig(userData, services),
      url: `${jackettUrl.replace(/\/$/, '')}/api/v2.0/indexers/all/results/torznab`,
      apiPath: '/api',
      apiKey: jackettApiKey,
      forceQuerySearch: true,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${appConfig.bootstrap.internalUrl}/builtins/torznab/${configString}/manifest.json`;
  }
}
