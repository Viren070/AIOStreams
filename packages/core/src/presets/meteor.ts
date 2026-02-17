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

export class MeteorPreset extends Preset {
  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.DEBRIDER_SERVICE,
      constants.EASYDEBRID_SERVICE,
      constants.OFFCLOUD_SERVICE,
    ];

    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Meteor',
        supportedResources,
        Env.DEFAULT_METEOR_TIMEOUT,
        Env.METEOR_URL
      ),
      {
        id: 'includeP2P',
        name: 'Include P2P',
        description: 'Include P2P results, even if a debrid service is enabled',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'removeTrash',
        name: 'Remove Trash',
        description: 'Remove trash from results',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'When using multiple services, use a different Meteor addon for each service, rather than using one instance for all services',
        type: 'boolean',
        default: false,
        required: false,
        showInSimpleMode: false,
      },
      {
        id: 'services',
        name: 'Services',
        showInSimpleMode: false,
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
    ];

    return {
      ID: 'meteor',
      NAME: 'Meteor',
      LOGO: 'https://i.ibb.co/0V90bryY/image.png',
      URL: Env.METEOR_URL[0],
      TIMEOUT: Env.DEFAULT_METEOR_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_METEOR_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'Meteor is a Stremio addon for torrent and debrid streaming',
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
    if (!usableServices || usableServices.length === 0) {
      return [this.generateAddon(userData, options, [])];
    }

    let addedP2pAddon = false;
    if (options?.useMultipleInstances) {
      const instanceOptions = { ...options, includeP2P: false };
      if (options.includeP2P && !addedP2pAddon) {
        instanceOptions.includeP2P = true;
        addedP2pAddon = true;
      }
      const addons = usableServices.map((service) =>
        this.generateAddon(userData, instanceOptions, [service.id])
      );
      return addons;
    }

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
      displayIdentifier: services
        .map((id) => constants.SERVICE_DETAILS[id].shortName)
        .join(' | '),
      identifier:
        services.length > 0
          ? services.length > 1
            ? 'multi'
            : constants.SERVICE_DETAILS[services[0]].shortName
          : options.url?.endsWith('/manifest.json')
            ? undefined
            : 'p2p',
      manifestUrl: this.generateManifestUrl(userData, options, services),
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
    services: ServiceId[]
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');

    const debridServices: { service: string; apiKey: string }[] = services.map(
      (serviceId) => ({
        service: serviceId,
        apiKey: this.getServiceCredential(serviceId, userData),
      })
    );

    // When includeP2P is enabled, add a torrent service entry to tell Meteor to include P2P results
    if (options.includeP2P) {
      debridServices.push({ service: 'torrent', apiKey: '' });
    }

    const configString = this.base64EncodeJSON({
      ...(debridServices.length > 0 && { debridServices }),
      cachedOnly: false,
      removeTrash: options.removeTrash ?? false,
      removeSamples: false,
      removeAdult: false,
      exclude3D: false,
      enableSeaDex: false,
      minSeeders: 0,
      maxResults: 0,
      maxResultsPerRes: 0,
      maxSize: 0,
      resolutions: [],
      languages: { preferred: [], required: [], exclude: [] },
      resultFormat: ['title', 'quality', 'size', 'audio'],
      sortOrder: [
        'pack',
        'cached',
        'seadex',
        'resolution',
        'size',
        'quality',
        'seeders',
        'language',
      ],
    });

    return `${url}/${configString}/manifest.json`;
  }
}
