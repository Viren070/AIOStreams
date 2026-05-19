import { Addon, Option, UserData, Resource } from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { constants, ServiceId } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { StreamParser } from '../parser/index.js';
import { StremThruPreset } from './stremthru.js';

export class JackettioPreset extends StremThruPreset {
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

    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Jackettio',
        supportedResources,
        appConfig.presets.jackettio.defaultTimeout ??
          appConfig.presets.defaultTimeout,
        appConfig.presets.jackettio.url ?? undefined
      ),
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
          { id: 'github', url: 'https://github.com/Telkaoss/jackettio' },
        ],
      },
    ];

    return {
      ID: 'jackettio',
      NAME: 'Jackettio',
      LOGO: 'https://raw.githubusercontent.com/Jackett/Jackett/bbea5febd623f6e536e11aa1fa8d6674d8d4043f/src/Jackett.Common/Content/jacket_medium.png',
      URL: appConfig.presets.jackettio.url,
      TIMEOUT:
        appConfig.presets.jackettio.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.jackettio.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'Stremio addon that resolves streams using Jackett and Debrid',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, undefined)];
    }

    const usableServices = this.getUsableServices(userData, options.services);
    if (!usableServices || usableServices.length === 0) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one usable service from the list of supported services: ${this.METADATA.SUPPORTED_SERVICES.map((service) => constants.SERVICE_DETAILS[service].name).join(', ')}`
      );
    }

    let addons = usableServices.map((service) =>
      this.generateAddon(userData, options, service.id)
    );

    return addons;
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    serviceId?: ServiceId
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      identifier: serviceId
        ? `${constants.SERVICE_DETAILS[serviceId].shortName}`
        : undefined, // when no service is provided - its either going to fail or be a custom addon, which is only 1 addon in either case
      displayIdentifier: serviceId
        ? `${constants.SERVICE_DETAILS[serviceId].shortName}`
        : undefined,
      manifestUrl: this.generateManifestUrl(userData, options, serviceId),
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
    serviceId: ServiceId | undefined
  ) {
    let url = options.url || this.DEFAULT_URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    if (!serviceId) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one usable service from the list of supported services: ${this.METADATA.SUPPORTED_SERVICES.map((service) => constants.SERVICE_DETAILS[service].name).join(', ')}`
      );
    }
    url = url.replace(/\/$/, '');
    const configString = this.base64EncodeJSON({
      maxTorrents: 30,
      priotizePackTorrents: 2,
      excludeKeywords: [],
      debridId: serviceId,
      debridApiKey: this.getServiceCredential(serviceId, userData),
      hideUncached: false,
      sortCached: [
        ['quality', true],
        ['size', true],
      ],
      sortUncached: [['seeders', true]],
      forceCacheNextEpisode: false,
      priotizeLanguages: [],
      indexerTimeoutSec: 60,
      metaLanguage: '',
      enableMediaFlow: false,
      mediaflowProxyUrl: '',
      mediaflowApiPassword: '',
      mediaflowPublicIp: '',
      useStremThru: true,
      stremthruUrl: appConfig.presets.jackettio.defaultStremthruUrl,
      qualities: [0, 360, 480, 720, 1080, 2160],
      indexers: appConfig.presets.jackettio.defaultIndexers,
    });

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
