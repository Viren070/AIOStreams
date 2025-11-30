import { NewznabPreset } from './newznab.js';
import { constants, ServiceId } from '../utils/index.js';
import { Option, UserData } from '../db/index.js';
import { Env } from '../utils/index.js';

export class NZBHydraPreset extends NewznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const supportedServices = [
      constants.TORBOX_SERVICE,
      constants.NZBDAV_SERVICE,
      constants.ALTMOUNT_SERVICE,
      constants.STREMIO_NNTP_SERVICE,
    ] as ServiceId[];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'NZBHydra',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        default: Env.BUILTIN_DEFAULT_NZBHYDRA_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
          forceInUi: false,
        },
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
        default: [],
      },

      ...(Env.BUILTIN_NZBHYDRA_URL && Env.BUILTIN_NZBHYDRA_API_KEY
        ? [
            {
              id: 'notRequiredNote',
              name: '',
              description:
                'This instance has a preconfigured NZBHydra instance. You do not need to set the NZBHydra URL and API Key below. ',
              type: 'alert',
              intent: 'info',
            } as const,
          ]
        : []),
      {
        id: 'nzbhydraUrl',
        name: 'NZBHydra URL',
        description: 'Provide the URL to the NZBHydra endpoint ',
        type: 'url',
        required: !Env.BUILTIN_NZBHYDRA_URL || !Env.BUILTIN_NZBHYDRA_API_KEY,
      },
      {
        id: 'nzbhydraApiKey',
        name: 'API Key',
        description:
          'The password for the NZBHydra API. This is used to authenticate with the NZBHydra endpoint.',
        type: 'password',
        required: !Env.BUILTIN_NZBHYDRA_URL || !Env.BUILTIN_NZBHYDRA_API_KEY,
      },
      {
        id: 'searchMode',
        name: 'Search Mode',
        description:
          'The search mode to use when querying the Torznab endpoint. **Note**: `Both` will result in two addons being created, one for each search mode.',
        type: 'select',
        required: false,
        showInSimpleMode: false,
        default: 'query',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Forced Query', value: 'query' },
          { label: 'Both', value: 'both' },
        ],
      },
      {
        id: 'paginate',
        name: 'Paginate Results',
        description:
          'Enabling this option will make the addon paginate through all available results to provide a more comprehensive set of results. Enabling this can increase the time taken to return results, some endpoints may not support pagination, and this will also increase the number of requests.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'checkOwned',
        name: 'Check Owned NZBs',
        description:
          'When searching for NZBs, check if the NZB is already owned (in your library) and mark it as such if so. Note: only applies to nzbDAV/Altmount.',
        type: 'boolean',
        default: true,
        showInSimpleMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'Newznab supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'nzbhydra',
      NAME: 'NZBHydra',
      LOGO: 'https://raw.githubusercontent.com/theotherp/nzbhydra2/refs/heads/master/core/ui-src/img/logo.png',
      URL: `${Env.INTERNAL_URL}/builtins/newznab`,
      TIMEOUT: Env.BUILTIN_DEFAULT_NZBHYDRA_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
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

    if (options.nzbhydraUrl || options.nzbhydraApiKey) {
      nzbhydraUrl = options.nzbhydraUrl;
      nzbhydraApiKey = options.nzbhydraApiKey;
    } else {
      nzbhydraUrl = Env.BUILTIN_NZBHYDRA_URL;
      nzbhydraApiKey = Env.BUILTIN_NZBHYDRA_API_KEY;
    }

    if (!nzbhydraUrl || !nzbhydraApiKey) {
      throw new Error('NZBHydra URL and API Key are required');
    }

    const config = {
      ...this.getBaseConfig(userData, services),
      url: nzbhydraUrl,
      apiPath: options.apiPath,
      apiKey: nzbhydraApiKey,
      forceQuerySearch: options.forceQuerySearch ?? true,
      forceInitialLimit: 10000,
      checkOwned: options.checkOwned ?? true,
      paginate: false,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.METADATA.URL}/${configString}/manifest.json`;
  }
}
