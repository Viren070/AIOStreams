import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { Env, ServiceId, constants } from '../utils/index.js';
import { BuiltinAddonPreset, BuiltinStreamParser } from './builtin.js';

/**
 * Custom parser for Easynews streams that extracts duration
 */
export class EasynewsStreamParser extends BuiltinStreamParser {
  protected override getDuration(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    if (typeof (stream as any).duration === 'number') {
      return (stream as any).duration * 1000;
    }
    return undefined;
  }

  protected override getAge(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    if (typeof stream.age === 'number') {
      return stream.age;
    }
    return undefined;
  }
}

export class EasynewsSearchPreset extends BuiltinAddonPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const supportedServices = [
      constants.TORBOX_SERVICE,
      constants.NZBDAV_SERVICE,
      constants.ALTMOUNT_SERVICE,
      constants.STREMIO_NNTP_SERVICE,
      constants.EASYNEWS_SERVICE,
      constants.STREMTHRU_NEWZ_SERVICE,
    ] as ServiceId[];

    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Easynews Search',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        default: Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
          forceInUi: false,
        },
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: [],
        options: [
          {
            label: 'Movie',
            value: 'movie',
          },
          {
            label: 'Series',
            value: 'series',
          },
          {
            label: 'Anime',
            value: 'anime',
          },
        ],
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
        id: 'aiostreamsAuth',
        name: 'AIOStreams Auth',
        description:
          Env.NZB_PROXY_EASYNEWS_ENABLED === false
            ? 'You must provide a valid `username:password` from `AIOSTREAMS_AUTH` to use Easynews Search with all services except Easynews.'
            : 'Optionally provide a valid `username:password` `from AIOSTREAMS_AUTH` to bypass NZB limits when using Easynews Search with non-Easynews services.',
        type: 'password',
        required: false,
      },
      {
        id: 'paginate',
        name: 'Paginate Results',
        description:
          'Easynews limits results per page. Enabling this option will make the addon paginate through all available results to provide a more comprehensive set of results. This can increase the time taken to return results.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'Easynews supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'easynews-search',
      NAME: 'Easynews Search',
      LOGO: '/assets/easynews_logo.png',
      URL: `${Env.INTERNAL_URL}/builtins/easynews`,
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'Search and stream content directly from your Easynews account.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  static override getParser() {
    return EasynewsStreamParser;
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

    if (usableServices.some((s) => s.id !== constants.EASYNEWS_SERVICE))
      if (!options.aiostreamsAuth && Env.NZB_PROXY_EASYNEWS_ENABLED === false) {
        throw new Error(
          `${this.METADATA.NAME} requires the AIOStreams Auth option on this instance in order to use it with the following services: ${usableServices
            .filter((s) => s.id !== constants.EASYNEWS_SERVICE)
            .map((s) => constants.SERVICE_DETAILS[s.id].name)
            .join(
              ', '
            )}. Either explicitly set ${this.METADATA.NAME} to only use Easynews as a service, or provide a username:password pair.`
        );
      }

    return options.useMultipleInstances
      ? usableServices.map((service) =>
          this.generateAddon(userData, options, [service.id])
        )
      : [
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
      library: options.libraryAddon ?? false,
      resources: options.resources || undefined,
      mediaTypes: options.mediaTypes || [],
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      formatPassthrough:
        options.formatPassthrough ?? options.streamPassthrough ?? false,
      resultPassthrough: options.resultPassthrough ?? false,
      forceToTop: options.forceToTop ?? false,
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  protected static generateManifestUrl(
    userData: UserData,
    services: ServiceId[],
    options: Record<string, any>
  ) {
    const easynewsCreds = this.getServiceCredential(
      constants.EASYNEWS_SERVICE,
      userData
    );
    if (!easynewsCreds) {
      throw new Error(
        `${this.METADATA.NAME} requires the Easynews service to be enabled.`
      );
    }
    const config = {
      ...this.getBaseConfig(userData, services),
      authentication: easynewsCreds,
      paginate: options.paginate ?? false,
      aiostreamsAuth: options.aiostreamsAuth || undefined,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.METADATA.URL}/${configString}/manifest.json`;
  }
}
