import { Addon, Option, UserData, Resource, Stream } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, SERVICE_DETAILS } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

export class PeerflixPreset extends Preset {
  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.PUTIO_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.OFFCLOUD_SERVICE,
    ];
    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Peerflix',
        supportedResources,
        Env.DEFAULT_PEERFLIX_TIMEOUT
      ),
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
        showInNoobMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'When using multiple services, use a different Peerflix addon for each service, rather than using one instance for all services',
        type: 'boolean',
        default: false,
        required: true,
        showInNoobMode: false,
      },
      {
        id: 'showTorrentLinks',
        name: 'Show P2P Streams for Uncached torrents',
        description:
          'If enabled, the addon will show P2P streams for uncached torrents. This is useful for users who want to use the addon to stream torrents that are not cached by the debrid service.',
        type: 'boolean',
        default: false,
        showInNoobMode: false,
        required: true,
      },
    ];

    return {
      ID: 'peerflix',
      NAME: 'Peerflix',
      LOGO: `https://config.peerflix.mov/static/media/logo.28f42024a3538640d047201d05416a09.svg`,
      URL: Env.PEERFLIX_URL,
      TIMEOUT: Env.DEFAULT_PEERFLIX_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_PEERFLIX_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      REQUIRES_SERVICE: false,
      DESCRIPTION:
        'Provides Spanish and English streams to Movies and TV Shows.',
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

    const usableServices = this.getUsableServices(userData, options.services);

    // if no services are usable, return a single addon with no services
    if (!usableServices || usableServices.length === 0) {
      return [this.generateAddon(userData, options, [])];
    }

    // if user has specified useMultipleInstances, return a single addon for each service
    if (options?.useMultipleInstances) {
      return usableServices.map((service) =>
        this.generateAddon(userData, options, [service.id])
      );
    }

    // return a single addon with all usable services
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
    services: ServiceId[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      identifier:
        services.length > 0
          ? services.length > 1
            ? 'multi'
            : constants.SERVICE_DETAILS[services[0]].shortName
          : 'p2p',
      displayIdentifier:
        services.length > 0
          ? services.length > 1
            ? services
                .map((id) => constants.SERVICE_DETAILS[id].shortName)
                .join(' | ')
            : constants.SERVICE_DETAILS[services[0]].shortName
          : 'P2P',
      manifestUrl: this.generateManifestUrl(userData, services, options),
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
    services: ServiceId[],
    options: Record<string, any>
  ) {
    const url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }

    let configOptions = services.map((service) => [
      service,
      this.getServiceCredential(service, userData, {
        [constants.PUTIO_SERVICE]: (credentials: any) =>
          `${credentials.clientId}@${credentials.token}`,
      }),
    ]);

    if (options.showTorrentLinks) {
      configOptions.push(['debridOptions', 'torrentlinks']);
    }

    const configString = configOptions.length
      ? this.urlEncodeKeyValuePairs(configOptions)
      : '';

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
