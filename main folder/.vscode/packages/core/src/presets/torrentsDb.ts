import { Addon, Option, UserData, Resource, Stream, ParsedStream } from '../db';
import { Preset, baseOptions } from './preset';
import { Env, SERVICE_DETAILS } from '../utils';
import { constants, ServiceId } from '../utils';
import { StreamParser } from '../parser';

export class TorrentsDbParser extends StreamParser {
  override getFolder(stream: Stream): string | undefined {
    const description = stream.description || stream.title;
    if (!description) {
      return undefined;
    }
    const folderName = description.split('\n')[0];
    return folderName;
  }
}

export class TorrentsDbPreset extends Preset {
  static defaultProviders = [
    {
      value: 'yts',
      label: 'YTS',
    },
    {
      value: '1337x',
      label: '1337x',
    },
    {
      value: 'torrentcsv',
      label: 'TorrentCSV',
    },
    {
      value: '1lou',
      label: '1lou',
    },
    {
      value: 'nyaa',
      label: 'Nyaa',
    },
    {
      value: 'sktorrent',
      label: 'Sk-CzTorrent',
    },
    {
      value: '1tamilblasters',
      label: '1TamilBlasters',
    },
    {
      value: 'limetorrent',
      label: 'LimeTorrent',
    },
    {
      value: '1tamilmv',
      label: '1TamilMV',
    },
    {
      value: 'rargb',
      label: 'RARGB',
    },
    {
      value: 'knaben',
      label: 'Knaben',
    },
    {
      value: 'thepiratebay',
      label: 'ThePirateBay',
    },
    {
      value: 'kickasstorrents',
      label: 'KickassTorrents',
    },
    {
      value: 'animetosho',
      label: 'AnimeTosho',
    },
    {
      value: 'extremlymtorrents',
      label: 'ExtremlymTorrents',
    },
    {
      value: 'yggtorrent',
      label: 'YggTorrent',
    },
    {
      value: 'tokyotosho',
      label: 'TokyoTosho',
    },
    {
      value: 'rutor',
      label: '🇷🇺 Rutor',
    },
    {
      value: 'rutracker',
      label: '🇷🇺 Rutracker',
    },
    {
      value: 'torrent9',
      label: '🇫🇷 Torrent9',
    },
    {
      value: 'ilcorsaronero',
      label: '🇮🇹 ilCorSaRoNeRo',
    },
    {
      value: 'manual',
      label: 'Manual',
    },
  ];

  static override getParser(): typeof StreamParser {
    return TorrentsDbParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLEDEBRID_SERVICE,
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
        'TorrentsDB',
        supportedResources,
        Env.DEFAULT_TORRENTS_DB_TIMEOUT
      ),
      {
        id: 'providers',
        name: 'Providers',
        description:
          'Optionally override the providers that are used. If not specified, then the default providers will be used.',
        type: 'multi-select',
        required: false,
        options: TorrentsDbPreset.defaultProviders,
        default: TorrentsDbPreset.defaultProviders.map(
          (provider) => provider.value
        ),
        emptyIsUndefined: true,
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        options: supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      {
        id: 'includeP2P',
        name: 'Include P2P',
        description:
          'When using a debrid service, choose to also include P2P results. If no services are enabled, then this option will be ignored.',
        type: 'boolean',
        default: false,
        required: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'When using multiple services, use a different TorrentsDB addon for each service, rather than using one instance for all services',
        type: 'boolean',
        default: false,
        required: true,
      },
    ];

    return {
      ID: 'torrents-db',
      NAME: 'TorrentsDB',
      LOGO: `${Env.TORRENTS_DB_URL}/icon.svg`,
      URL: Env.TORRENTS_DB_URL,
      TIMEOUT: Env.DEFAULT_TORRENTS_DB_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_TORRENTS_DB_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      REQUIRES_SERVICE: false,
      DESCRIPTION: 'Provides torrent streams from scraped torrent providers.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.P2P_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: [constants.STREAM_RESOURCE],
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, [])];
    }

    const usableServices = this.getUsableServices(userData, options.services);

    // if no services are usable, return a single addon with no services
    if (!usableServices || usableServices.length === 0) {
      return [this.generateAddon(userData, options, [])];
    }

    let addons: Addon[] = [];
    // if user has specified useMultipleInstances, return a single addon for each service
    if (options?.useMultipleInstances) {
      addons = usableServices.map((service) =>
        this.generateAddon(userData, options, [service.id])
      );
    } else {
      addons = [
        this.generateAddon(
          userData,
          options,
          usableServices.map((service) => service.id)
        ),
      ];
    }
    if (options?.includeP2P) {
      addons.push(this.generateAddon(userData, options, []));
    }
    // return a single addon with all usable services
    return addons;
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
      presetType: this.METADATA.ID,
      presetInstanceId: '',
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

    if (!providers) {
      providers = TorrentsDbPreset.defaultProviders.map(
        (provider) => provider.value
      );
    }

    if (providers.length === TorrentsDbPreset.defaultProviders.length) {
      providers = undefined;
    }

    const configString = this.base64EncodeJSON({
      providers,
      premiumize: services.includes(constants.PREMIUMIZE_SERVICE)
        ? this.getServiceCredential(constants.PREMIUMIZE_SERVICE, userData)
        : undefined,
      realdebrid: services.includes(constants.REALDEBRID_SERVICE)
        ? this.getServiceCredential(constants.REALDEBRID_SERVICE, userData)
        : undefined,
      torbox: services.includes(constants.TORBOX_SERVICE)
        ? this.getServiceCredential(constants.TORBOX_SERVICE, userData)
        : undefined,
      putio: services.includes(constants.PUTIO_SERVICE)
        ? this.getServiceCredential(constants.PUTIO_SERVICE, userData, {
            [constants.PUTIO_SERVICE]: (credentials: any) =>
              `${credentials.clientId}@${credentials.token}`,
          })
        : undefined,
      debridlink: services.includes(constants.DEBRIDLINK_SERVICE)
        ? this.getServiceCredential(constants.DEBRIDLINK_SERVICE, userData)
        : undefined,
      offcloud: services.includes(constants.OFFCLOUD_SERVICE)
        ? this.getServiceCredential(constants.OFFCLOUD_SERVICE, userData)
        : undefined,
      alldebrid: services.includes(constants.ALLEDEBRID_SERVICE)
        ? this.getServiceCredential(constants.ALLEDEBRID_SERVICE, userData)
        : undefined,
      easydebrid: services.includes(constants.EASYDEBRID_SERVICE)
        ? this.getServiceCredential(constants.EASYDEBRID_SERVICE, userData)
        : undefined,
    });
    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
