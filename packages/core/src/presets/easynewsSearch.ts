import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { appConfig, ServiceId, constants } from '../utils/index.js';
import { BuiltinAddonPreset, BuiltinStreamParser } from './builtin.js';
import {
  mediaTypesOption,
  nameOption,
  paginateOption,
  servicesOption,
  timeoutOption,
  useMultipleInstancesOption,
} from './options.js';

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
      constants.AIOSTREAMS_SERVICE,
    ] as ServiceId[];

    const options: Option[] = [
      nameOption('Easynews Search'),
      { ...timeoutOption(), required: false },
      mediaTypesOption(),
      servicesOption(supportedServices),
      {
        id: 'aiostreamsAuth',
        name: 'AIOStreams Auth',
        description:
          'You must provide a valid `username:password` from `AIOSTREAMS_AUTH` to use Easynews Search with all services except Easynews.',
        type: 'password',
        required: false,
      },
      {
        id: 'apiVersion',
        name: 'Easynews API Version',
        description:
          'Which Easynews search API to use. Both return the same results, the same rich metadata (audio/subtitle languages, resolution, codecs), and both support direct Easynews playback. V3 returns a fixed 100 results per page but Easynews does not rate limit it, so pages are fetched in parallel. V2 returns up to 250 results per page, but Easynews only serves two of its requests at a time, making paginated searches much slower. If unsure, leave this as V3.',
        type: 'select',
        default: '3.0',
        showInSimpleMode: false,
        options: [
          { label: 'V3 (recommended)', value: '3.0' },
          { label: 'V2 (legacy)', value: '2.0' },
        ],
      },
      paginateOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'easynews-search',
      NAME: 'Easynews Search',
      LOGO: '/assets/easynews_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/easynews`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
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
    const easynewsService = userData.services?.find(
      (s) => s.id === constants.EASYNEWS_SERVICE
    );
    if (
      !easynewsService ||
      !easynewsService.credentials?.username ||
      !easynewsService.credentials?.password
    ) {
      throw new Error(
        `${this.METADATA.NAME} requires the Easynews service to be configured with a valid username and password. Please enter your Easynews username and password under Services.`
      );
    }

    const usableServices = this.getUsableServices(
      userData,
      options.services,
      options.name
    );
    if (!usableServices || usableServices.length === 0) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one usable service, but none were found. Please enable at least one of the following services: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    if (usableServices.some((s) => s.id !== constants.EASYNEWS_SERVICE))
      if (!options.aiostreamsAuth) {
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
      apiVersion: options.apiVersion ?? '3.0',
      aiostreamsAuth: options.aiostreamsAuth || undefined,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.DEFAULT_URL}/${configString}/manifest.json`;
  }
}
