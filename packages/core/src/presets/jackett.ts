import { Option, UserData } from '../db/index.js';
import { Env, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';

export class JackettPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Jackett',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default: Env.BUILTIN_DEFAULT_JACKETT_TIMEOUT || Env.DEFAULT_TIMEOUT,
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
        options: StremThruPreset.supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      ...(Env.BUILTIN_JACKETT_URL && Env.BUILTIN_JACKETT_API_KEY
        ? [
            {
              id: 'notRequiredNote',
              name: '',
              description:
                'This instance has a preconfigured Jackett instance. You do not need to set the Jackett URL and API Key below. ',
              type: 'alert',
              intent: 'info',
              showInSimpleMode: false,
            } as const,
          ]
        : []),
      {
        id: 'jackettUrl',
        name: 'Jackett URL',
        description: 'The URL of the Jackett instance',
        type: 'url',
        required: !Env.BUILTIN_JACKETT_URL || !Env.BUILTIN_JACKETT_API_KEY,
        showInSimpleMode:
          Env.BUILTIN_JACKETT_URL && Env.BUILTIN_JACKETT_API_KEY
            ? false
            : undefined,
      },
      {
        id: 'jackettApiKey',
        name: 'Jackett API Key',
        description: 'The API key for the Jackett instance',
        type: 'password',
        required: !Env.BUILTIN_JACKETT_URL || !Env.BUILTIN_JACKETT_API_KEY,
        showInSimpleMode:
          Env.BUILTIN_JACKETT_URL && Env.BUILTIN_JACKETT_API_KEY
            ? false
            : undefined,
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: [],
        options: [
          {
            label: 'Movie',
            value: 'movie',
          },
          {
            label: 'Series',
            value: 'series',
          },
          {
            label: 'Anime',
            value: 'anime',
          },
        ],
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'Jackett supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'jackett',
      NAME: 'Jackett',
      LOGO: 'https://raw.githubusercontent.com/Jackett/Jackett/refs/heads/master/src/Jackett.Common/Content/jacket_medium.png',
      URL: `${Env.INTERNAL_URL}/builtins/torznab`,
      TIMEOUT: Env.BUILTIN_DEFAULT_JACKETT_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
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
      jackettUrl = Env.BUILTIN_JACKETT_URL;
      jackettApiKey = Env.BUILTIN_JACKETT_API_KEY;
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
    return `${Env.INTERNAL_URL}/builtins/torznab/${configString}/manifest.json`;
  }
}
