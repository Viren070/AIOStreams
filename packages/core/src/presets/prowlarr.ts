import { Addon, DB, Option, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import {
  Env,
  RESOURCES,
  ServiceId,
  constants,
  createLogger,
} from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { BuiltinAddonPreset } from './builtin.js';
import { ProwlarrAddon } from '../builtins/index.js';

export class ProwlarrPreset extends BuiltinAddonPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const supportedServices: ServiceId[] = [
      ...StremThruPreset.supportedServices,
      constants.NZBDAV_SERVICE,
      constants.ALTMOUNT_SERVICE,
      constants.STREMIO_NNTP_SERVICE,
      constants.STREMTHRU_NEWZ_SERVICE,
    ];
    const options: Option[] = [
      ...(Env.BUILTIN_PROWLARR_URL && Env.BUILTIN_PROWLARR_API_KEY
        ? [
            {
              id: 'notRequiredNote',
              name: '',
              description:
                'This instance has a preconfigured Prowlarr instance. You do not need to set the Prowlarr URL and API Key below. ',
              type: 'alert',
              intent: 'info',
              showInSimpleMode: false,
            } as const,
          ]
        : []),
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Prowlarr',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        default: Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
          forceInUi: false,
        },
      },
      {
        id: 'prowlarrUrl',
        name: 'Prowlarr URL',
        description: 'The URL of the Prowlarr instance',
        type: 'url',
        required: !Env.BUILTIN_PROWLARR_URL || !Env.BUILTIN_PROWLARR_API_KEY,
        showInSimpleMode:
          Env.BUILTIN_PROWLARR_URL && Env.BUILTIN_PROWLARR_API_KEY
            ? false
            : undefined,
      },
      {
        id: 'prowlarrApiKey',
        name: 'Prowlarr API Key',
        description: 'The API key for the Prowlarr instance',
        type: 'password',
        required: !Env.BUILTIN_PROWLARR_URL || !Env.BUILTIN_PROWLARR_API_KEY,
        showInSimpleMode:
          Env.BUILTIN_PROWLARR_URL && Env.BUILTIN_PROWLARR_API_KEY
            ? false
            : undefined,
      },
      ...(ProwlarrAddon.preconfiguredIndexers
        ? [
            {
              id: 'indexers',
              name: 'Indexers',
              description:
                'If using the preconfigured instance, select the indexers to use here.',
              type: 'multi-select',
              options: ProwlarrAddon.preconfiguredIndexers.map((indexer) => ({
                label: indexer.name,
                value: indexer.name,
              })),
              default: ProwlarrAddon.preconfiguredIndexers.map(
                (indexer) => indexer.name
              ),
            } as const,
          ]
        : [
            {
              id: 'indexers',
              name: 'Indexers',
              description:
                'Optionally define a comma separated list of indexers to use.',
              type: 'string',
              default: '',
            } as const,
          ]),
      {
        id: 'sources',
        name: 'Sources',
        description:
          'The sources to use when fetching from Prowlarr. If not specified, both torrent and usenet indexers will be used, if available.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          {
            label: 'Torrent',
            value: 'torrent',
          },
          {
            label: 'Usenet',
            value: 'usenet',
          },
        ],
      },
      {
        id: 'tags',
        name: 'Tags',
        description:
          'Optionally provide a comma separated list of tags here to limit the indexers to be used. Only indexers with these tags will be used.',
        type: 'string',
        showInSimpleMode:
          Env.BUILTIN_PROWLARR_URL && Env.BUILTIN_PROWLARR_API_KEY
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
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'Prowlarr supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'prowlarr',
      NAME: 'Prowlarr',
      LOGO: 'https://raw.githubusercontent.com/Prowlarr/Prowlarr/refs/heads/develop/Logo/256.png',
      URL: `${Env.INTERNAL_URL}/builtins/prowlarr`,
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'An addon to get torrent and usenet results from a Prowlarr instance via services.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.DEBRID_STREAM_TYPE,
        constants.USENET_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const usableServices = this.getUsableServices(userData, options.services);
    if (!usableServices || usableServices.length === 0) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one usable service, but none were found. Please enable at least one of the following services: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }
    if (options.useMultipleInstances) {
      return usableServices.map((service) =>
        this.generateAddon(userData, options, [service.id])
      );
    }
    return [
      this.generateAddon(
        userData,
        options,
        usableServices.map((service) => service.id)
      ),
    ];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    services: ServiceId[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(userData, services, options),
      enabled: true,
      displayIdentifier: services
        .map((id) => constants.SERVICE_DETAILS[id].shortName)
        .join(' | '),
      identifier:
        services.length > 1
          ? 'multi'
          : constants.SERVICE_DETAILS[services[0]].shortName,
      library: options.libraryAddon ?? false,
      resources: options.resources || undefined,
      mediaTypes: options.mediaTypes || [],
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      formatPassthrough:
        options.formatPassthrough ?? options.streamPassthrough ?? false,
      resultPassthrough: options.resultPassthrough ?? false,
      forceToTop: options.forceToTop ?? false,
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  protected static generateManifestUrl(
    userData: UserData,
    services: ServiceId[],
    options: Record<string, any>
  ) {
    let prowlarrUrl = undefined;
    let prowlarrApiKey = undefined;
    let indexers: string[] | undefined;

    if (options.prowlarrUrl || options.prowlarrApiKey) {
      prowlarrUrl = options.prowlarrUrl;
      prowlarrApiKey = options.prowlarrApiKey;
      if (options.indexers && typeof options.indexers === 'string') {
        indexers = `${options.indexers}`.split(',');
      }
    } else {
      prowlarrUrl = Env.BUILTIN_PROWLARR_URL;
      prowlarrApiKey = Env.BUILTIN_PROWLARR_API_KEY;
      indexers = Array.isArray(options.indexers) ? options.indexers : undefined;
    }

    if (!prowlarrUrl || !prowlarrApiKey) {
      throw new Error('Prowlarr URL and API Key are required');
    }

    const config = {
      ...this.getBaseConfig(userData, services),
      url: prowlarrUrl,
      apiKey: prowlarrApiKey,
      indexers: indexers || [],
      sources: options.sources || [],
      tags: typeof options.tags === 'string' ? options.tags.split(',') : [],
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.METADATA.URL}/${configString}/manifest.json`;
  }
}
