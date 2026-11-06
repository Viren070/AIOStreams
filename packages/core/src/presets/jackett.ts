import { Addon, Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';
import {
  jackettTorznabUrl,
  resolveJackettCredentials,
} from '../builtins/torznab/jackett.js';

export class JackettPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Jackett',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default:
          appConfig.builtins.jackett.timeout ??
          appConfig.presets.defaultTimeout,
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: StremThruPreset.supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      ...(appConfig.builtins.jackett.url && appConfig.builtins.jackett.apiKey
        ? [
            {
              id: 'notRequiredNote',
              name: '',
              description:
                'This instance has a preconfigured Jackett instance. You do not need to set the Jackett URL and API Key below. ',
              type: 'alert',
              intent: 'info',
              showInSimpleMode: false,
            } as const,
          ]
        : []),
      {
        id: 'jackettUrl',
        name: 'Jackett URL',
        description: 'The URL of the Jackett instance',
        type: 'url',
        required:
          !appConfig.builtins.jackett.url || !appConfig.builtins.jackett.apiKey,
        showInSimpleMode:
          appConfig.builtins.jackett.url && appConfig.builtins.jackett.apiKey
            ? false
            : undefined,
      },
      {
        id: 'jackettApiKey',
        name: 'Jackett API Key',
        description: 'The API key for the Jackett instance',
        type: 'password',
        required:
          !appConfig.builtins.jackett.url || !appConfig.builtins.jackett.apiKey,
        showInSimpleMode:
          appConfig.builtins.jackett.url && appConfig.builtins.jackett.apiKey
            ? false
            : undefined,
      },
      {
        id: 'indexers',
        name: 'Indexers',
        description:
          "Each selected indexer is searched separately, so a slow one cannot hold up the others, and uses ID search where it supports it. **Each one counts as an addon** towards the instance's addon limit.",
        type: 'indexer-select',
        required: false,
        default: [],
        indexerSource: {
          provider: 'jackett',
          urlOption: 'jackettUrl',
          apiKeyOption: 'jackettApiKey',
          emptyWarning:
            "Nothing selected, so Jackett's combined `all` indexer is used: one slow indexer delays every result, and only title search is used, whatever the search mode.",
        },
      },
      {
        id: 'searchMode',
        name: 'Search Mode',
        description:
          '`Auto` searches by ID (TVDB/IMDb/TMDB + season/episode) when the indexer supports it; `Forced Query` always searches by title text instead. **Note**: `Both` creates two separate addons, one per mode.',
        type: 'select',
        required: false,
        showInSimpleMode: false,
        default: 'auto',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Forced Query', value: 'query' },
          { label: 'Both', value: 'both' },
        ],
      },
      {
        id: 'seasonEpisodeStrategy',
        name: 'Season/Episode Search Strategy',
        description:
          "Controls whether series searches in `Auto` mode query at the episode level, the season level, or both - useful for private trackers where season packs replace individual episodes. A season-level search may return season packs, individual episodes, or both, depending on the indexer. `Dynamic` decides based on whether the season is still airing. Pair with `Season/Episode Matching` in Filters to filter out results that don't match.",
        type: 'select',
        required: false,
        showInSimpleMode: false,
        default: 'episode',
        options: [
          { label: 'Episode', value: 'episode' },
          { label: 'Season', value: 'season' },
          { label: 'Dynamic (Season Preferred)', value: 'dynamic' },
          {
            label: 'Episode First, Season Fallback',
            value: 'episodeFirst',
          },
        ],
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
        id: 'resultPassthrough',
        name: 'Result Passthrough',
        description:
          'If enabled, all results from this addon will never be filtered out and always included in the final stream list.',
        type: 'boolean',
        required: false,
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'Jackett supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'jackett',
      NAME: 'Jackett',
      LOGO: 'https://raw.githubusercontent.com/Jackett/Jackett/refs/heads/master/src/Jackett.Common/Content/jacket_medium.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/torznab`],
      TIMEOUT:
        appConfig.builtins.jackett.timeout ?? appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION: 'An addon to get debrid results from a Jackett instance.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  static override async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const indexers: string[] = Array.isArray(options.indexers)
      ? [...new Set<string>(options.indexers)].filter(
          (id) => typeof id === 'string' && id
        )
      : [];
    if (indexers.length === 0) {
      // `auto` keeps a single `all` addon with its pre-selection identifier
      return super.generateAddons(userData, { ...options, searchMode: 'auto' });
    }
    const addons = await Promise.all(
      indexers.map(async (indexer) =>
        (await super.generateAddons(userData, { ...options, indexer })).map(
          (addon) => ({
            ...addon,
            identifier: `${indexer}_${addon.identifier}`,
            displayIdentifier: `${indexer} · ${addon.displayIdentifier}`,
          })
        )
      )
    );
    return addons.flat();
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, any>
  ): string {
    const credentials = resolveJackettCredentials({
      url: options.jackettUrl,
      apiKey: options.jackettApiKey,
    });
    if (!credentials) {
      throw new Error('Jackett URL and API Key are required');
    }
    return super.generateManifestUrl(userData, services, {
      ...options,
      api: {
        url: jackettTorznabUrl(credentials.url, options.indexer ?? 'all'),
        apiKey: credentials.apiKey,
      },
      // `all` mixes every indexer's caps, so only a text query is reliable
      forceQuerySearch: options.indexer ? options.forceQuerySearch : true,
    });
  }
}
