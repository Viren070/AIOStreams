import { Addon, Option, UserData, Resource } from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { constants, ServiceId } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

export class StreamFusionPreset extends Preset {
  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.EASYDEBRID_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.OFFCLOUD_SERVICE,
      constants.PIKPAK_SERVICE,
    ];

    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'StreamFusion',
        supportedResources,
        appConfig.presets.streamfusion.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      {
        id: 'streamFusionApiKey',
        name: 'StreamFusion API Key',
        description:
          'The API key for the StreamFusion service. You can get it by sending the `/generate` command to the [StremioFR Telegram bot](https://t.me/Stremiofr_bot)',
        type: 'password',
        required: true,
      },
      {
        id: 'torrentProviders',
        name: 'Torrent Providers',
        description: 'Which torrent providers to use',
        type: 'multi-select',
        options: [
          {
            label: 'Public Cache Server',
            value: 'publicCacheServer',
          },
          {
            label: 'Zilean API',
            value: 'zilean',
          },
        ],
        default: ['publicCacheServer', 'zilean'],
      },
      {
        id: 'catalogs',
        name: 'Catalogs',
        description: 'What catalogs should be displayed',
        type: 'multi-select',
        required: false,
        options: [
          {
            value: 'yggtorrent',
            label: 'YggTorrent',
          },
          {
            value: 'yggflix',
            label: 'YggFlix',
          },
        ],
        default: ['yggtorrent'],
      },
      {
        id: 'torrenting',
        name: 'Torrenting',
        description:
          "Use direct torrent streaming instead of debrid. If you haven't provided any debrid SERVICES, torrenting is automatically used and this option does not apply to you.",
        type: 'boolean',
        required: false,
        default: false,
        showInSimpleMode: false,
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
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/Telkaoss/stream-fusion',
          },
          { id: 'discord', url: 'https://discord.gg/ZhWvKVmTuh' },
        ],
      },
    ];

    return {
      ID: 'streamfusion',
      NAME: 'StreamFusion',
      LOGO: 'https://stream-fusion.stremiofr.com/static/logo-stream-fusion.png',
      URL: appConfig.presets.streamfusion.url,
      TIMEOUT:
        appConfig.presets.streamfusion.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.streamfusion.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'Stremio addon focusing on french content',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.DEBRID_STREAM_TYPE,
        constants.P2P_STREAM_TYPE,
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

    const usableServices =
      this.getUsableServices(userData, options.services) || [];

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
    serviceIds: ServiceId[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      identifier:
        serviceIds.length > 0
          ? serviceIds.length > 1
            ? 'multi'
            : constants.SERVICE_DETAILS[serviceIds[0]].shortName
          : 'p2p',
      displayIdentifier:
        serviceIds.length > 0
          ? serviceIds.length > 1
            ? serviceIds
                .map((id) => constants.SERVICE_DETAILS[id].shortName)
                .join(' | ')
            : constants.SERVICE_DETAILS[serviceIds[0]].shortName
          : 'P2P',
      manifestUrl: this.generateManifestUrl(userData, options, serviceIds),
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
    serviceIds: ServiceId[]
  ) {
    let url = options.url || this.DEFAULT_URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }

    const specialCases = {
      [constants.OFFCLOUD_SERVICE]: (credentials: any) =>
        `${credentials.email}:${credentials.password}`,
      [constants.PIKPAK_SERVICE]: (credentials: any) =>
        `${credentials.email}:${credentials.password}`,
    };

    url = url.replace(/\/$/, '');
    const torrentProviders = options.torrentProviders ?? [
      'zilean',
      'publicCacheServer',
    ];
    const configString = this.base64EncodeJSON({
      addonHost: options.url ? new URL(options.url).origin : this.DEFAULT_URL,
      apiKey: options.streamFusionApiKey,
      service: serviceIds.map(
        (serviceId) => constants.SERVICE_DETAILS[serviceId].name
      ),
      // this probably doesnt work for RD and AD as configuration page uses oauth flow and puts json response from RD/AD as values.
      RDToken: serviceIds.includes(constants.REALDEBRID_SERVICE)
        ? this.getServiceCredential(constants.REALDEBRID_SERVICE, userData)
        : '',
      ADToken: serviceIds.includes(constants.ALLDEBRID_SERVICE)
        ? this.getServiceCredential(constants.ALLDEBRID_SERVICE, userData)
        : '',
      TBToken: serviceIds.includes(constants.TORBOX_SERVICE)
        ? this.getServiceCredential(constants.TORBOX_SERVICE, userData)
        : '',
      PMToken: serviceIds.includes(constants.PREMIUMIZE_SERVICE)
        ? this.getServiceCredential(constants.PREMIUMIZE_SERVICE, userData)
        : '',
      debridlinkApiKey: serviceIds.includes(constants.DEBRIDLINK_SERVICE)
        ? this.getServiceCredential(constants.DEBRIDLINK_SERVICE, userData)
        : '',
      easydebridApiKey: serviceIds.includes(constants.EASYDEBRID_SERVICE)
        ? this.getServiceCredential(constants.EASYDEBRID_SERVICE, userData)
        : '',
      offcloudCredentials: serviceIds.includes(constants.OFFCLOUD_SERVICE)
        ? this.getServiceCredential(
            constants.OFFCLOUD_SERVICE,
            userData,
            specialCases
          )
        : '',
      pikpakCredentials: serviceIds.includes(constants.PIKPAK_SERVICE)
        ? this.getServiceCredential(
            constants.PIKPAK_SERVICE,
            userData,
            specialCases
          )
        : '',
      TBUsenet: false,
      TBSearch: false,
      maxSize: 150,
      exclusionKeywords: [],
      languages: ['en', 'fr', 'multi', 'vfq'],
      sort: 'quality',
      resultsPerQuality: 30,
      maxResults: 100,
      minCachedResults: 10,
      exclusion: [],
      cacheUrl: 'https://stremio-jackett-cacher.elfhosted.com/',
      cache: torrentProviders.includes('publicCacheServer'),
      zilean: torrentProviders.includes('zilean'),
      yggflix: true,
      sharewood: true,
      yggtorrentCtg: options.catalogs?.includes('yggtorrent') ?? false,
      yggflixCtg: options.catalogs?.includes('yggflix') ?? false,
      torrenting:
        serviceIds.length === 0 ? true : (options.torrenting ?? false),
      debrid: serviceIds.length > 0,
      metadataProvider: 'tmdb',
      debridDownloader:
        serviceIds.length > 0
          ? constants.SERVICE_DETAILS[serviceIds[0]].name
          : '',
      stremthru: true,
    });

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
