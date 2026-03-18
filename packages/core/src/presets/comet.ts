import {
  Addon,
  Option,
  UserData,
  Resource,
  ParsedStream,
  Stream,
} from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { Env } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';
import { StremThruPreset } from './stremthru.js';

class CometStreamParser extends StreamParser {
  get errorRegexes(): { pattern: RegExp; message: string }[] | undefined {
    return [
      ...(super.errorRegexes || []),
      {
        pattern: /Scraping in progress by another instance\./i,
        message: 'Scraping in progress by another instance',
      },
    ];
  }

  protected shouldSkip(stream: Stream): boolean {
    if (stream.description?.includes('digitally released yet.')) {
      return true;
    }
    return super.shouldSkip(stream);
  }

  protected getError(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['error'] | undefined {
    const error = super.getError(stream, currentParsedStream);
    if (error) {
      return error;
    }
    const match = stream.name?.match(/^[❌|🚫|⚠️]/);
    if (match) {
      return {
        description: stream.description || 'Unknown error',
        title: this.addon.name,
      };
    }
  }

  protected isInfoStream(stream: Stream): string | undefined {
    const str = 'Sync debrid account library now';
    if (stream.description?.includes(str)) {
      return stream.description;
    }
  }
  override applyUrlModifications(url: string | undefined): string | undefined {
    if (!url) {
      return url;
    }
    if (
      Env.FORCE_COMET_HOSTNAME !== undefined ||
      Env.FORCE_COMET_PORT !== undefined ||
      Env.FORCE_COMET_PROTOCOL !== undefined
    ) {
      // modify the URL according to settings, needed when using a local URL for requests but a public stream URL is needed.
      const urlObj = new URL(url);

      if (Env.FORCE_COMET_PROTOCOL !== undefined) {
        urlObj.protocol = Env.FORCE_COMET_PROTOCOL;
      }
      if (Env.FORCE_COMET_PORT !== undefined) {
        urlObj.port = Env.FORCE_COMET_PORT.toString();
      }
      if (Env.FORCE_COMET_HOSTNAME !== undefined) {
        urlObj.hostname = Env.FORCE_COMET_HOSTNAME;
      }
      return urlObj.toString();
    }
    return super.applyUrlModifications(url);
  }
}

export class CometPreset extends StremThruPreset {
  static override getParser(): typeof StreamParser {
    return CometStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.EASYDEBRID_SERVICE,
      constants.DEBRIDER_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.OFFCLOUD_SERVICE,
      constants.PIKPAK_SERVICE,
    ];

    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Comet',
        supportedResources,
        Env.DEFAULT_COMET_TIMEOUT,
        Env.COMET_URL
      ),
      {
        id: 'includeP2P',
        name: 'Include P2P',
        description: 'Include P2P results, even if a debrid service is enabled',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'removeTrash',
        name: 'Remove Trash',
        description:
          'Remove all trash from results (Adult Content, CAM, Clean Audio, PDTV, R5, Screener, Size, Telecine and Telesync)',
        type: 'boolean',
        default: true,
        showInSimpleMode: false,
      },
      {
        id: 'scrapeDebridAccountTorrents',
        name: 'Search Debrid Library',
        description: 'Search your debrid account library for matching torrents',
        type: 'boolean',
        default: false,
        required: false,
        showInSimpleMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'When using multiple services, use a different Comet addon for each service, rather than using one instance for all services',
        type: 'boolean',
        default: false,
        required: false,
        showInSimpleMode: false,
      },
      {
        id: 'services',
        name: 'Services',
        showInSimpleMode: false,
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
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/g0ldyy/comet',
          },
          {
            id: 'ko-fi',
            url: 'https://ko-fi.com/g0ldyy',
          },
        ],
      },
    ];

    return {
      ID: 'comet',
      NAME: 'Comet',
      LOGO: 'https://raw.githubusercontent.com/g0ldyy/comet/refs/heads/main/comet/assets/icon.png',
      URL: Env.COMET_URL[0],
      TIMEOUT: Env.DEFAULT_COMET_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_COMET_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: "Stremio's fastest Torrent/Debrid addon",
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.P2P_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    // url can either be something like https://comet.example.com/ or it can be a custom manifest url.
    // if it is a custom manifest url, return a single addon with the custom manifest url.
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, [])];
    }

    const usableServices = this.getUsableServices(userData, options.services);
    // if no services are usable, use p2p
    if (!usableServices || usableServices.length === 0) {
      return [this.generateAddon(userData, options, [])];
    }

    // if user has specified useMultipleInstances, return a single addon for each service
    // and if includeP2p is enabled, return ONLY ONE instance with the includep2p set to true
    let addedP2pAddon = false;
    if (options?.useMultipleInstances) {
      const instanceOptions = { ...options, includeP2P: false };
      if (options.includeP2P && !addedP2pAddon) {
        instanceOptions.includeP2P = true;
        addedP2pAddon = true;
      }
      const addons = usableServices.map((service) =>
        this.generateAddon(userData, instanceOptions, [service.id])
      );
      return addons;
    }

    // return a single addon with all usable services
    const addons = [
      this.generateAddon(
        userData,
        options,
        usableServices.map((service) => service.id)
      ),
    ];

    if (options.includeP2P) {
      addons.push(this.generateAddon(userData, options, []));
    }

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
      manifestUrl: this.generateManifestUrl(userData, options, services),
      enabled: true,
      mediaTypes: options.mediaTypes || [],
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
    options: Record<string, any>,
    services: ServiceId[]
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');

    const debridServices = services.map((serviceId) => ({
      service: serviceId,
      apiKey: this.getServiceCredential(serviceId, userData),
    }));

    const configString = this.base64EncodeJSON({
      maxResultsPerResolution: 0,
      maxSize: 0,
      cachedOnly: false,
      removeTrash: options.removeTrash ?? true,
      resultFormat: ['all'],
      debridServices: debridServices,
      enableTorrent: options.includeP2P ?? false,
      scrapeDebridAccountTorrents: options.scrapeDebridAccountTorrents ?? false,
      debridStreamProxyPassword: '',
      languages: { required: [], exclude: [], preferred: [] },
      resolutions: {},
      options: {
        remove_ranks_under: -10000000000,
        allow_english_in_languages: false,
        remove_unknown_languages: false,
      },
    });

    let token: string | undefined = undefined;
    if (Env.COMET_PUBLIC_API_TOKEN) {
      const cometUrlIndex = Env.COMET_URL.findIndex(
        (cometUrl) => cometUrl.replace(/\/$/, '') === url
      );
      token =
        cometUrlIndex !== -1
          ? Env.COMET_PUBLIC_API_TOKEN[
              Math.min(cometUrlIndex, Env.COMET_PUBLIC_API_TOKEN.length - 1)
            ]
          : undefined;
    }

    return `${url}${token ? `/s/${token}` : ''}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
