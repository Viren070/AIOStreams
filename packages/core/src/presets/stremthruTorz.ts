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
import { StremThruPreset, StremThruStreamParser } from './stremthru.js';

class StremthruTorzStreamParser extends StremThruStreamParser {
  protected override applyUrlModifications(
    url: string | undefined
  ): string | undefined {
    if (!url) {
      return url;
    }
    if (
      Env.FORCE_STREMTHRU_TORZ_HOSTNAME !== undefined ||
      Env.FORCE_STREMTHRU_TORZ_PORT !== undefined ||
      Env.FORCE_STREMTHRU_TORZ_PROTOCOL !== undefined
    ) {
      // modify the URL according to settings, needed when using a local URL for requests but a public stream URL is needed.
      const urlObj = new URL(url);

      if (Env.FORCE_STREMTHRU_TORZ_PROTOCOL !== undefined) {
        urlObj.protocol = Env.FORCE_STREMTHRU_TORZ_PROTOCOL;
      }
      if (Env.FORCE_STREMTHRU_TORZ_PORT !== undefined) {
        urlObj.port = Env.FORCE_STREMTHRU_TORZ_PORT.toString();
      }
      if (Env.FORCE_STREMTHRU_TORZ_HOSTNAME !== undefined) {
        urlObj.hostname = Env.FORCE_STREMTHRU_TORZ_HOSTNAME;
      }
      return urlObj.toString();
    }
    return super.applyUrlModifications(url);
  }
}

export class StremthruTorzPreset extends StremThruPreset {
  static override getParser(): typeof StreamParser {
    return StremthruTorzStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'StremThru Torz',
        supportedResources,
        Env.DEFAULT_STREMTHRU_STORE_TIMEOUT,
        Env.STREMTHRU_TORZ_URL
      ),
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInNoobMode: false,
        options: StremThruPreset.supportedServices.map((service) => ({
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
          'Use this option when you want to include P2P results even when using a debrid service. If left unchecked, then P2P results will not be fetched when using a debrid service.',
        type: 'boolean',
        default: false,
        showInNoobMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'StremThru Torz supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInNoobMode: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: StremThruPreset.socialLinks,
      },
    ];

    return {
      ID: 'stremthruTorz',
      NAME: 'StremThru Torz',
      LOGO: 'https://emojiapi.dev/api/v1/sparkles/256.png',
      URL: Env.STREMTHRU_TORZ_URL[0],
      TIMEOUT: Env.DEFAULT_STREMTHRU_TORZ_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_STREMTHRU_TORZ_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'Access a crowdsourced torrent library supplemented by DMM hashlists',
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
    // Handle custom manifest URL
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, [])];
    }

    const usableServices = this.getUsableServices(userData, options.services);
    let serviceIds: (ServiceId | 'p2p')[] =
      usableServices?.map((s) => s.id) || [];

    // If no services available, return single P2P addon
    if (serviceIds.length === 0) {
      return [this.generateAddon(userData, options, ['p2p'])];
    }

    // Add P2P if requested
    if (options.includeP2P) {
      serviceIds.push('p2p');
    }

    const addons: Addon[] = [];

    if (options.useMultipleInstances) {
      // Generate separate addon for each service (including P2P if present)
      addons.push(
        ...serviceIds.map((serviceId) =>
          this.generateAddon(userData, options, [serviceId])
        )
      );
    } else {
      // P2P always gets its own addon
      if (serviceIds.includes('p2p')) {
        addons.push(this.generateAddon(userData, options, ['p2p']));
      }

      // Generate combined addon with all non-P2P services
      const nonP2PServices = serviceIds.filter((id) => id !== 'p2p');
      if (nonP2PServices.length > 0) {
        addons.push(this.generateAddon(userData, options, nonP2PServices));
      }
    }

    return addons;
  }
  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    serviceIds: (ServiceId | 'p2p')[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      displayIdentifier: serviceIds
        .map((id) => this.getServiceDetails(id).shortName)
        .join(' | '),
      identifier:
        serviceIds.length > 0
          ? serviceIds.includes('p2p')
            ? 'p2p'
            : serviceIds.length > 1
              ? 'multi'
              : this.getServiceDetails(serviceIds[0]).code
          : undefined,
      manifestUrl: this.generateManifestUrl(userData, options, serviceIds),
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
    serviceIds: (ServiceId | 'p2p')[]
  ): string {
    // If URL already points to manifest.json, return as-is
    let baseUrl = options.url || this.METADATA.URL;
    if (baseUrl.endsWith('/manifest.json')) {
      return baseUrl;
    }

    // Normalize URL by removing trailing slash
    baseUrl = baseUrl.replace(/\/$/, '');

    // Generate configuration string
    const configString = this.generateConfigString(serviceIds, userData);

    // Build final manifest URL
    return `${baseUrl}${configString ? '/' + configString : ''}/manifest.json`;
  }

  private static generateConfigString(
    serviceIds: (ServiceId | 'p2p')[],
    userData: UserData
  ): string {
    const storeConfigs = serviceIds.map((serviceId) =>
      this.createStoreConfig(serviceId, userData)
    );

    return this.base64EncodeJSON({ stores: storeConfigs });
  }

  private static createStoreConfig(
    serviceId: ServiceId | 'p2p',
    userData: UserData
  ): { c: string; t: string } {
    return {
      c: this.getServiceDetails(serviceId).code,
      t: this.getServiceToken(serviceId, userData),
    };
  }

  private static getServiceDetails(serviceId: ServiceId | 'p2p'): {
    code: string;
    shortName: string;
  } {
    if (serviceId === 'p2p') {
      return { code: 'p2p', shortName: 'P2P' };
    }

    if (serviceId === constants.PIKPAK_SERVICE) {
      return { code: 'pp', shortName: 'PKP' };
    }

    return {
      code: constants.SERVICE_DETAILS[serviceId].shortName.toLowerCase(),
      shortName: constants.SERVICE_DETAILS[serviceId].shortName,
    };
  }

  private static getServiceToken(
    serviceId: ServiceId | 'p2p',
    userData: UserData
  ): string {
    if (serviceId === 'p2p') {
      return '';
    }

    return this.getServiceCredential(serviceId, userData);
  }
}
