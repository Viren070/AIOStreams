import { NewznabPreset } from './newznab.js';
import { constants, ServiceId } from '../utils/index.js';
import { Option, UserData } from '../db/index.js';
import { appConfig } from '../utils/index.js';
import {
  initialLimitOption,
  mediaTypesOption,
  nameOption,
  paginateOption,
  preconfiguredInstanceNote,
  proxyAuthOption,
  searchModeOption,
  seasonEpisodeStrategyOption,
  servicesOption,
  timeoutOption,
  useMultipleInstancesOption,
} from './options.js';

export class NZBHydraPreset extends NewznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const supportedServices = [
      constants.TORBOX_SERVICE,
      constants.NZBDAV_SERVICE,
      constants.ALTMOUNT_SERVICE,
      constants.STREMIO_NNTP_SERVICE,
      constants.STREMTHRU_NEWZ_SERVICE,
      constants.AIOSTREAMS_SERVICE,
    ] as ServiceId[];
    const options: Option[] = [
      nameOption('NZBHydra'),
      {
        ...timeoutOption(
          appConfig.builtins.nzbhydra.timeout ??
            appConfig.presets.defaultTimeout
        ),
        required: false,
      },
      servicesOption(supportedServices),
      mediaTypesOption(),
      ...preconfiguredInstanceNote(
        'NZBHydra',
        !!(
          appConfig.builtins.nzbhydra.url && appConfig.builtins.nzbhydra.apiKey
        )
      ),
      {
        id: 'api',
        name: 'NZBHydra Endpoint',
        description: '',
        type: 'nab-endpoint',
        nab: { namespace: 'newznab', preset: 'nzbhydra' },
        required:
          !appConfig.builtins.nzbhydra.url ||
          !appConfig.builtins.nzbhydra.apiKey,
        subOptions: [
          {
            id: 'url',
            name: 'NZBHydra URL',
            description:
              'The base URL of your NZBHydra instance, e.g. `http://localhost:5076`.',
            type: 'url',
            required:
              !appConfig.builtins.nzbhydra.url ||
              !appConfig.builtins.nzbhydra.apiKey,
          },
          {
            id: 'apiKey',
            name: 'API Key',
            description:
              'The password for the NZBHydra API. This is used to authenticate with the NZBHydra endpoint.',
            type: 'password',
            required:
              !appConfig.builtins.nzbhydra.url ||
              !appConfig.builtins.nzbhydra.apiKey,
          },
        ],
      },
      proxyAuthOption(),
      searchModeOption('query'),
      seasonEpisodeStrategyOption(),
      initialLimitOption(250),
      paginateOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'nzbhydra',
      NAME: 'NZBHydra',
      LOGO: 'https://raw.githubusercontent.com/theotherp/nzbhydra2/refs/heads/master/misc/images/favicons/favicon196.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/newznab`],
      TIMEOUT:
        appConfig.builtins.nzbhydra.timeout ?? appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'An addon to get usenet results from a NZBHydra instance.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  protected static generateManifestUrl(
    userData: UserData,
    services: ServiceId[],
    options: Record<string, any>
  ) {
    let nzbhydraUrl = undefined;
    let nzbhydraApiKey = undefined;

    if (options.api?.url || options.api?.apiKey) {
      nzbhydraUrl = options.api.url;
      nzbhydraApiKey = options.api.apiKey;
    } else {
      nzbhydraUrl = appConfig.builtins.nzbhydra.url;
      nzbhydraApiKey = appConfig.builtins.nzbhydra.apiKey;
    }

    if (!nzbhydraUrl || !nzbhydraApiKey) {
      throw new Error('NZBHydra URL and API Key are required');
    }

    const config = {
      ...this.getBaseConfig(userData, services),
      url: nzbhydraUrl,
      // always a base url, since NZBHydra only ever serves its api at /api
      apiPath: '/api',
      apiKey: nzbhydraApiKey,
      proxyAuth: options.proxyAuth,
      forceQuerySearch: options.forceQuerySearch ?? true,
      forceInitialLimit: options.initialLimit ?? 250,
      paginate: options.paginate ?? false,
      seasonEpisodeStrategy: options.seasonEpisodeStrategy ?? 'episode',
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.DEFAULT_URL}/${configString}/manifest.json`;
  }
}
