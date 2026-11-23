import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { appConfig, RESOURCES, ServiceId, constants } from '../utils/index.js';
import { BuiltinAddonPreset } from './builtin.js';
import {
  mediaTypesOption,
  nameOption,
  paginateOption,
  proxyAuthOption,
  resolveForceQuerySearch,
  searchModeOption,
  seasonEpisodeStrategyOption,
  servicesOption,
  timeoutOption,
  useMultipleInstancesOption,
} from './options.js';

export const NEWZNAB_INDEXERS: {
  label: string;
  value: string;
  apiKeyUrl?: string;
  // https://remuxdb.1632022.xyz/api/openapi.json - NzbIndexer schema
  remuxDbIndexer?: string;
}[] = [
  {
    label: 'abNZB',
    value: 'https://abnzb.com/api',
    apiKeyUrl: 'https://abnzb.com/profile',
    remuxDbIndexer: 'abnzb',
  },
  {
    label: 'altHUB',
    value: 'https://api.althub.co.za/api',
    apiKeyUrl: 'https://althub.co.za/profile',
    remuxDbIndexer: 'althub',
  },
  {
    label: 'AmeNZB',
    value: 'https://amenzb.moe/api',
    apiKeyUrl: 'https://amenzb.moe/profile',
    remuxDbIndexer: 'amenzb',
  },
  // Neither Anime Tosho requires an API key
  {
    label: 'Anime Tosho (ARCHIVED)',
    value: 'https://feed.animetosho.org/api',
    remuxDbIndexer: 'animetosho',
  },
  {
    label: 'Anime Tosho (NEW)',
    value: 'https://feed.animetosho.net/api',
    remuxDbIndexer: 'animetosho',
  },
  {
    label: 'Aninzb',
    value: 'https://aninzb.moe/api',
    remuxDbIndexer: 'aninzb',
  },
  {
    label: 'ClubNZB',
    value: 'https://clubnzb.com/api',
    remuxDbIndexer: 'clubnzb',
  },
  {
    label: 'Digital Carnage',
    value: 'https://digitalcarnage.info/api',
    apiKeyUrl: 'https://digitalcarnage.info/profile',
    remuxDbIndexer: 'digitalcarnage',
  },
  {
    label: 'DOGnzb',
    value: 'https://api.dognzb.cr/api',
    remuxDbIndexer: 'dognzb',
  },
  {
    label: 'DrunkenSlug',
    value: 'https://drunkenslug.com/api',
    apiKeyUrl: 'https://drunkenslug.com/profile',
    remuxDbIndexer: 'drunkenslug',
  },
  {
    label: 'GingaDADDY',
    value: 'https://www.gingadaddy.com/api',
    remuxDbIndexer: 'gingadaddy',
  },
  {
    label: 'Miatrix',
    value: 'https://www.miatrix.com/api',
    apiKeyUrl: 'https://www.miatrix.com/profile',
    remuxDbIndexer: 'miatrix',
  },
  {
    label: 'NewzBay',
    value: 'https://newzbay.cc/api',
    apiKeyUrl: 'https://newzbay.cc/profile',
    remuxDbIndexer: 'newzbay',
  },
  {
    label: 'NinjaCentral',
    value: 'https://ninjacentral.co.za/api',
    apiKeyUrl: 'https://ninjacentral.co.za/profile',
    remuxDbIndexer: 'ninjacentral',
  },
  {
    label: 'NZB Atlas',
    value: 'https://nzbatlas.com/api',
    apiKeyUrl: 'https://nzbatlas.com/profile',
    remuxDbIndexer: 'nzbatlas',
  },
  {
    label: 'Nzb.life',
    value: 'https://api.nzb.life/api',
    apiKeyUrl: 'https://www.nzb.life/profile',
    remuxDbIndexer: 'nzb_life',
  },
  {
    label: 'NZBFinder',
    value: 'https://nzbfinder.ws/api',
    apiKeyUrl: 'https://nzbfinder.ws/profile',
    remuxDbIndexer: 'nzbfinder',
  },
  {
    label: 'NZBgeek',
    value: 'https://api.nzbgeek.info/api',
    apiKeyUrl: 'https://nzbgeek.info/profile',
    remuxDbIndexer: 'nzbgeek',
  },
  {
    label: 'NzbNest',
    value: 'https://nzbnest.com/api',
    apiKeyUrl: 'https://nzbnest.com/profile',
    remuxDbIndexer: 'nzbnest',
  },
  {
    label: 'NzbNoob',
    value: 'https://nzbnoob.com/api',
    apiKeyUrl: 'https://nzbnoob.com/profile',
    remuxDbIndexer: 'nzbnoob',
  },
  {
    label: 'NzbPlanet',
    value: 'https://api.nzbplanet.net/api',
    apiKeyUrl: 'https://nzbplanet.net/profile',
    remuxDbIndexer: 'nzbplanet',
  },
  {
    label: 'NZBStars',
    value: 'https://nzbstars.com/api',
    remuxDbIndexer: 'nzbstars',
  },
  {
    label: 'PourCeSoir',
    value: 'https://pourcesoir.in/api',
    apiKeyUrl: 'https://pourcesoir.in/profile',
    remuxDbIndexer: 'pourcesoir',
  },
  {
    label: 'SearchNZB',
    value: 'https://api.searchnzb.com/api',
    apiKeyUrl: 'https://searchnzb.com/account',
  },
  {
    label: 'SquareEyed',
    value: 'https://squareeyed.org/api',
    apiKeyUrl: 'https://squareeyed.org/profile',
    remuxDbIndexer: 'squareeyed',
  },
  {
    label: 'Tabula Rasa',
    value: 'https://www.tabula-rasa.pw/api/v1/api',
    apiKeyUrl: 'https://www.tabula-rasa.pw/profile',
    remuxDbIndexer: 'tabula_rasa',
  },
  {
    label: 'TorBox Search',
    value: 'https://search-api.torbox.app/newznab/api',
    apiKeyUrl: 'https://torbox.app/settings?section=account',
    remuxDbIndexer: 'torbox',
  },
  {
    label: 'Treasure Maps (formerly SceneNZBs)',
    value: 'https://treasure-maps.com/api',
    apiKeyUrl: 'https://treasure-maps.com/account',
    remuxDbIndexer: 'treasure_maps',
  },
  {
    label: 'Usenet Crawler',
    value: 'https://www.usenet-crawler.com/api',
    apiKeyUrl: 'https://www.usenet-crawler.com/profile',
    remuxDbIndexer: 'usenet_crawler',
  },
  {
    label: 'Videothek',
    value: 'https://videothek.io/api',
    apiKeyUrl: 'https://videothek.io/profile',
    remuxDbIndexer: 'videothek',
  },
];

export class NewznabPreset extends BuiltinAddonPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const supportedServices = [
      constants.TORBOX_SERVICE,
      constants.NZBDAV_SERVICE,
      constants.ALTMOUNT_SERVICE,
      constants.STREMIO_NNTP_SERVICE,
      constants.STREMTHRU_NEWZ_SERVICE,
      constants.AIOSTREAMS_SERVICE,
    ] as ServiceId[];
    const options: Option[] = [
      nameOption('Newznab'),
      {
        id: 'api',
        name: 'Newznab Endpoint',
        description: '',
        type: 'nab-endpoint',
        nab: { namespace: 'newznab', preset: 'newznab' },
        required: true,
        subOptions: [
          {
            id: 'url',
            name: 'Newznab URL',
            description:
              'Pick an indexer, or choose `Custom` to enter the full URL of the Newznab API endpoint (including the path, usually `/api`). New to Usenet indexers? Compare options at [Usenet Almanac](https://usenetalmanac.com/indexers/) or [nzb-sources](https://hampelmen.github.io/nzb-sources/).',
            type: 'select-with-custom',
            required: true,
            options: NEWZNAB_INDEXERS,
          },
          {
            id: 'apiKey',
            name: 'API Key',
            description:
              'The password for the Newznab API. This is used to authenticate with the Newznab endpoint.',
            type: 'password',
            required: false,
          },
        ],
      },
      proxyAuthOption(),
      { ...timeoutOption(), required: false },
      mediaTypesOption(),
      servicesOption(supportedServices),
      searchModeOption(),
      seasonEpisodeStrategyOption(),
      paginateOption(),
      useMultipleInstancesOption(),
    ];

    return {
      ID: 'newznab',
      NAME: 'Newznab',
      LOGO: '',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/newznab`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
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
        ? usableServices.map(
            (service: NonNullable<UserData['services']>[number]) =>
              this.generateAddon(userData, modifiedOptions, [service.id])
          )
        : [
            this.generateAddon(
              userData,
              modifiedOptions,
              usableServices.map(
                (service: NonNullable<UserData['services']>[number]) =>
                  service.id
              )
            ),
          ];
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
    const config: Record<string, any> = {
      ...this.getBaseConfig(userData, services),
      url: options.api?.url,
      apiPath: '',
      apiKey: options.api?.apiKey,
      proxyAuth: options.proxyAuth,
      forceQuerySearch: options.forceQuerySearch ?? false,
      paginate: options.paginate ?? false,
      seasonEpisodeStrategy: options.seasonEpisodeStrategy ?? 'episode',
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${this.DEFAULT_URL}/${configString}/manifest.json`;
  }
}
