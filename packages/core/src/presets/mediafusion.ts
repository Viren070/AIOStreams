import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
} from '../db/index.js';
import { baseOptions, CacheKeyRequestOptions, Preset } from './preset.js';
import { createLogger, getSimpleTextHash } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { StreamParser } from '../parser/index.js';

const logger = createLogger('core');

class MediaFusionStreamParser extends StreamParser {
  protected get sizeK(): 1024 | 1000 {
    return 1000;
  }

  protected override raiseErrorIfNecessary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): void {
    if (stream.description?.includes('Content Warning')) {
      throw new Error(stream.description);
    }
    super.raiseErrorIfNecessary(stream, currentParsedStream);
  }

  protected override shouldSkip(stream: Stream): boolean {
    return (
      stream.description?.includes('🚫 Streams Found\n⚙️ Filtered') ?? false
    );
  }

  protected override get indexerEmojis(): string[] {
    return ['🔗'];
  }

  protected override getFolder(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const nameRegex = this.getRegexForTextAfterEmojis(['📂']);
    const filenameRegex = this.getRegexForTextAfterEmojis(['📄']);

    const name = stream.description?.match(nameRegex)?.[1];
    const filename = stream.description?.match(filenameRegex)?.[1];

    if (name && filename && name !== filename) {
      currentParsedStream.filename = filename.trim();
      return name;
    }

    return undefined;
  }

  protected override getFolderSize(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    const regex = /📦\s?.*\s?\/\s?📦\s?([^📦\n]+)/;
    const match = stream.description?.match(regex);
    if (match) {
      const folderSize = match[1].trim();
      return this.calculateBytesFromSizeString(folderSize);
    }
    return undefined;
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    const type = super.getStreamType(stream, service, currentParsedStream);
    if (stream.description?.includes('📰 Usenet/NZB'))
      return constants.USENET_STREAM_TYPE;
    return type;
  }

  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    if (
      stream.description?.includes('Update IMDb metadata') ||
      stream.description?.includes('Upload torrent for')
    ) {
      return stream.description.replace(/^\p{Emoji_Presentation}+/gu, '');
    }
    return undefined;
  }

  protected override getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const indexer = super.getIndexer(stream, currentParsedStream);
    const contributor = stream.description?.match(
      this.getRegexForTextAfterEmojis(['🧑‍💻'])
    )?.[1];
    let indexerParts = [];
    if (indexer) {
      indexerParts.push(indexer);
    }
    if (contributor) {
      indexerParts.push('Contributor', contributor);
    }
    return indexerParts.length > 0 ? indexerParts.join('|') : undefined;
  }

  protected override getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    const languages = super.getLanguages(stream, currentParsedStream);
    const regex = this.getRegexForTextAfterEmojis(['🌐']);
    const languagesString = stream.description?.match(regex)?.[1];
    if (languagesString) {
      return languages.concat(
        languagesString
          .split('|')
          .map((language) => language.trim())
          .filter((language) => constants.LANGUAGES.includes(language as any))
      );
    }
    return languages;
  }
}

export class MediaFusionPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return MediaFusionStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.EASYDEBRID_SERVICE,
      constants.DEBRIDER_SERVICE,
      constants.OFFCLOUD_SERVICE,
      constants.PIKPAK_SERVICE,
      constants.SEEDR_SERVICE,
      constants.EASYNEWS_SERVICE,
    ];

    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'MediaFusion',
        supportedResources,
        appConfig.presets.mediafusion.defaultTimeout ??
          appConfig.presets.defaultTimeout,
        appConfig.presets.mediafusion.url ?? undefined
      ),
      {
        id: 'certificationLevelsFilter',
        name: 'Certification Levels Filter',
        description:
          'Choose to not display streams for titles of a certain certification level. Leave blank to show all results.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          {
            value: 'Unknown',
            label: 'Unknown',
          },
          {
            value: 'All Ages',
            label: 'All Ages',
          },
          {
            value: 'Children',
            label: 'Children',
          },
          {
            value: 'Parental Guidance',
            label: 'Parental Guidance',
          },
          {
            value: 'Teen',
            label: 'Teen',
          },
          {
            value: 'Adults',
            label: 'Adults',
          },
          {
            value: 'Adults+',
            label: 'Adults+',
          },
        ],
      },
      {
        id: 'nudityFilter',
        name: 'Nudity Filter',
        description:
          'Choose to not display streams that a certain level of nudity. Leave blank to show all results.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          {
            value: 'Unknown',
            label: 'Unknown',
          },
          {
            value: 'None',
            label: 'None',
          },
          {
            value: 'Mild',
            label: 'Mild',
          },
          {
            value: 'Moderate',
            label: 'Moderate',
          },
          {
            value: 'Severe',
            label: 'Severe',
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
        id: 'useCachedResultsOnly',
        name: 'Use Cached Searches Only',
        description:
          "Only show results that are already cached in MediaFusion's database from previous searches. This disables live searching, making requests faster but potentially showing fewer results.",
        type: 'boolean',
        forced: appConfig.presets.mediafusion.forcedUseCachedResultsOnly,
        default: appConfig.presets.mediafusion.defaultUseCachedResultsOnly,
        showInSimpleMode: false,
      },
      {
        id: 'enableWatchlistCatalogs',
        name: 'Enable Watchlist Catalogs',
        description: 'Enable watchlist catalogs for the selected services.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'includeP2P',
        name: 'Include P2P',
        description:
          'Include P2P streams alongside debrid streams. You only need to turn this on if you have provided a debrid service in AIOStreams, otherwise P2P streams will always be included.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description: '',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'github', url: 'https://github.com/mhdzumair/MediaFusion' },
        ],
      },
    ];

    return {
      ID: 'mediafusion',
      NAME: 'MediaFusion',
      LOGO: `https://raw.githubusercontent.com/mhdzumair/MediaFusion/refs/heads/main/resources/images/mediafusion_logo.png`,
      URL: appConfig.presets.mediafusion.url,
      TIMEOUT:
        appConfig.presets.mediafusion.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.mediafusion.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'Universal Stremio Add-on for Movies, Series, Live TV & Sports Events',
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
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, [])];
    }

    const usableServiceIds: (ServiceId | 'p2p')[] | undefined =
      this.getUsableServices(userData, options.services)?.map(
        (service) => service.id
      );

    if (!usableServiceIds || usableServiceIds.length === 0) {
      return [this.generateAddon(userData, options, ['p2p'])];
    }

    // let addons = usableServices.map((service, idx) => {
    //   let addonOptions = structuredClone(options);
    //   // only the first addon gets contributorStreams to ensure we don't get duplicate contribution streams
    //   addonOptions.contributorStreams =
    //     addonOptions.contributorStreams && idx === 0;
    //   return this.generateAddon(userData, addonOptions, service.id);
    // });

    if (options.includeP2P) {
      usableServiceIds.push('p2p');
    }

    if (options.useMultipleInstances) {
      return usableServiceIds.map((id) =>
        this.generateAddon(userData, options, [id])
      );
    }
    const addons = [this.generateAddon(userData, options, usableServiceIds)];

    return addons;
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    services: (ServiceId | 'p2p')[]
  ): Addon {
    const encodedUserData = this.generateEncodedUserData(
      userData,
      options,
      services
    );
    const url = this.generateManifestUrl(options, encodedUserData);
    return {
      name: options.name || this.METADATA.NAME,
      displayIdentifier: services
        .map((id) =>
          id === 'p2p' ? 'P2P' : constants.SERVICE_DETAILS[id].shortName
        )
        .join(' | '),
      identifier:
        services.length > 0
          ? services.length > 1
            ? 'multi'
            : services[0] === 'p2p'
              ? 'p2p'
              : constants.SERVICE_DETAILS[services[0]].shortName
          : options.url?.endsWith('/manifest.json')
            ? undefined
            : 'p2p',
      manifestUrl: url,
      enabled: true,
      mediaTypes: options.mediaTypes || [],
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      headers: options.url?.endsWith('/manifest.json')
        ? {
            'User-Agent': this.METADATA.USER_AGENT,
          }
        : {
            'User-Agent': this.METADATA.USER_AGENT,
            encoded_user_data: encodedUserData,
          },
    };
  }

  public static getCacheKey(
    options: CacheKeyRequestOptions
  ): string | undefined {
    const { headers, resource, type, id, extras } = options;
    if (headers?.encoded_user_data) {
      return getSimpleTextHash(
        `${resource}:${type}:${id}:${extras ?? ''}:${headers.encoded_user_data}`
      );
    }
    return undefined;
  }

  private static generateManifestUrl(
    options: Record<string, any>,
    encodedUserData: string
  ) {
    const url = (options.url || this.DEFAULT_URL).replace(/\/$/, '');
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    return `${url}/manifest.json`;
  }

  private static generateEncodedUserData(
    userData: UserData,
    options: Record<string, any>,
    services: (ServiceId | 'p2p')[]
  ) {
    const config = this.buildConfig(userData, options, services);
    return this.base64EncodeJSON(config, 'urlSafe');
  }

  private static buildConfig(
    userData: UserData,
    options: Record<string, unknown>,
    services: (ServiceId | 'p2p')[]
  ) {
    let easynewsConfig = null;
    let pikpakConfig = null;
    if (services.includes(constants.EASYNEWS_SERVICE)) {
      easynewsConfig = this.getServiceCredential(
        constants.EASYNEWS_SERVICE,
        userData
      );
    }
    if (services.includes(constants.PIKPAK_SERVICE)) {
      pikpakConfig = this.getServiceCredential(
        constants.PIKPAK_SERVICE,
        userData
      );
    }
    const buildProvider = (serviceId: ServiceId | 'p2p', index: number) => ({
      name: index > 0 ? `Provider ${index + 1}` : 'Provider',
      service: serviceId,
      token: ![
        constants.EASYNEWS_SERVICE,
        constants.PIKPAK_SERVICE,
        'p2p',
      ].includes(serviceId)
        ? this.getServiceCredential(serviceId as ServiceId, userData)
        : null,
      ...(serviceId === constants.PIKPAK_SERVICE && pikpakConfig
        ? pikpakConfig
        : {}),
      enable_watchlist_catalogs: options.enableWatchlistCatalogs || false,
      qbittorrent_config: null,
      only_show_cached_streams: false,
      use_mediaflow: true,
      sabnzbd_config: null,
      nzbget_config: null,
      nzbdav_config: null,
      easynews_config:
        serviceId === constants.EASYNEWS_SERVICE ? easynewsConfig : null,
      priority: index,
      enabled: true,
    });

    const streamingProviders = services.map((serviceId, index) =>
      buildProvider(serviceId, index)
    );

    const config = {
      streaming_providers: streamingProviders,
      streaming_provider: streamingProviders[0],
      stream_template: {
        title:
          '{addon.name} {if stream.type = torrent }[{service.shortName} {if service.cached}⚡️{else}⏳{/if}]{elif stream.type = usenet}[{service.shortName}{if service.cached}⚡️{else}⏳{/if}]{elif stream.type = telegram}📱{elif stream.type = youtube}▶️{elif stream.type = http}🌐{else}🔗{/if} {if stream.resolution}{stream.resolution}{/if}',
        description:
          "📂 {stream.name}\n{if stream.filename}📄 {stream.filename} {/if}\n{if stream.type = torrent}🧲 Torrent{elif stream.type = usenet}📰 Usenet/NZB{elif stream.type = http}🔗 Direct Stream{else}📺 {stream.type|title}{/if}\n{if stream.quality}🎥 {stream.quality} {/if}{if stream.codec}🎞️ {stream.codec} {/if}{if stream.bit_depth}{stream.bit_depth}-bit {/if}\n{if stream.hdr_formats}🎨 {stream.hdr_formats|join(' ')} {/if}{if stream.audio_formats}🎧 {stream.audio_formats|join(' ')} {/if}{if stream.channels}🔊 {stream.channels|join(' ')} {/if}\n{if stream.size > 0}📦 {stream.size|bytes}{if stream.folderSize > stream.size} / {stream.folderSize|bytes}{/if} {/if}{if stream.seeders > 0}👤 {stream.seeders} seeders {/if}\n{if stream.languages}🌐 {stream.languages|join(' | ')}{/if}\n{if stream.issue_reports > 0}⚠️ {stream.issue_reports} issue report(s)\n{/if}{if stream.rating_total > 0}👍 {stream.rating_up} · 👎 {stream.rating_down} · net {stream.rating_score}\n{/if}\n🔗 {stream.source}{if stream.release_group} | 🏷️ {stream.release_group}{/if}{if stream.uploader} | 🧑‍💻 {stream.uploader}{/if}",
      },
      selected_catalogs: [],
      selected_resolutions: [
        '4k',
        '2160p',
        '1440p',
        '1080p',
        '720p',
        '576p',
        '480p',
        '360p',
        '240p',
        null,
      ],
      enable_catalogs: true,
      enable_imdb_metadata: false,
      min_size: 0,
      max_size: 'inf',
      max_streams_per_resolution: 500,
      max_streams: 100,
      torrent_sorting_priority: [
        { key: 'cached', direction: 'desc' },
        { key: 'resolution', direction: 'desc' },
        { key: 'quality', direction: 'desc' },
        { key: 'size', direction: 'desc' },
        { key: 'language', direction: 'desc' },
        { key: 'seeders', direction: 'desc' },
        { key: 'created_at', direction: 'desc' },
      ],
      nudity_filter:
        Array.isArray(options.nudityFilter) && options.nudityFilter.length > 0
          ? options.nudityFilter
          : ['Disable'],
      certification_filter:
        Array.isArray(options.certificationLevelsFilter) &&
        options.certificationLevelsFilter.length > 0
          ? options.certificationLevelsFilter
          : ['Disable'],
      language_sorting: [
        'English',
        'Tamil',
        'Hindi',
        'Malayalam',
        'Kannada',
        'Telugu',
        'Chinese',
        'Russian',
        'Arabic',
        'Japanese',
        'Korean',
        'Taiwanese',
        'Latino',
        'French',
        'Spanish',
        'Portuguese',
        'Italian',
        'German',
        'Ukrainian',
        'Polish',
        'Czech',
        'Thai',
        'Indonesian',
        'Vietnamese',
        'Dutch',
        'Bengali',
        'Turkish',
        'Greek',
        'Swedish',
        'Romanian',
        'Hungarian',
        'Finnish',
        'Norwegian',
        'Danish',
        'Hebrew',
        'Lithuanian',
        'Punjabi',
        'Marathi',
        'Gujarati',
        'Bhojpuri',
        'Nepali',
        'Urdu',
        'Tagalog',
        'Filipino',
        'Malay',
        'Mongolian',
        'Armenian',
        'Georgian',
        null,
      ],
      quality_filter: [
        'BluRay/UHD',
        'WEB/HD',
        'DVD/TV/SAT',
        'CAM/Screener',
        'Unknown',
      ],
      hdr_filter: ['HDR10', 'HDR10+', 'Dolby Vision', 'HLG', 'SDR', 'Unknown'],
      api_password: appConfig.presets.mediafusion.apiPassword,
      live_search_streams: !options.useCachedResultsOnly,
      include_anime: true,
      // enable_usenet_streams: true,
      // prefer_usenet_over_torrent: false,
      enable_telegram_streams: false,
      enable_acestream_streams: false,
      stream_type_grouping: 'separate',
      stream_type_order: [
        'torrent',
        'usenet',
        'telegram',
        'http',
        'acestream',
        'youtube',
      ],
      provider_grouping: 'separate',
      stream_name_filter_mode: 'disabled',
      stream_name_filter_patterns: [],
      stream_name_filter_use_regex: false,
      telegram_config: null,
    };

    return config;
  }
}
