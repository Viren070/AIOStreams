import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
} from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, SERVICE_DETAILS } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

export class TorrentioParser extends StreamParser {
  override getFolder(stream: Stream): string | undefined {
    const description = stream.description || stream.title;
    if (!description) {
      return undefined;
    }
    const folderName = description.split('\n')[0];
    return folderName;
  }

  protected override getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    if (stream.description?.includes('Multi Subs')) {
      return [];
    }
    return super.getLanguages(stream, currentParsedStream);
  }
}

export class TorrentioPreset extends Preset {
  static defaultProviders = [
    {
      value: 'yts',
      label: 'YTS',
    },
    {
      value: 'eztv',
      label: 'EZTV',
    },

    {
      value: 'rarbg',
      label: 'RARBG',
    },
    {
      value: '1337x',
      label: '1337X',
    },
    {
      value: 'thepiratebay',
      label: 'The Pirate Bay',
    },
    {
      value: 'kickasstorrents',
      label: 'Kickass Torrents',
    },
    {
      value: 'torrentgalaxy',
      label: 'Torrent Galaxy',
    },
    {
      value: 'magnetdl',
      label: 'MagnetDL',
    },
    {
      value: 'horriblesubs',
      label: 'HorribleSubs',
    },
    {
      value: 'nyaasi',
      label: 'Nyaa.si',
    },
    {
      value: 'tokyotosho',
      label: 'Tokyo Tosho',
    },
    {
      value: 'anidex',
      label: 'AniDex',
    },
    {
      value: 'rutor',
      label: 'Rutor',
    },
    {
      value: 'rutracker',
      label: 'Rutracker',
    },
    {
      value: 'comando',
      label: 'Comando',
    },
    {
      value: 'bludv',
      label: 'BluDV',
    },
    {
      value: 'torrent9',
      label: 'Torrent9',
    },
    {
      value: 'ilcorsaronero',
      label: 'iLCorSaRoNeRo',
    },
    {
      value: 'mejortorrent',
      label: 'MejorTorrent',
    },
    {
      value: 'wolfmax4k',
      label: 'Wolfmax4K',
    },
    {
      value: 'cinecalidad',
      label: 'Cinecalidad',
    },
    {
      value: 'besttorrents',
      label: 'BestTorrents',
    },
  ];

  static override getParser(): typeof StreamParser {
    return TorrentioParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.EASYDEBRID_SERVICE,
      constants.PUTIO_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.OFFCLOUD_SERVICE,
    ];
    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Torrentio',
        supportedResources,
        Env.DEFAULT_TORRENTIO_TIMEOUT
      ),
      {
        id: 'providers',
        name: 'Providers',
        description:
          'Optionally override the providers that are used. If not specified, then the default providers will be used.',
        type: 'multi-select',
        required: false,
        options: TorrentioPreset.defaultProviders,
        showInNoobMode: false,
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInNoobMode: false,
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
          'When using multiple services, use a different Torrentio addon for each service, rather than using one instance for all services',
        type: 'boolean',
        default: false,
        required: true,
        showInNoobMode: false,
      },
    ];

    return {
      ID: 'torrentio',
      NAME: 'Torrentio',
      LOGO: `${Env.TORRENTIO_URL}/images/logo_v1.png`,
      URL: Env.TORRENTIO_URL,
      TIMEOUT: Env.DEFAULT_TORRENTIO_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_TORRENTIO_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      REQUIRES_SERVICE: false,
      DESCRIPTION:
        'Provides torrent streams from a multitude of providers and has debrid support.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.P2P_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: [
        constants.STREAM_RESOURCE,
        constants.META_RESOURCE,
        constants.CATALOG_RESOURCE,
      ],
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    // baseUrl can either be something like https://torrentio.com/ or it can be a custom manifest url.
    // if it is a custom manifest url, return a single addon with the custom manifest url.
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, [])];
    }

    const usableServices = this.getUsableServices(userData, options.services);

    // if no services are usable, return a single addon with no services
    if (!usableServices || usableServices.length === 0) {
      return [this.generateAddon(userData, options, [])];
    }

    // if user has specified useMultipleInstances, return a single addon for each service
    if (options?.useMultipleInstances) {
      return usableServices.map((service) =>
        this.generateAddon(userData, options, [service.id])
      );
    }

    // return a single addon with all usable services
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
      displayIdentifier: services
        .map((id) => constants.SERVICE_DETAILS[id].shortName)
        .join(' | '),
      identifier:
        services.length > 0
          ? services.length > 1
            ? 'multi'
            : constants.SERVICE_DETAILS[services[0]].shortName
          : options.url?.endsWith('/manifest.json')
            ? undefined
            : 'p2p',
      manifestUrl: this.generateManifestUrl(userData, services, options),
      enabled: true,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(
    userData: UserData,
    services: ServiceId[],
    options: Record<string, any>
  ) {
    const url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    let providers = options.providers;

    let config: string[][] = [];

    // add services to config
    if (services.length) {
      // generate a [serviceId, credential] array for each service and push it to config
      config = services.map((service) => [
        service,
        this.getServiceCredential(service, userData, {
          [constants.PUTIO_SERVICE]: (credentials: any) =>
            `${credentials.clientId}@${credentials.token}`,
        }),
      ]);
    }

    // add providers to config
    if (
      providers?.length &&
      providers.length !== TorrentioPreset.defaultProviders.length // when using default providers, we don't need to add providers to the config
    ) {
      config.push(['providers', providers.join(',')]);
    }

    const configString = this.urlEncodeKeyValuePairs(config);
    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
