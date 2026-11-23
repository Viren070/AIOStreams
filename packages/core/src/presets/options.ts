import { Option } from '../db/index.js';
import { appConfig, constants, ServiceId } from '../utils/index.js';

// Options shared between presets; use these instead of copying the literals.

export const nameOption = (defaultName: string): Option => ({
  id: 'name',
  name: 'Name',
  description: 'What to call this addon',
  type: 'string',
  required: true,
  default: defaultName,
});

export const timeoutOption = (
  defaultTimeout: number = appConfig.presets.defaultTimeout
): Option => ({
  id: 'timeout',
  name: 'Timeout (ms)',
  description: 'The timeout for this addon',
  type: 'number',
  required: true,
  default: defaultTimeout,
  constraints: {
    min: appConfig.userLimits.timeouts.minTimeout,
    max: appConfig.userLimits.timeouts.maxTimeout,
    forceInUi: false, // large ranges don't work well
  },
});

export const mediaTypesOption = (): Option => ({
  id: 'mediaTypes',
  name: 'Media Types',
  description:
    'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
  type: 'multi-select',
  required: false,
  showInSimpleMode: false,
  default: [],
  options: [
    { label: 'Movie', value: 'movie' },
    { label: 'Series', value: 'series' },
    { label: 'Anime', value: 'anime' },
  ],
});

export const servicesOption = (
  supportedServices: readonly ServiceId[]
): Option => ({
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
});

export const useMultipleInstancesOption = (): Option => ({
  id: 'useMultipleInstances',
  name: 'Use Multiple Instances',
  description:
    'This addon supports multiple services in one instance - which is used by default. If this is enabled, then a separate addon will be created for each service.',
  type: 'boolean',
  default: false,
  showInSimpleMode: false,
});

export const includeP2POption = (): Option => ({
  id: 'includeP2P',
  name: 'Include P2P',
  description: 'Include P2P results, even if a debrid service is enabled',
  type: 'boolean',
  default: false,
  showInSimpleMode: false,
});

type SearchMode = 'auto' | 'query' | 'both';

/** Pair with {@link resolveForceQuerySearch} when generating addons. */
export const searchModeOption = (defaultMode: SearchMode = 'auto'): Option => ({
  id: 'searchMode',
  name: 'Search Mode',
  description:
    '`Auto` searches by ID (TVDB/IMDb/TMDB + season/episode) when the indexer supports it; `Forced Query` always searches by title text instead. **Note**: `Both` creates two separate addons, one per mode.',
  type: 'select',
  required: false,
  showInSimpleMode: false,
  default: defaultMode,
  options: [
    { label: 'Auto', value: 'auto' },
    { label: 'Forced Query', value: 'query' },
    { label: 'Both', value: 'both' },
  ],
});

/**
 * `forceQuerySearch` for each addon a `searchMode` creates. Configs saved
 * before `searchMode` existed only have `forceQuerySearch`.
 */
export function resolveForceQuerySearch(
  searchMode: string | undefined,
  forceQuerySearch?: boolean
): boolean[] {
  switch (searchMode) {
    case 'both':
      return [true, false];
    case 'query':
      return [true];
    case 'auto':
      return [false];
    default:
      return [forceQuerySearch ?? false];
  }
}

export const seasonEpisodeStrategyOption = (): Option => ({
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
    { label: 'Episode First, Season Fallback', value: 'episodeFirst' },
  ],
});

export const initialLimitOption = (defaultLimit?: number): Option => ({
  id: 'initialLimit',
  name: 'Initial Result Limit',
  description:
    'The number of results to request per search. Leave blank to use the optimal default limit for the indexer.',
  type: 'number',
  required: false,
  showInSimpleMode: false,
  default: defaultLimit,
  constraints: {
    min: 1,
    max: 10000,
    forceInUi: false,
  },
});

export const paginateOption = (): Option => ({
  id: 'paginate',
  name: 'Paginate Results',
  description:
    'Whether to paginate through all available results when searching. Enabling this can provide more results at the cost of increased search time and more requests.',
  type: 'boolean',
  required: false,
  default: false,
  showInSimpleMode: false,
});

export const proxyAuthOption = (): Option => ({
  id: 'proxyAuth',
  name: 'AIOStreams Proxy Auth',
  description:
    'Provide a username:password pair from the `AIOSTREAMS_AUTH` environment variable to use for proxying the NZB.',
  type: 'password',
  required: false,
});

export const hideStreamsOption = (): Option => ({
  id: 'hideStreams',
  name: 'Hide Streams',
  description:
    'Hide streams from this addon. This can be used to prevent this addon from showing streams except in its catalogs.',
  type: 'boolean',
  default: false,
});

export const libraryAddonOption = (): Option => ({
  id: 'libraryAddon',
  name: 'Library Addon',
  description:
    'Whether to mark this addon as a library addon. This will result in all streams from this addon being marked as library streams.',
  type: 'boolean',
  required: false,
  showInSimpleMode: false,
  default: false,
});

export const formatPassthroughOption = (): Option => ({
  id: 'formatPassthrough',
  name: 'Format Passthrough',
  description:
    'Whether to pass through the stream formatting. This means your formatting will not be applied and original stream formatting is retained.',
  type: 'boolean',
  required: false,
  showInSimpleMode: false,
  default: false,
});

export const resultPassthroughOption = (defaultValue = false): Option => ({
  id: 'resultPassthrough',
  name: 'Result Passthrough',
  description:
    'If enabled, all results from this addon will never be filtered out and always included in the final stream list.',
  type: 'boolean',
  required: false,
  showInSimpleMode: false,
  default: defaultValue,
});

export const pinPositionOption = (): Option => ({
  id: 'pinPosition',
  name: 'Pin Position',
  description:
    'Pin streams from this addon to the top or bottom of the stream list. This will override the default sorting and place all streams from this addon either at the top or bottom, depending on your selection.',
  type: 'select',
  required: false,
  showInSimpleMode: false,
  default: undefined,
  options: [
    { label: 'None', value: undefined },
    { label: 'Top', value: 'top' },
    { label: 'Bottom', value: 'bottom' },
  ],
});

export const preconfiguredInstanceNote = (
  serviceName: string,
  preconfigured: boolean
): Option[] =>
  preconfigured
    ? [
        {
          id: 'notRequiredNote',
          name: '',
          description: `This instance has a preconfigured ${serviceName} instance. You do not need to set the ${serviceName} URL and API Key below. `,
          type: 'alert',
          intent: 'info',
          showInSimpleMode: false,
        },
      ]
    : [];

export const socialsOption = (
  socials: NonNullable<Option['socials']>
): Option => ({
  id: 'socials',
  name: '',
  description: '',
  type: 'socials',
  socials,
});
