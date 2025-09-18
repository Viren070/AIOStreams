import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
} from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { createLogger, Env } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

const logger = createLogger('core');

class StreamAsiaStreamParser extends StreamParser {
  private knownSources = ['kisskh', 'onetouchtv'];
  protected override get indexerRegex(): RegExp | undefined {
    return undefined;
  }
  protected override parseServiceData(
    string: string
  ): ParsedStream['service'] | undefined {
    const service = super.parseServiceData(string);
    if (service) {
      service.cached = true;
    }
    return service;
  }

  protected getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const regex = this.getRegexForTextAfterEmojis(['🚫', '⚠']);
    const match = stream.description?.match(regex);
    if (match) {
      return match[1];
    }
    const proxyRegex = this.getRegexForTextAfterEmojis(['🔗 Proxy:']);
    const proxyMatch = stream.description?.match(proxyRegex);
    if (proxyMatch) {
      return proxyMatch[1];
    }
    if (stream.name?.includes('[Action]')) {
      return stream.description || undefined;
    }
    return undefined;
  }

  protected override isProxied(stream: Stream): boolean {
    return !!stream.description?.includes('🔗 Proxy:');
  }
  protected override getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const filename = super.getFilename(stream, currentParsedStream);
    if (
      filename &&
      (this.knownSources.includes(filename.toLowerCase()) ||
        stream.name?.includes('[Action]'))
    ) {
      return undefined;
    }
    return filename;
  }
  protected getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const indexer = stream.name?.split('\n')[2];
    if (
      indexer?.match(/^(?!-)[A-Za-z0-9-]+([\-\.]{1}[a-z0-9]+)*\.[A-Za-z]{2,}$/)
    ) {
      return indexer;
    }
    const firstLine = stream.description?.split('\n')?.[0];
    if (firstLine && this.knownSources.includes(firstLine.toLowerCase())) {
      return firstLine;
    }
    return super.getIndexer(stream, currentParsedStream);
  }
}

export class StreamAsiaPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return StreamAsiaStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.TORBOX_SERVICE,
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.DEBRIDLINK_SERVICE,
    ];

    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.SUBTITLES_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'StreamAsia',
        supportedResources,
        Env.DEFAULT_STREAMASIA_TIMEOUT
      ),
      {
        id: 'kisskhCatalogs',
        name: 'Kisskh Catalogs',
        description: 'The catalogs to use for Kisskh',
        type: 'multi-select',
        required: false,
        options: [
          {
            value: 'kkh-search-results',
            label: 'Search Results',
          },
          {
            value: 'kkh-korean-drama',
            label: 'Korean Drama',
          },
          {
            value: 'kkh-korean-movies',
            label: 'Korean Movies',
          },
          {
            value: 'kkh-chinese-drama',
            label: 'Chinese Drama',
          },
          {
            value: 'kkh-chinese-movies',
            label: 'Chinese Movies',
          },
          {
            value: 'kkh-japanese-drama',
            label: 'Japanese Drama',
          },
          {
            value: 'kkh-japanese-movies',
            label: 'Japanese Movies',
          },
        ],
      },

      // {
      //   id: 'kdhdCatalogs',
      //   name: 'Kdramahood Catalogs',
      //   description: 'The catalogs to use for Kdramahood',
      //   type: 'multi-select',
      //   required: false,
      //   options: [
      //     {
      //       value: 'kdhd-search-results',
      //       label: 'Search Results',
      //     },
      //     {
      //       value: 'kdhd-popular-korean-drama',
      //       label: 'Popular Korean Drama',
      //     },
      //   ],
      // },

      {
        id: 'ottvCatalogs',
        name: 'Onetouchtv Catalogs',
        description: 'The catalogs to use for Ottv',
        type: 'multi-select',
        required: false,
        options: [
          {
            value: 'ottv-search-results',
            label: 'Search Results',
          },
          {
            value: 'ottv-popular-drama',
            label: 'Popular Drama',
          },
        ],
      },

      {
        id: 'ddlCatalogs',
        name: 'Direct Download Catalogs',
        description: 'Debrid-only streams from file hosters',
        type: 'multi-select',
        required: false,
        options: [
          {
            value: 'dmx-search-results',
            label: 'Source 1: Search Results',
          },
          {
            value: 'dmx-new-completed-korean-drama',
            label: 'Source 1: New Completed Korean Drama',
          },
          {
            value: 'dmx-new-korean-movies',
            label: 'Source 1: New Korean Movies',
          },
          {
            value: 'dmx-new-korean-variety-shows',
            label: 'Source 1: New Korean Variety Shows',
          },
          {
            value: 'mkx-search-results',
            label: 'Source 2: Search Results',
          },
          {
            value: 'mkx-new-korean-drama',
            label: 'Source 2: New Korean Drama',
          },
          {
            value: 'mkx-new-chinese-drama',
            label: 'Source 2: New Chinese Drama',
          },
          {
            value: 'mkx-new-japanese-drama',
            label: 'Source 2: New Japanese Drama',
          },
        ],
      },

      {
        id: 'hideUpcomingShows',
        name: 'Hide Upcoming Shows',
        description: 'Hide upcoming shows from the Kisskh catalog',
        type: 'boolean',
        required: false,
        default: false,
      },

      {
        id: 'hideUnsupportedHosters',
        name: 'Hide Unsupported Hosters',
        description:
          'Hide results from hosters that are not supported by your debrid service',
        type: 'boolean',
        required: false,
        default: false,
      },

      {
        id: 'showTMDBSeason',
        name: 'Show TMDB Listing',
        description:
          "Add a 'Special' season listing to Kisskh catalogs that links to the TMDB season page to see streams from other addons.",
        type: 'boolean',
        required: false,
        default: false,
      },

      {
        id: 'enableOpensubs',
        name: 'Subtitles (Experimental)',
        description: 'Provide subtitles from OpenSubtitles.',
        type: 'boolean',
        required: false,
        default: false,
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
        id: 'alert',
        name: 'MediaFlow Proxy',
        description: `
These proxy details are only used for some streams, providing this will not proxy
any debrid streams. MediaFlow or StremThru must be setup in the proxy menu. 
If you have setup MediaFlow in the proxy menu, it will automatically be used here, and
there is no need to provide these details here.
        `,
        type: 'alert',
        required: false,
      },

      {
        id: 'mediaflowProxyUrl',
        name: 'MediaFlow Proxy URL',
        description:
          'Provide a mediaflow proxy url here to use for StreamAsia. ',
        type: 'url',
        required: false,
      },
      {
        id: 'mediaflowProxyPassword',
        name: 'MediaFlow Proxy Password',
        description: 'The password for your MediaFlow Proxy instance.',
        type: 'password',
        required: false,
      },
    ];

    return {
      ID: 'streamasia',
      NAME: 'StreamAsia',
      LOGO: `${Env.STREAMASIA_URL}/static/addon_logo_monochrome.png`,
      URL: Env.STREAMASIA_URL,
      TIMEOUT: Env.DEFAULT_STREAMASIA_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_STREAMASIA_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'Watch asian drama, movies and variety shows from various sources',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.HTTP_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
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
    if (
      usableServices?.length === 0 &&
      options.ddlCatalogs &&
      options.ddlCatalogs.length > 0
    ) {
      throw new Error(
        `${this.METADATA.NAME}: Direct Download Catalogs require a debrid service`
      );
    }
    return [
      this.generateAddon(
        userData,
        options,
        usableServices?.map((service) => service.id) || []
      ),
    ];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    serviceIds: ServiceId[]
  ): Addon {
    const url = this.generateManifestUrl(userData, options, serviceIds);
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: url,
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
    options: Record<string, any>,
    serviceIds: ServiceId[]
  ) {
    const url = (options.url || this.METADATA.URL).replace(/\/$/, '');
    if (url.endsWith('/manifest.json')) {
      return url;
    }

    const encodedUserData = this.generateEncodedUserData(
      userData,
      options,
      serviceIds
    );
    return `${url}/${encodedUserData}/manifest.json`;
  }

  private static generateEncodedUserData(
    userData: UserData,
    options: Record<string, any>,
    serviceIds: ServiceId[]
  ) {
    const serviceNameMap: Partial<Record<ServiceId, string>> = {
      [constants.TORBOX_SERVICE]: 'Torbox',
      [constants.REALDEBRID_SERVICE]: 'Real Debrid',
      [constants.PREMIUMIZE_SERVICE]: 'Premiumize',
      [constants.ALLDEBRID_SERVICE]: 'AllDebrid',
      [constants.DEBRIDLINK_SERVICE]: 'Debrid-Link',
    };

    const debridConfig = serviceIds?.map((serviceId) => ({
      debridProvider: serviceNameMap[serviceId],
      token: this.getServiceCredential(serviceId, userData),
    }));

    const proxyUrl =
      options.mediaflowProxyUrl ||
      (userData.proxy?.id === 'mediaflow' && userData.proxy.url) ||
      undefined;
    const proxyPassword =
      options.mediaflowProxyPassword ||
      (userData.proxy?.id === 'mediaflow' && userData.proxy.credentials) ||
      undefined;

    const encodedUserData = this.base64EncodeJSON(
      {
        'kisskh-catalogs': options.kisskhCatalogs,
        'kdhd-catalogs': options.kdhdCatalogs,
        'ottv-catalogs': options.ottvCatalogs,
        'ddl-catalogs': options.ddlCatalogs,
        traktCode: null,
        showTMDBSeason: options.showTMDBSeason,
        enableOpensubs: options.enableOpensubs,
        hideUpcomingShows: options.hideUpcomingShows,
        debugFlags: '',
        mediaflowProxyConfigs:
          proxyUrl && proxyPassword
            ? [
                {
                  label: '',
                  url: proxyUrl,
                  pwd: encodeURIComponent(proxyPassword),
                },
              ]
            : [],
        debridConfig: debridConfig,
        hideUnsupportedHosters: options.hideUnsupportedHosters,
        version: '1.3.1',
      },
      true
    );

    return encodedUserData;
  }
}
