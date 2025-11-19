import { Addon, Option, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, RESOURCES, ServiceId, constants } from '../utils/index.js';
import { BuiltinAddonPreset } from './builtin.js';

export class NewznabPreset extends BuiltinAddonPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const supportedServices = [
      constants.TORBOX_SERVICE,
      constants.NZBDAV_SERVICE,
      constants.ALTMOUNT_SERVICE,
    ] as ServiceId[];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Newznab',
      },
      {
        id: 'newznabUrl',
        name: 'Newznab URL',
        description: 'Provide the URL to the Newznab endpoint ',
        type: 'select-with-custom',
        options: [
          { label: 'altHUB', value: 'https://api.althub.co.za' },
          {
            label: 'AnimeTosho',
            value: 'https://feed.animetosho.org/',
          },
          { label: 'DOGnzb', value: 'https://api.dognzb.cr/' },
          { label: 'DrunkenSlug', value: 'https://drunkenslug.com/' },
          { label: 'Miatrix', value: 'https://www.miatrix.com' },
          { label: 'NinjaCentral', value: 'https://ninjacentral.co.za/' },
          { label: 'Nzb.life', value: 'https://api.nzb.life/' },
          { label: 'NZBFinder', value: 'https://nzbfinder.ws/' },
          { label: 'NZBgeek', value: 'https://api.nzbgeek.info/' },
          { label: 'NzbPlanet', value: 'https://api.nzbplanet.net' },
          { label: 'NZBStars', value: 'https://nzbstars.com/' },
          { label: 'SceneNZBs', value: 'https://scenenzbs.com' },
          {
            label: 'Tabula Rasa',
            value: 'https://www.tabula-rasa.pw/api/v1/',
          },
          {
            label: 'TorBox Search',
            value: 'https://search-api.torbox.app/newznab',
          },
          { label: 'Usenet Crawler', value: 'https://www.usenet-crawler.com/' },
        ],
        required: true,
      },
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'The password for the Newznab API. This is used to authenticate with the Newznab endpoint.',
        type: 'password',
        required: false,
      },
      {
        id: 'apiPath',
        name: 'API Path',
        description: 'The path to the Newznab API. Usually /api.',
        type: 'string',
        required: false,
        default: '/api',
        showInSimpleMode: false,
      },
      {
        id: 'proxyAuth',
        name: 'AIOStreams Proxy Auth',
        description:
          'If you want to proxy the NZBs through AIOStreams, provide a username:password pair from the `AIOSTREAMS_AUTH` environment variable.',
        type: 'password',
        required: false,
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
        showInSimpleMode: false,
        options: supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      // {
      //   id: 'forceQuerySearch',
      //   name: 'Force Query Search',
      //   description: 'Force the addon to use the query search parameter',
      //   type: 'boolean',
      //   required: false,
      //   default: false,
      // },
      {
        id: 'searchMode',
        name: 'Search Mode',
        description:
          'The search mode to use when querying the Torznab endpoint. **Note**: `Both` will result in two addons being created, one for each search mode.',
        type: 'select',
        required: false,
        default: 'auto',
        showInSimpleMode: false,
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Forced Query', value: 'query' },
          { label: 'Both', value: 'both' },
        ],
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'Newznab supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'newznab',
      NAME: 'Newznab',
      LOGO: '',
      URL: `${Env.INTERNAL_URL}/builtins/newznab`,
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'An addon to get usenet results from a Newznab endpoint.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
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
    // prettier-ignore
    const getQuerySearchValues = (searchMode: string, forceQuerySearch?: boolean): boolean[] => {
      switch (searchMode) {
        case 'both': return [true, false];
        case 'query': return [true];
        case 'auto': return [false];
        default: return [forceQuerySearch ?? false];
      }
    };

    // prettier-ignore
    const querySearchValues = getQuerySearchValues(options.searchMode, options.forceQuerySearch);

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
    const config = {
      ...this.getBaseConfig(userData, services),
      url: options.newznabUrl,
      apiPath: options.apiPath,
      apiKey: options.apiKey,
      proxyAuth: options.proxyAuth,
      forceQuerySearch: options.forceQuerySearch ?? false,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.METADATA.URL}/${configString}/manifest.json`;
  }
}
