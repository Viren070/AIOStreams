import { Addon, Option, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { appConfig, RESOURCES, ServiceId, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { BuiltinAddonPreset } from './builtin.js';
import {
  initialLimitOption,
  mediaTypesOption,
  nameOption,
  paginateOption,
  resolveForceQuerySearch,
  searchModeOption,
  seasonEpisodeStrategyOption,
  servicesOption,
  timeoutOption,
  useMultipleInstancesOption,
} from './options.js';

export class TorznabPreset extends BuiltinAddonPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      nameOption('Torznab'),
      {
        id: 'api',
        name: 'Torznab Endpoint',
        description: '',
        type: 'nab-endpoint',
        nab: { namespace: 'torznab', preset: 'torznab' },
        required: true,
        subOptions: [
          {
            id: 'url',
            name: 'Torznab URL',
            description:
              'The full URL of the Torznab API endpoint, including the path (usually `/api`).',
            type: 'url',
            required: true,
          },
          {
            id: 'apiKey',
            name: 'API Key',
            description:
              'The password for the Torznab API. This is used to authenticate with the Torznab endpoint.',
            type: 'password',
            required: false,
          },
        ],
      },
      { ...timeoutOption(), required: false },
      servicesOption(StremThruPreset.supportedServices),
      mediaTypesOption(),
      searchModeOption(),
      seasonEpisodeStrategyOption(),
      initialLimitOption(),
      paginateOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'torznab',
      NAME: 'Torznab',
      LOGO: '',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/torznab`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION: 'An addon to get debrid results from a Torznab endpoint.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.DEBRID_STREAM_TYPE,
      ] as constants.StreamType[],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
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
    if (!usableServices || usableServices.length === 0) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one usable service, but none were found. Please enable at least one of the following services: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }
    const querySearchValues = resolveForceQuerySearch(
      options.searchMode,
      options.forceQuerySearch
    );

    // prettier-ignore
    return querySearchValues.flatMap(forceQuerySearch => {
      const modifiedOptions = { ...options, forceQuerySearch };
      
      return options.useMultipleInstances
        ? usableServices.map(service => this.generateAddon(userData, modifiedOptions, [service.id]))
        : [this.generateAddon(userData, modifiedOptions, usableServices.map(service => service.id))];
    });
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    services: ServiceId[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(userData, services, options),
      identifier: (services.length > 1
        ? 'multi'
        : constants.SERVICE_DETAILS[services[0]].shortName
      ).concat(options.forceQuerySearch ? '_Q' : ''),
      displayIdentifier: services
        .map((id) => constants.SERVICE_DETAILS[id].shortName)
        .join(' | ')
        .concat(options.forceQuerySearch ? ' (Q)' : ''),
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
    const config = {
      ...this.getBaseConfig(userData, services),
      url: options.api?.url,
      // the url already carries the api path
      apiPath: '',
      apiKey: options.api?.apiKey,
      forceQuerySearch: options.forceQuerySearch ?? false,
      forceInitialLimit: options.initialLimit,
      paginate: options.paginate ?? false,
      seasonEpisodeStrategy: options.seasonEpisodeStrategy ?? 'episode',
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.DEFAULT_URL}/${configString}/manifest.json`;
  }
}
