import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
} from '../db/index.js';
import { baseOptions } from './preset.js';
import { Env, SERVICE_DETAILS } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';
import { StremThruPreset } from './stremthru.js';

export class TorboxSearchParser extends StreamParser {
  override getFolder(stream: Stream): string | undefined {
    if (!stream.description) {
      return undefined;
    }
    const folderName = stream.description.split('\n')[0];
    return folderName.trim() || undefined;
  }

  protected getError(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['error'] | undefined {
    if (stream.name?.startsWith('[❌]')) {
      return {
        title: stream.name.replace('[❌]', ''),
        description: stream.description || 'Unknown error',
      };
    }
    return undefined;
  }
  protected parseServiceData(
    string: string
  ): ParsedStream['service'] | undefined {
    return super.parseServiceData(string.replace('TorBox', ''));
  }

  protected getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    return stream.name?.includes('☁️') ?? false;
  }

  protected get ageRegex(): RegExp | undefined {
    return this.getRegexForTextAfterEmojis(['🕒']);
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return (stream as any).type === 'usenet' ? 'usenet' : 'debrid';
  }
}

export class TorBoxSearchPreset extends StremThruPreset {
  static override getParser(): typeof StreamParser {
    return TorboxSearchParser;
  }

  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      {
        id: 'alert',
        type: 'alert',
        name: 'Info',
        description: 'This addon requires a TorBox API Key to be provided',
      },
      ...baseOptions(
        'TorBox Search',
        supportedResources,
        Env.BUILTIN_TORBOX_SEARCH_TIMEOUT
      ).filter((option) => option.id !== 'url' && option.id !== 'resources'),
      {
        id: 'sources',
        name: 'Sources',
        description: 'Select the sources that are used.',
        type: 'multi-select',
        required: false,
        default: ['torrent'],
        options: [
          {
            value: 'torrent',
            label: 'Torrent',
          },
          {
            value: 'usenet',
            label: 'Usenet',
          },
        ],
        constraints: {
          min: 1,
        },
      },
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
        id: 'userSearchEngines',
        name: 'Use User Search Engines',
        description:
          'Whether to use the user search engines to search for torrents.',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'onlyShowUserSearchResults',
        name: 'Only Show User Search Results',
        description:
          'Whether to only show user search results. If not specified, then all results will be shown.',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'Use a different TorBox Search addon for each service when using multiple services, rather than using one instance for all services.',
        type: 'boolean',
        required: false,
        default: false,
      },
    ];

    return {
      ID: 'torbox-search',
      NAME: 'TorBox Search',
      LOGO: `https://torbox.app/android-chrome-512x512.png`,
      URL: `${Env.INTERNAL_URL}/builtins/torbox-search`,
      TIMEOUT: Env.BUILTIN_TORBOX_SEARCH_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.BUILTIN_TORBOX_SEARCH_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      REQUIRES_SERVICE: true,
      DESCRIPTION:
        'Unofficial debrid/usenet addon for the TorBox Search API, with support for multiple services.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.DEBRID_STREAM_TYPE,
        constants.USENET_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: [constants.STREAM_RESOURCE],
      BUILTIN: true,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const usableServices = this.getUsableServices(userData, options.services);

    // if no services are usable, return a single addon with no services
    if (!usableServices || usableServices.length === 0) {
      //   return [this.generateAddon(userData, options, [])];
      throw new Error(`${this.METADATA.NAME} requires at least one service`);
    }

    if (options.useMultipleInstances) {
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
      displayIdentifier: services
        .map((id) => constants.SERVICE_DETAILS[id].shortName)
        .join(' | '),
      identifier:
        services.length > 1
          ? 'multi'
          : constants.SERVICE_DETAILS[services[0]].shortName,
      manifestUrl: this.generateManifestUrl(userData, services, options),
      enabled: true,
      resources: this.METADATA.SUPPORTED_RESOURCES,
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
    let sources = options.sources;

    const torboxApiKey = userData.services?.find(
      (service) => service.id === constants.TORBOX_SERVICE
    )?.credentials.apiKey;
    if (!torboxApiKey) {
      throw new Error(`${this.METADATA.NAME} requires a TorBox API key`);
    }

    const config = {
      sources: sources,
      torBoxApiKey: torboxApiKey,
      searchUserEngines: options.userSearchEngines,
      tmdbAccessToken: userData.tmdbAccessToken,
      onlyShowUserSearchResults: options.onlyShowUserSearchResults ?? false,
      services: services.map((service) => ({
        id: service,
        credential: this.getServiceCredential(service, userData),
      })),
    };

    const configString = this.base64EncodeJSON(config);
    return `${this.METADATA.URL}/${configString}/manifest.json`;
  }
}
