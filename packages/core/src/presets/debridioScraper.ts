import {
  Addon,
  Option,
  ParsedStream,
  UserData,
  Resource,
  Stream,
} from '../db/index.js';
import { Preset, baseOptions, StreamResponseHookOptions } from './preset.js';
import { SERVICE_DETAILS } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { StreamParser } from '../parser/index.js';
import {
  debridioSocialOption,
  debridioLogo,
  debridioApiKeyOption,
} from './debridio.js';
import { toDebridioP2PStream } from './debridio-p2p.js';

type DebridioPresetOptions = {
  p2pFallback?: boolean;
  p2pMode?: boolean;
};

class DebridioStreamParser extends StreamParser {
  protected override get indexerRegex(): RegExp | undefined {
    return undefined;
  }

  protected override getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    if (stream.infoHash && !stream.url) return undefined;
    return super.getService(stream, currentParsedStream);
  }

  protected override getIndexer(): string {
    return 'Debridio';
  }
}

export class DebridioPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return DebridioStreamParser;
  }

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
      {
        id: 'p2pFallback',
        name: 'P2P Mode When No Debrid Is Enabled',
        description:
          'When zero supported debrid services are enabled, return every Debridio result as a standard torrent info-hash stream for P2P-only apps. If any debrid is enabled, Debridio remains fully debrid-only. Playing P2P streams exposes your IP to peers; use a VPN if you play them.',
        type: 'boolean',
        required: false,
        default: true,
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
    const enabledServices = (userData.services || []).filter(
      (service) =>
        this.METADATA.SUPPORTED_SERVICES.includes(service.id) &&
        service.enabled &&
        service.credentials
    );

    if (options?.url?.endsWith('/manifest.json')) {
      return [
        this.generateAddon(userData, {
          ...options,
          p2pMode:
            options.p2pFallback !== false && enabledServices.length === 0,
        }),
      ];
    }

    if (!options.debridioApiKey) {
      throw new Error(
        `${this.METADATA.NAME} requires a Debridio API Key, please provide one in the configuration`
      );
    }

    if (enabledServices.length === 0 && options.p2pFallback !== false) {
      const preferredServices: ServiceId[] = options.services?.length
        ? options.services
        : this.METADATA.SUPPORTED_SERVICES;
      const scrapeService = preferredServices
        .map((serviceId) =>
          (userData.services || []).find(
            (service) =>
              service.id === serviceId && Boolean(service.credentials)
          )
        )
        .find((service) => Boolean(service));
      if (!scrapeService) {
        throw new Error(
          `${this.METADATA.NAME} P2P mode needs the stored credentials of a supported debrid service for Debridio's scraper API. The service may remain disabled.`
        );
      }
      return [
        this.generateAddon(
          userData,
          { ...options, p2pMode: true },
          scrapeService.id
        ),
      ];
    }

    const usableServices = this.getUsableServices(
      userData,
      options.services,
      options.name
    );

    // if no services are usable, return a single addon with no services
    if (!usableServices || usableServices.length === 0) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one of the following services to be enabled: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    return usableServices.map((service) =>
      this.generateAddon(userData, { ...options, p2pMode: false }, service.id)
    );
  }

  static override async transformStreamResponse({
    addon,
    streams,
  }: StreamResponseHookOptions): Promise<Stream[]> {
    const options = (addon.preset.options || {}) as DebridioPresetOptions;
    if (!options.p2pMode) return streams;
    return streams.map(toDebridioP2PStream);
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    service?: ServiceId
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      displayIdentifier: options.p2pMode
        ? 'P2P'
        : service
          ? `${constants.SERVICE_DETAILS[service].shortName}`
          : 'custom',
      identifier: options.p2pMode
        ? 'p2p'
        : service
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
