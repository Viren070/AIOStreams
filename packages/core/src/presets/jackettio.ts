import { Addon, Option, UserData, Resource } from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { Env } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';
import { StremThruPreset } from './stremthru.js';

class JackettioStreamParser extends StreamParser {
  override applyUrlModifications(url: string | undefined): string | undefined {
    if (!url) {
      return url;
    }
    if (
      Env.FORCE_JACKETTIO_HOSTNAME !== undefined ||
      Env.FORCE_JACKETTIO_PORT !== undefined ||
      Env.FORCE_JACKETTIO_PROTOCOL !== undefined
    ) {
      // modify the URL according to settings, needed when using a local URL for requests but a public stream URL is needed.
      const urlObj = new URL(url);

      if (Env.FORCE_JACKETTIO_PROTOCOL !== undefined) {
        urlObj.protocol = Env.FORCE_JACKETTIO_PROTOCOL;
      }
      if (Env.FORCE_JACKETTIO_PORT !== undefined) {
        urlObj.port = Env.FORCE_JACKETTIO_PORT.toString();
      }
      if (Env.FORCE_JACKETTIO_HOSTNAME !== undefined) {
        urlObj.hostname = Env.FORCE_JACKETTIO_HOSTNAME;
      }
      return urlObj.toString();
    }
    return super.applyUrlModifications(url);
  }
}

export class JackettioPreset extends StremThruPreset {
  static override getParser(): typeof StreamParser {
    return JackettioStreamParser;
  }

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
        Env.DEFAULT_JACKETTIO_TIMEOUT,
        Env.JACKETTIO_URL
      ),
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
      URL: Env.JACKETTIO_URL[0],
      TIMEOUT: Env.DEFAULT_JACKETTIO_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_JACKETTIO_USER_AGENT || Env.DEFAULT_USER_AGENT,
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
    let url = options.url || this.METADATA.URL;
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
      stremthruUrl: Env.DEFAULT_JACKETTIO_STREMTHRU_URL,
      qualities: [0, 360, 480, 720, 1080, 2160],
      indexers: Env.DEFAULT_JACKETTIO_INDEXERS,
    });

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
