import { Addon, Option, UserData, Resource } from '../db';
import { baseOptions, Preset } from './preset';
import { Env } from '../utils';
import { constants, ServiceId } from '../utils';
import { StreamParser } from '../parser';

class CometStreamParser extends StreamParser {
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
    return url;
  }
}

export class CometPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return CometStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLEDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.EASYDEBRID_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.OFFCLOUD_SERVICE,
      constants.PIKPAK_SERVICE,
    ];

    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions('Comet', supportedResources, Env.DEFAULT_COMET_TIMEOUT),
      {
        id: 'includeP2P',
        name: 'Include P2P',
        description: 'Include P2P results, even if a debrid service is enabled',
        type: 'boolean',
        default: false,
      },
      {
        id: 'removeTrash',
        name: 'Remove Trash',
        description:
          'Remove all trash from results (Adult Content, CAM, Clean Audio, PDTV, R5, Screener, Size, Telecine and Telesync)',
        type: 'boolean',
        default: true,
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
      LOGO: 'https://i.imgur.com/jmVoVMu.jpeg',
      URL: Env.COMET_URL,
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
    // url can either be something like https://torrentio.com/ or it can be a custom manifest url.
    // if it is a custom manifest url, return a single addon with the custom manifest url.
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, undefined)];
    }

    const usableServices = this.getUsableServices(userData, options.services);
    // if no services are usable, use p2p
    if (!usableServices || usableServices.length === 0) {
      return [this.generateAddon(userData, options, undefined)];
    }

    let addons = usableServices.map((service) =>
      this.generateAddon(userData, options, service.id)
    );

    if (options.includeP2P) {
      addons.push(this.generateAddon(userData, options, undefined));
    }

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
        : options.url?.endsWith('/manifest.json')
          ? undefined
          : 'p2p',
      manifestUrl: this.generateManifestUrl(userData, options, serviceId),
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
    options: Record<string, any>,
    serviceId: ServiceId | undefined
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');
    const configString = this.base64EncodeJSON({
      maxResultsPerResolution: 0,
      maxSize: 0,
      cachedOnly: false,
      removeTrash: options.removeTrash ?? true,
      resultFormat: ['all'],
      debridService: serviceId || 'torrent',
      debridApiKey: serviceId
        ? this.getServiceCredential(serviceId, userData, {
            [constants.OFFCLOUD_SERVICE]: (credentials: any) =>
              `${credentials.email}:${credentials.password}`,
            [constants.PIKPAK_SERVICE]: (credentials: any) =>
              `${credentials.email}:${credentials.password}`,
          })
        : '',
      debridStreamProxyPassword: '',
      languages: { required: [], exclude: [], preferred: [] },
      resolutions: {},
      options: {
        remove_ranks_under: -10000000000,
        allow_english_in_languages: false,
        remove_unknown_languages: false,
      },
    });

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
