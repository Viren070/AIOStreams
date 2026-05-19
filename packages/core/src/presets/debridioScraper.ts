import { Addon, Option, UserData, Resource, Stream } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { SERVICE_DETAILS } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { StreamParser } from '../parser/index.js';
import {
  debridioSocialOption,
  debridioLogo,
  debridioApiKeyOption,
} from './debridio.js';

export class DebridioPreset extends Preset {
  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.TORBOX_SERVICE,
      constants.EASYDEBRID_SERVICE,
      constants.DEBRIDER_SERVICE,
    ];
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Debridio Scraper',
        supportedResources,
        appConfig.presets.debridio.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      debridioApiKeyOption,
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
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
        default: [],
        showInSimpleMode: false,
      },
      debridioSocialOption,
    ];

    return {
      ID: 'debridio',
      NAME: 'Debridio Scraper',
      LOGO: debridioLogo,
      URL: appConfig.presets.debridio.url,
      TIMEOUT:
        appConfig.presets.debridio.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.debridio.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'Torrent streaming using Debrid providers.',
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
      return [this.generateAddon(userData, options)];
    }

    if (!options.debridioApiKey) {
      throw new Error(
        `${this.METADATA.NAME} requires a Debridio API Key, please provide one in the configuration`
      );
    }

    const usableServices = this.getUsableServices(userData, options.services);

    // if no services are usable, return a single addon with no services
    if (!usableServices || usableServices.length === 0) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one of the following services to be enabled: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    return usableServices.map((service) =>
      this.generateAddon(userData, options, service.id)
    );
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    service?: ServiceId
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      displayIdentifier: service
        ? `${constants.SERVICE_DETAILS[service].shortName}`
        : 'custom',
      identifier: service
        ? `${constants.SERVICE_DETAILS[service].shortName}`
        : 'custom',
      manifestUrl: this.generateManifestUrl(userData, options, service),
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
    service?: ServiceId
  ) {
    const url = options?.url || this.DEFAULT_URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    if (!service) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one of the following services to be enabled: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    const configString = this.base64EncodeJSON({
      api_key: options.debridioApiKey,
      provider: service,
      providerKey: this.getServiceCredential(service, userData),
      disableUncached: false,
      maxSize: '',
      maxReturnPerQuality: '',
      resolutions: ['4k', '1440p', '1080p', '720p', '480p', '360p', 'unknown'],
      excludedQualities: [],
    });

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
