import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import StreamParser from '../parser/streams.js';
import { Env, constants, ServiceId } from '../utils/index.js';
import { BuiltinAddonPreset, BuiltinStreamParser } from './builtin.js';
import { StremThruPreset } from './stremthru.js';

class LibraryStreamParser extends BuiltinStreamParser {
  protected isInfoStream(stream: Stream): string | undefined {
    if (stream.name?.startsWith('🔄')) {
      return stream.name.replace('🔄', '').trim();
    }
  }
}

export class LibraryPreset extends BuiltinAddonPreset {
  static override getParser(): typeof StreamParser {
    return LibraryStreamParser;
  }
  public static readonly supportedServices: ServiceId[] = [
    ...StremThruPreset.supportedServices,
    constants.NZBDAV_SERVICE,
    constants.ALTMOUNT_SERVICE,
  ];

  static override get METADATA() {
    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Library',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default: Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
          forceInUi: false,
        },
      },
      {
        id: 'resources',
        name: 'Resources',
        description: 'Optionally override the resources to use',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        emptyIsUndefined: true,
        default: supportedResources,
        options: supportedResources.map((resource) => ({
          label: constants.RESOURCE_LABELS[resource],
          value: resource,
        })),
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: LibraryPreset.supportedServices.map((service) => ({
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
        id: 'sources',
        name: 'Sources',
        description:
          'Limit which source types the library addon uses. If left empty, both torrent and NZB sources are used.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          { label: 'Torrent', value: 'torrent' },
          { label: 'NZB', value: 'nzb' },
        ],
        default: [],
        emptyIsUndefined: true,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'When using multiple services, use a different Library addon for each service, rather than using one instance for all services',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'skipProcessing',
        name: 'Skip Processing',
        description:
          'Skip file selection processing for stream requests. When enabled, matching library items are returned directly without running the full processing pipeline. This is faster but may not pick the best file in multi-file torrents.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'showRefreshActions',
        name: 'Show Refresh Actions',
        description:
          'Where to show the "Refresh Library" action. "Catalog" adds it as a genre filter in the catalog, "Stream" adds a refresh stream to stream results.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          { value: 'catalog', label: 'Catalog' },
          { value: 'stream', label: 'Stream' },
        ],
        default: ['catalog'],
      },
    ];

    return {
      ID: 'library',
      NAME: 'Library',
      LOGO: '',
      URL: `${Env.INTERNAL_URL}/builtins/library`,
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: LibraryPreset.supportedServices,
      DESCRIPTION:
        'Browse and stream from your service library. View all items via catalogs, or automatically match items for the content you are viewing.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.DEBRID_STREAM_TYPE,
        constants.USENET_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const usableServices = this.getUsableServices(userData, options.services);
    if (!usableServices || usableServices.length === 0) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one usable service, but none were found. Please enable at least one of the following services: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    if (options.useMultipleInstances) {
      return usableServices.map((service) =>
        this.generateAddon(userData, options, [service.id])
      );
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
      manifestUrl: this.generateManifestUrl(userData, services, options),
      identifier:
        services.length > 1
          ? 'multi'
          : constants.SERVICE_DETAILS[services[0]].shortName,
      displayIdentifier: services
        .map((id) => constants.SERVICE_DETAILS[id].shortName)
        .join(' | '),
      enabled: true,
      library: true,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      mediaTypes: options.mediaTypes || [],
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

  protected static generateManifestUrl(
    userData: UserData,
    services: ServiceId[],
    options?: Record<string, any>
  ): string {
    const config: Record<string, any> = {
      ...this.getBaseConfig(userData, services),
    };
    if (options?.sources && options.sources.length > 0) {
      config.sources = options.sources;
    }

    if (options?.skipProcessing) {
      (config as any).skipProcessing = true;
    }
    if (options?.showRefreshActions) {
      (config as any).showRefreshActions = options.showRefreshActions;
    }
    return `${Env.INTERNAL_URL}/builtins/library/${this.base64EncodeJSON(
      config,
      'urlSafe'
    )}/manifest.json`;
  }
}
