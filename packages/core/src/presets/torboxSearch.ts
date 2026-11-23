import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
  PresetMetadata,
} from '../db/index.js';
import { baseOptions } from './preset.js';
import { appConfig } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';
import { BuiltinAddonPreset, BuiltinStreamParser } from './builtin.js';
import { StremThruPreset } from './stremthru.js';
import {
  mediaTypesOption,
  servicesOption,
  useMultipleInstancesOption,
} from './options.js';

export class TorBoxSearchPreset extends BuiltinAddonPreset {
  public static readonly supportedServices: ServiceId[] =
    StremThruPreset.supportedServices;

  static override getParser(): typeof StreamParser {
    return BuiltinStreamParser;
  }

  static override get METADATA(): PresetMetadata {
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
        appConfig.builtins.torboxSearch.timeout ??
          appConfig.presets.defaultTimeout
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
      servicesOption(TorBoxSearchPreset.supportedServices),
      mediaTypesOption(),
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
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'torbox-search',
      NAME: 'TorBox Search',
      LOGO: `https://torbox.app/android-chrome-512x512.png`,
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/torbox-search`],
      TIMEOUT:
        appConfig.builtins.torboxSearch.timeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.builtins.torboxSearch.userAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: TorBoxSearchPreset.supportedServices,
      DESCRIPTION:
        'Unofficial debrid/usenet addon for the TorBox Search API, with support for multiple services.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.DEBRID_STREAM_TYPE,
        constants.USENET_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: [constants.STREAM_RESOURCE],
      BUILTIN: true,
      DISABLED: {
        disabled: true,
        removed: true,
        reason:
          'The TorBox Search API that this addon relies on has been shut down, so this addon is no longer functional.',
      },
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const usableServices = this.getUsableServices(
      userData,
      options.services,
      options.name
    );

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
      mediaTypes: options.mediaTypes || [],
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
      ...this.getBaseConfig(userData, services),
      sources: sources,
      torBoxApiKey: torboxApiKey,
      searchUserEngines: options.userSearchEngines,
      onlyShowUserSearchResults: options.onlyShowUserSearchResults ?? false,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.DEFAULT_URL}/${configString}/manifest.json`;
  }
}
