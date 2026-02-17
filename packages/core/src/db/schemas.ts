import { z } from 'zod';
import * as constants from '../utils/constants.js';
import { Env } from '../utils/env.js';

const ServiceIds = z.enum(constants.SERVICES);

const Resolutions = z.enum(constants.RESOLUTIONS);

const Qualities = z.enum(constants.QUALITIES);

const VisualTags = z.enum(constants.VISUAL_TAGS);

const AudioTags = z.enum(constants.AUDIO_TAGS);

const AudioChannels = z.enum(constants.AUDIO_CHANNELS);

const Encodes = z.enum(constants.ENCODES);

const PassthroughStages = z.enum(constants.PASSTHROUGH_STAGES);

// Passthrough can be:
// - true: bypass all stages (backward compatible)
// - array of stages: bypass only specified stages
const PassthroughSchema = z.union([
  z.literal(true),
  z.array(PassthroughStages).min(1),
]);

export type PassthroughValue = z.infer<typeof PassthroughSchema>;
export type PassthroughStage = z.infer<typeof PassthroughStages>;

// const SortCriteria = z.enum(constants.SORT_CRITERIA);

// const SortDirections = z.enum(constants.SORT_DIRECTIONS);

const SortCriterion = z.object({
  key: z.enum(constants.SORT_CRITERIA),
  direction: z.enum(constants.SORT_DIRECTIONS),
});

export type SortCriterion = z.infer<typeof SortCriterion>;

const StreamTypes = z.enum(constants.STREAM_TYPES);
const Languages = z.enum(constants.LANGUAGES);

const Formatter = z.object({
  id: z.enum(constants.FORMATTERS),
  definition: z
    .object({
      name: z.string().max(Env.MAX_FORMATTER_TEMPLATE_LENGTH),
      description: z.string().max(Env.MAX_FORMATTER_TEMPLATE_LENGTH),
    })
    .optional(),
});

const StreamProxyConfig = z.object({
  enabled: z.boolean().optional(),
  id: z.enum(constants.PROXY_SERVICES).optional(),
  url: z.string().optional(),
  publicUrl: z.string().optional(),
  credentials: z.string().optional(),
  publicIp: z.string().optional(),
  proxiedAddons: z.array(z.string().min(1)).optional(),
  proxiedServices: z.array(z.string().min(1)).optional(),
});

export type StreamProxyConfig = z.infer<typeof StreamProxyConfig>;

const ResultLimitOptions = z.object({
  global: z.number().min(1).optional(),
  service: z.number().min(1).optional(),
  addon: z.number().min(1).optional(),
  resolution: z.number().min(1).optional(),
  quality: z.number().min(1).optional(),
  streamType: z.number().min(1).optional(),
  indexer: z.number().min(1).optional(),
  releaseGroup: z.number().min(1).optional(),
});

// const SizeFilter = z.object({
//   min: z.number().min(1).optional(),
//   max: z.number().min(1).optional(),
// });
const SizeFilter = z.object({
  movies: z
    .tuple([z.number().min(0), z.number().min(0)])
    // .object({
    //   min: z.number().min(1).optional(),
    //   max: z.number().min(1).optional(),
    // })
    .optional(),
  series: z
    .tuple([z.number().min(0), z.number().min(0)])
    // .object({
    //   min: z.number().min(1).optional(),
    //   max: z.number().min(1).optional(),
    // })
    .optional(),
  anime: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
});

const SizeFilterOptions = z.object({
  global: SizeFilter.optional(),
  resolution: z.partialRecord(Resolutions, SizeFilter).optional(),
});

const BitrateFilterOptions = z.object({
  useMetadataRuntime: z.boolean().optional().default(true),
  global: SizeFilter.optional(),
  resolution: z.partialRecord(Resolutions, SizeFilter).optional(),
});

const ServiceSchema = z.object({
  id: ServiceIds,
  enabled: z.boolean().optional(),
  credentials: z.record(z.string().min(1), z.string()),
});

export type Service = z.infer<typeof ServiceSchema>;

const ServiceList = z.array(ServiceSchema);

const ResourceSchema = z.enum(constants.RESOURCES);

export type Resource = z.infer<typeof ResourceSchema>;

const ResourceList = z.array(ResourceSchema);

const AddonSchema = z.object({
  instanceId: z.string().min(1).optional(), // uniquely identifies the addon in a given list of addons
  preset: z.object({
    id: z.string(),
    type: z.string(),
    options: z.record(z.string(), z.any()),
  }),
  manifestUrl: z.string().url(),
  enabled: z.boolean(),
  resources: ResourceList.optional(),
  mediaTypes: z.array(z.enum(constants.TYPES)).optional(),
  name: z.string(),
  identifier: z.string().optional(), // true identifier for generating IDs
  displayIdentifier: z.string().optional(), // identifier for display purposes
  timeout: z.number().min(1),
  library: z.boolean().optional(),
  formatPassthrough: z.boolean().optional(),
  resultPassthrough: z.boolean().optional(),
  forceToTop: z.boolean().optional(),
  serviceWrapped: z.boolean().optional(),
  headers: z.record(z.string().min(1), z.string().min(1)).optional(),
  ip: z.union([z.ipv4(), z.ipv6()]).optional(),
});

// preset objects are transformed into addons by a preset transformer.
const PresetSchema = z.object({
  type: z.string().min(1), // the preset type e.g. 'torrentio'
  instanceId: z.string().min(1), // uniquely identifies the preset in a given list of presets
  enabled: z.boolean(),
  options: z.record(z.string().min(1), z.any()),
});

export type PresetObject = z.infer<typeof PresetSchema>;

const PresetList = z.array(PresetSchema);

export type Addon = z.infer<typeof AddonSchema>;
export type Preset = z.infer<typeof PresetSchema>;

const DeduplicatorKey = z.enum(constants.DEDUPLICATOR_KEYS);

// deduplicator options.
// can choose what keys to use for identifying duplicates.
// can choose how duplicates are removed specifically.
// we can either
// - keep only 1 result from the highest priority service from the highest priority addon (single_result)
// - keep 1 result for each enabled service from the higest priority addon (per_service)
// - keep 1 result from the highest priority service from each enabled addon (per_addon)
const DeduplicatorMode = z.enum([
  'single_result',
  'per_service',
  'per_addon',
  'disabled',
]);

const DeduplicatorOptions = z.object({
  enabled: z.boolean().optional(),
  excludeAddons: z.array(z.string().min(1)).optional(),
  multiGroupBehaviour: z
    .enum(['keep_all', 'aggressive', 'conservative'])
    .optional(),
  keys: z.array(DeduplicatorKey).optional(),
  cached: DeduplicatorMode.optional(),
  uncached: DeduplicatorMode.optional(),
  p2p: DeduplicatorMode.optional(),
  http: DeduplicatorMode.optional(),
  live: DeduplicatorMode.optional(),
  youtube: DeduplicatorMode.optional(),
  external: DeduplicatorMode.optional(),
});

const OptionDefinition = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  showInSimpleMode: z.boolean().optional(),
  emptyIsUndefined: z.boolean().optional(),
  type: z.enum([
    'string',
    'password',
    'number',
    'boolean',
    'select',
    'select-with-custom',
    'multi-select',
    'url',
    'alert',
    'socials',
    'oauth',
    'subsection',
    'custom-nntp-servers',
  ]),
  oauth: z
    .object({
      authorisationUrl: z.string().url(),
      oauthResultField: z.object({
        name: z.string().min(1),
        description: z.string().min(1),
      }),
    })
    .optional(),
  required: z.boolean().optional(),
  default: z.any().optional(),
  forced: z.any().optional(),
  options: z
    .array(
      z.object({
        value: z.any(),
        label: z.string().min(1),
      })
    )
    .optional(),
  get subOptions() {
    return z.array(OptionDefinition).optional();
  },
  intent: z
    .enum([
      'alert',
      'info',
      'success',
      'warning',
      'info-basic',
      'success-basic',
      'warning-basic',
      'alert-basic',
    ])
    .optional(),
  socials: z
    .array(
      z.object({
        id: z.enum([
          'website',
          'github',
          'discord',
          'ko-fi',
          'patreon',
          'buymeacoffee',
          'github-sponsors',
          'donate',
        ]),
        url: z.string().url(),
      })
    )
    .optional(),
  constraints: z
    .object({
      min: z.number().min(1).optional(), // for string inputs, consider this the minimum length.
      max: z.number().min(1).optional(), // and for number inputs, consider this the minimum and maximum value.
      forceInUi: z.boolean().optional(), // if true, the UI components will enforce these constraints.
    })
    .optional(),
});

export type Option = z.infer<typeof OptionDefinition>;

const NameableRegex = z.object({
  name: z.string().min(0),
  pattern: z.string().min(1),
});

const Group = z.object({
  addons: z.array(z.string().min(1)).min(1),
  condition: z.string().min(1).max(200),
});

export type Group = z.infer<typeof Group>;

// Resolution, Quality, Encode, Visual Tag, Audio Tag, Stream Type, Keyword, Regex, Cached, Uncached, Size

const CatalogModification = z.object({
  id: z.string().min(1), // an id that maps to an actual catalog ID
  type: z.string().min(1), // the type of catalog modification
  name: z.string().optional(), // override the name of the catalog
  shuffle: z.boolean().optional(), // shuffle the catalog
  reverse: z.boolean().optional(), // reverse the catalog
  persistShuffleFor: z.number().min(0).max(24).optional(), // persist the shuffle for a given amount of time (in hours)
  onlyOnDiscover: z.boolean().optional(), // only show the catalog on the discover page
  disableSearch: z.boolean().optional(), // disable the search for the catalog
  onlyOnSearch: z.boolean().optional(), // only show the catalog on search results - mutually exclusive with onlyOnDiscover, only available when the catalog has a non-required search extra
  enabled: z.boolean().optional(), // enable or disable the catalog
  usePosterService: z.boolean().optional(), // use rpdb or top poster for posters if supported
  overrideType: z.string().min(1).optional(), // override the type of the catalog
  hideable: z.boolean().optional(), // hide the catalog from the home page
  searchable: z.boolean().optional(), // property of whether the catalog is searchable (not a search only catalog)
  addonName: z.string().optional(), // the name of the addon that provides the catalog
});

export type CatalogModification = z.infer<typeof CatalogModification>;

const MergedCatalog = z.object({
  id: z.string().min(1), // unique id for the merged catalog
  name: z.string().min(1), // name of the merged catalog
  type: z.string().min(1), // the type of the merged catalog (movie, series, etc.)
  catalogIds: z.array(z.string().min(1)), // array of catalog ids to merge (format: "id=encode(id)&type=encode(type)") // encoded to handle incorrect splitting
  enabled: z.boolean().optional(), // enable or disable the merged catalog
  deduplicationMethods: z.array(z.enum(['id', 'title'])).optional(), // deduplication methods to apply in order
  mergeMethod: z
    .enum([
      'sequential', // merge in order of catalogIds array
      'interleave', // interleave: 1st from each, then 2nd from each, etc.
      'imdbRating', // sort by IMDB rating (descending)
      'releaseDateAsc', // sort by release date (oldest first)
      'releaseDateDesc', // sort by release date (newest first)
    ])
    .optional(), // defaults to 'sequential' if not specified
});

export type MergedCatalog = z.infer<typeof MergedCatalog>;

export const CacheAndPlaySchema = z
  .object({
    enabled: z.boolean().optional(),
    streamTypes: z.array(z.enum(['usenet', 'torrent'])).optional(),
  })
  .optional();

export type CacheAndPlay = z.infer<typeof CacheAndPlaySchema>;

export const UserDataSchema = z.object({
  uuid: z.string().uuid().optional(),
  encryptedPassword: z.string().min(1).optional(),
  trusted: z.boolean().optional(),
  showChanges: z.boolean().optional(),
  addonPassword: z.string().optional(),
  ip: z.union([z.ipv4(), z.ipv6()]).optional(),
  addonName: z.string().min(1).max(300).optional(),
  addonLogo: z.string().url().optional(),
  addonBackground: z.string().url().optional(),
  addonDescription: z.string().min(1).optional(),
  excludedResolutions: z.array(Resolutions).optional(),
  includedResolutions: z.array(Resolutions).optional(),
  requiredResolutions: z.array(Resolutions).optional(),
  preferredResolutions: z.array(Resolutions).optional(),
  excludedQualities: z.array(Qualities).optional(),
  includedQualities: z.array(Qualities).optional(),
  requiredQualities: z.array(Qualities).optional(),
  preferredQualities: z.array(Qualities).optional(),
  excludedLanguages: z.array(Languages).optional(),
  includedLanguages: z.array(Languages).optional(),
  requiredLanguages: z.array(Languages).optional(),
  preferredLanguages: z.array(Languages).optional(),
  excludedVisualTags: z.array(VisualTags).optional(),
  includedVisualTags: z.array(VisualTags).optional(),
  requiredVisualTags: z.array(VisualTags).optional(),
  preferredVisualTags: z.array(VisualTags).optional(),
  excludedAudioTags: z.array(AudioTags).optional(),
  includedAudioTags: z.array(AudioTags).optional(),
  requiredAudioTags: z.array(AudioTags).optional(),
  preferredAudioTags: z.array(AudioTags).optional(),
  excludedAudioChannels: z.array(AudioChannels).optional(),
  includedAudioChannels: z.array(AudioChannels).optional(),
  requiredAudioChannels: z.array(AudioChannels).optional(),
  preferredAudioChannels: z.array(AudioChannels).optional(),
  excludedStreamTypes: z.array(StreamTypes).optional(),
  includedStreamTypes: z.array(StreamTypes).optional(),
  requiredStreamTypes: z.array(StreamTypes).optional(),
  preferredStreamTypes: z.array(StreamTypes).optional(),
  excludedEncodes: z.array(Encodes).optional(),
  includedEncodes: z.array(Encodes).optional(),
  requiredEncodes: z.array(Encodes).optional(),
  preferredEncodes: z.array(Encodes).optional(),
  excludedRegexPatterns: z.array(z.string().min(1)).optional(),
  includedRegexPatterns: z.array(z.string().min(1)).optional(),
  requiredRegexPatterns: z.array(z.string().min(1)).optional(),
  preferredRegexPatterns: z.array(NameableRegex).optional(),
  syncedPreferredRegexUrls: z.array(z.string().url()).optional(),
  syncedExcludedRegexUrls: z.array(z.string().url()).optional(),
  syncedIncludedRegexUrls: z.array(z.string().url()).optional(),
  syncedRequiredRegexUrls: z.array(z.string().url()).optional(),
  syncedRankedRegexUrls: z.array(z.string().url()).optional(),
  syncedPreferredStreamExpressionUrls: z.array(z.string().url()).optional(),
  syncedExcludedStreamExpressionUrls: z.array(z.string().url()).optional(),
  syncedIncludedStreamExpressionUrls: z.array(z.string().url()).optional(),
  syncedRequiredStreamExpressionUrls: z.array(z.string().url()).optional(),
  syncedRankedStreamExpressionUrls: z.array(z.string().url()).optional(),
  excludedReleaseGroups: z.array(z.string().min(1)).optional(),
  includedReleaseGroups: z.array(z.string().min(1)).optional(),
  requiredReleaseGroups: z.array(z.string().min(1)).optional(),
  preferredReleaseGroups: z.array(z.string().min(1)).optional(),
  requiredKeywords: z.array(z.string().min(1)).optional(),
  includedKeywords: z.array(z.string().min(1)).optional(),
  excludedKeywords: z.array(z.string().min(1)).optional(),
  preferredKeywords: z.array(z.string().min(1)).optional(),
  randomiseResults: z.boolean().optional(),
  enhanceResults: z.boolean().optional(),
  enhancePosters: z.boolean().optional(),
  excludeSeederRange: z
    .tuple([z.number().min(0), z.number().min(0)])
    .optional(),
  includeSeederRange: z
    .tuple([z.number().min(0), z.number().min(0)])
    .optional(),
  requiredSeederRange: z
    .tuple([z.number().min(0), z.number().min(0)])
    .optional(),
  seederRangeTypes: z.array(z.enum(['p2p', 'cached', 'uncached'])).optional(),
  excludeAgeRange: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  includeAgeRange: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  requiredAgeRange: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  ageRangeTypes: z.array(z.enum(['usenet', 'debrid', 'p2p'])).optional(),
  digitalReleaseFilter: z
    .object({
      enabled: z.boolean().optional(),
      tolerance: z.number().min(0).max(365).optional(),
      requestTypes: z.array(z.string()).optional(),
      addons: z.array(z.string()).optional(),
    })
    .optional(),
  enableSeadex: z.boolean().optional(),
  excludeSeasonPacks: z.boolean().optional(),
  excludeCached: z.boolean().optional(),
  excludeCachedFromAddons: z.array(z.string().min(1)).optional(),
  excludeCachedFromServices: z.array(z.string().min(1)).optional(),
  excludeCachedFromStreamTypes: z.array(StreamTypes).optional(),
  excludeCachedMode: z.enum(['or', 'and']).optional(),
  excludeUncached: z.boolean().optional(),
  excludeUncachedFromAddons: z.array(z.string().min(1)).optional(),
  excludeUncachedFromServices: z.array(z.string().min(1)).optional(),
  excludeUncachedFromStreamTypes: z.array(StreamTypes).optional(),
  excludeUncachedMode: z.enum(['or', 'and']).optional(),
  excludedStreamExpressions: z
    .array(
      z.object({
        expression: z.string().min(1).max(Env.MAX_SEL_LENGTH),
        enabled: z.boolean().default(true),
      })
    )
    .optional(),
  requiredStreamExpressions: z
    .array(
      z.object({
        expression: z.string().min(1).max(Env.MAX_SEL_LENGTH),
        enabled: z.boolean().default(true),
      })
    )
    .optional(),
  preferredStreamExpressions: z
    .array(
      z.object({
        expression: z.string().min(1).max(Env.MAX_SEL_LENGTH),
        enabled: z.boolean().default(true),
      })
    )
    .optional(),
  includedStreamExpressions: z
    .array(
      z.object({
        expression: z.string().min(1).max(Env.MAX_SEL_LENGTH),
        enabled: z.boolean().default(true),
      })
    )
    .optional(),
  rankedStreamExpressions: z
    .array(
      z.object({
        expression: z.string().min(1).max(Env.MAX_SEL_LENGTH),
        score: z.number().min(-1_000_000).max(1_000_000),
        enabled: z.boolean().default(true),
      })
    )
    .optional(),
  rankedRegexPatterns: z
    .array(
      z.object({
        pattern: z.string().min(1),
        name: z.string().optional(),
        score: z.number().min(-1_000_000).max(1_000_000),
      })
    )
    .optional(),
  regexOverrides: z
    .array(
      z.object({
        pattern: z.string().min(1),
        name: z.string().optional(),
        score: z.number().min(-1_000_000).max(1_000_000).optional(),
        originalName: z.string().optional(),
        disabled: z.boolean().optional(),
      })
    )
    .optional(),
  selOverrides: z
    .array(
      z.object({
        expression: z.string().min(1),
        score: z.number().min(-1_000_000).max(1_000_000).optional(),
        exprNames: z.array(z.string()).optional(),
        disabled: z.boolean().optional(),
      })
    )
    .optional(),
  // disableGroups: z.boolean().optional(),
  // groups: z
  //   .array(
  //     z.object({
  //       addons: z.array(z.string().min(1)),
  //       condition: z.string().min(1).max(200),
  //     })
  //   )
  //   .optional(),
  dynamicAddonFetching: z
    .object({
      enabled: z.boolean().optional(),
      condition: z.string().max(Env.MAX_SEL_LENGTH).optional(),
    })
    .optional(),
  groups: z
    .object({
      enabled: z.boolean().optional(),
      groupings: z
        .array(
          z.object({
            addons: z.array(z.string().min(1)),
            condition: z.string().min(1).max(Env.MAX_SEL_LENGTH),
          })
        )
        .optional(),
      behaviour: z.enum(['sequential', 'parallel']).optional(),
    })
    .optional(),
  sortCriteria: z.object({
    // global must be defined.
    global: z.array(SortCriterion),
    // results must be from either a movie or series search, so we can safely apply different sort criteria.
    movies: z.array(SortCriterion).optional(),
    series: z.array(SortCriterion).optional(),
    anime: z.array(SortCriterion).optional(),
    // cached and uncached results are a sort criteria themselves, so this can only be applied when cache is high enough in the global
    // sort criteria, and we would have to split the results into two (cached and uncached) lists, and then apply both sort criteria below
    // and then merge the results.
    cached: z.array(SortCriterion).optional(),
    uncached: z.array(SortCriterion).optional(),
    cachedMovies: z.array(SortCriterion).optional(),
    uncachedMovies: z.array(SortCriterion).optional(),
    cachedSeries: z.array(SortCriterion).optional(),
    uncachedSeries: z.array(SortCriterion).optional(),
    cachedAnime: z.array(SortCriterion).optional(),
    uncachedAnime: z.array(SortCriterion).optional(),
  }),
  rpdbApiKey: z.string().optional(),
  // rpdbUseRedirectApi: z.boolean().optional(),
  topPosterApiKey: z.string().optional(),
  aioratingsApiKey: z.string().optional(),
  aioratingsProfileId: z.string().optional(),
  posterService: z
    .enum(['rpdb', 'top-poster', 'aioratings', 'none'])
    .optional(),
  usePosterRedirectApi: z.boolean().optional(),
  usePosterServiceForMeta: z.boolean().optional(),
  formatter: Formatter,
  proxy: StreamProxyConfig.optional(),
  resultLimits: ResultLimitOptions.optional(),
  size: SizeFilterOptions.optional(),
  bitrate: BitrateFilterOptions.optional(),
  hideErrors: z.boolean().optional(),
  hideErrorsForResources: z.array(ResourceSchema).optional(),
  // showStatistics: z.boolean().optional(),
  // statisticsPosition: z.enum(['top', 'bottom']).optional(),
  statistics: z
    .object({
      enabled: z.boolean().optional(),
      position: z.enum(['top', 'bottom']).optional(),
      statsToShow: z.array(z.enum(['addon', 'filter'])).optional(),
    })
    .optional(),
  tmdbAccessToken: z.string().optional(),
  tmdbApiKey: z.string().optional(),
  tvdbApiKey: z.string().optional(),
  yearMatching: z
    .object({
      enabled: z.boolean().optional(),
      tolerance: z.number().min(0).max(100).optional(),
      strict: z.boolean().optional(),
      requestTypes: z.array(z.string()).optional(),
      addons: z.array(z.string()).optional(),
    })
    .optional(),
  titleMatching: z
    .object({
      mode: z.enum(['exact', 'contains']).optional(),
      matchYear: z.boolean().optional(),
      yearTolerance: z.number().min(0).max(100).optional(),
      similarityThreshold: z.number().min(0).max(1).optional(),
      enabled: z.boolean().optional(),
      requestTypes: z.array(z.string()).optional(),
      addons: z.array(z.string()).optional(),
    })
    .optional(),
  seasonEpisodeMatching: z
    .object({
      enabled: z.boolean().optional(),
      strict: z.boolean().optional(),
      requestTypes: z.array(z.string()).optional(),
      addons: z.array(z.string()).optional(),
    })
    .optional(),
  deduplicator: DeduplicatorOptions.optional(),
  autoPlay: z
    .object({
      enabled: z.boolean().optional(),
      method: z.enum(constants.AUTO_PLAY_METHODS).optional(),
      attributes: z.array(z.enum(constants.AUTO_PLAY_ATTRIBUTES)).optional(),
    })
    .optional(),
  areYouStillThere: z
    .object({
      enabled: z.boolean().optional(),
      episodesBeforeCheck: z.number().min(1).optional(),
      cooldownMinutes: z.number().min(1).optional(),
    })
    .optional(),
  precacheNextEpisode: z.boolean().optional(),
  /** @deprecated Use precacheSelector instead */
  alwaysPrecache: z.boolean().optional(),
  /** @deprecated Use precacheSelector instead */
  precacheCondition: z.string().optional(),
  precacheSelector: z.string().optional(),
  services: ServiceList.optional(),
  presets: PresetList,
  catalogModifications: z.array(CatalogModification).optional(),
  mergedCatalogs: z.array(MergedCatalog).optional(),
  externalDownloads: z.boolean().optional(),
  cacheAndPlay: CacheAndPlaySchema.optional(),

  autoRemoveDownloads: z.boolean().optional(),
  checkOwned: z.boolean().optional().default(true),
  serviceWrap: z
    .object({
      enabled: z.boolean().optional(),
      /** Preset instanceIds to wrap — if empty/absent, all P2P-capable presets are wrapped */
      presets: z.array(z.string().min(1)).optional(),
      /** Which debrid services to use for processing wrapped P2P torrents — if absent, uses all enabled */
      services: z.array(ServiceIds).optional(),
      /** Re-process debrid results from external addons that include torrent info hashes through
       *  additional/different debrid services. Only applies to addons selected in the wrap addons list. */
      reconfigureService: z.boolean().optional(),
    })
    .optional(),
});

export type UserData = z.infer<typeof UserDataSchema>;

export const TABLES = {
  USERS: `
      uuid TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      config TEXT NOT NULL,
      config_salt TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP),
      updated_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP),
      accessed_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP)
    `,
  distributed_locks: `
      key TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      result TEXT
    `,
  cache: `
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `,
};

const strictManifestResourceSchema = z.object({
  name: z.enum(constants.RESOURCES),
  types: z.array(z.string()),
  idPrefixes: z.array(z.string()).or(z.null()).optional(),
});

export type StrictManifestResource = z.infer<
  typeof strictManifestResourceSchema
>;

const ManifestResourceSchema = z.union([
  z.string(),
  strictManifestResourceSchema,
]);

const ManifestExtraSchema = z.object({
  name: z.string().min(1),
  isRequired: z.boolean().optional(),
  options: z.array(z.string().or(z.null())).or(z.null()).optional(),
  optionsLimit: z.number().min(1).optional(),
});
const ManifestCatalogSchema = z.object({
  type: z.string(),
  id: z.string().min(1),
  name: z.string().min(1),
  extra: z.array(ManifestExtraSchema).optional(),
});

const AddonCatalogDefinitionSchema = z.object({
  type: z.string(),
  id: z.string().min(1),
  name: z.string().min(1),
});

export const ManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string().optional(),
    version: z.string(),
    types: z.array(z.string()),
    idPrefixes: z.array(z.string()).or(z.null()).optional(),
    resources: z.array(ManifestResourceSchema),
    catalogs: z.array(ManifestCatalogSchema).optional().default([]),
    addonCatalogs: z.array(AddonCatalogDefinitionSchema).optional(),
    background: z.string().or(z.null()).optional(),
    logo: z.string().or(z.null()).optional(),
    contactEmail: z.string().or(z.null()).optional(),
    behaviorHints: z
      .object({
        adult: z.boolean().optional(),
        p2p: z.boolean().optional(),
        configurable: z.boolean().optional(),
        configurationRequired: z.boolean().optional(),
      })
      .optional(),
    // not part of the manifest scheme, but needed for stremio-addons.net
    stremioAddonsConfig: z
      .object({
        issuer: z.string().min(1),
        signature: z.string().min(1),
      })
      .optional(),
  })
  .passthrough();

export type Manifest = z.infer<typeof ManifestSchema>;

export const SubtitleSchema = z
  .object({
    id: z.string().min(1),
    url: z.string(),
    lang: z.string().min(1),
  })
  .passthrough();

export const SubtitleResponseSchema = z.object({
  subtitles: z.array(SubtitleSchema),
});
export type SubtitleResponse = z.infer<typeof SubtitleResponseSchema>;
export type Subtitle = z.infer<typeof SubtitleSchema>;

export const SourceSchema = z.object({
  url: z.string(),
  bytes: z.number().nullable().optional(),
});

const NNTPServerSchema = z.object({
  username: z.string(),
  password: z.string(),
  host: z.string(),
  port: z.number(),
  ssl: z.boolean(),
  connections: z.number(),
});

export const NNTPServersSchema = z.array(NNTPServerSchema);

export type NNTPServers = z.infer<typeof NNTPServersSchema>;

export const StreamSchema = z.looseObject({
  url: z.string().or(z.null()).optional(),
  nzbUrl: z.string().or(z.null()).optional(),
  servers: z.array(z.string().min(1)).nullable().optional(),
  rarUrls: z.array(SourceSchema).nullable().optional(),
  zipUrls: z.array(SourceSchema).nullable().optional(),
  '7zipUrls': z.array(SourceSchema).nullable().optional(),
  tgzUrls: z.array(SourceSchema).nullable().optional(),
  tarUrls: z.array(SourceSchema).nullable().optional(),
  ytId: z.string().nullable().optional(),
  infoHash: z.string().nullable().optional(),
  fileIdx: z.number().or(z.null()).optional(),
  externalUrl: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  subtitles: z.array(SubtitleSchema).or(z.null()).optional(),
  sources: z.array(z.string().min(1)).or(z.null()).optional(),
  behaviorHints: z
    .looseObject({
      countryWhitelist: z.array(z.string().length(3)).or(z.null()).optional(),
      notWebReady: z.boolean().or(z.null()).optional(),
      bingeGroup: z.string().nullable().optional(),
      proxyHeaders: z
        .object({
          request: z.record(z.string().min(1), z.string().min(1)).optional(),
          response: z.record(z.string().min(1), z.string().min(1)).optional(),
        })
        .optional(),
      videoHash: z.string().nullable().optional(),
      videoSize: z.number().or(z.null()).optional(),
      filename: z.string().nullable().optional(),
    })
    .optional(),
});

export const StreamResponseSchema = z.object({
  streams: z.array(StreamSchema),
});

export type StreamResponse = z.infer<typeof StreamResponseSchema>;

export type Stream = z.infer<typeof StreamSchema>;

export const ParsedFileSchema = z.object({
  releaseGroup: z.string().optional(),
  resolution: z.string().optional(),
  quality: z.string().optional(),
  encode: z.string().optional(),
  audioChannels: z.array(z.string()),
  visualTags: z.array(z.string()),
  audioTags: z.array(z.string()),
  languages: z.array(z.string()),
  title: z.string().optional(),
  year: z.coerce.string().optional(),
  seasons: z.array(z.number()).optional(),
  volumes: z.array(z.number()).optional(),
  folderSeasons: z.array(z.number()).optional(),
  folderEpisodes: z.array(z.number()).optional(),
  episodes: z.array(z.number()).optional(),
  // seasonEpisode: z.array(z.string()).optional(),
  edition: z.string().optional(),
  remastered: z.boolean().optional(),
  repack: z.boolean().optional(),
  uncensored: z.boolean().optional(),
  unrated: z.boolean().optional(),
  upscaled: z.boolean().optional(),
  network: z.string().optional(),
  container: z.string().optional(),
  extension: z.string().optional(),
  seasonPack: z.boolean().optional(),
});

export const ParsedStreamSchema = z.object({
  id: z.string().min(1),
  proxied: z.boolean().optional(),
  addon: AddonSchema,
  parsedFile: ParsedFileSchema.optional(),
  message: z.string().max(1000).optional(),
  regexMatched: z
    .object({
      name: z.string().optional(),
      pattern: z.string().min(1).optional(),
      index: z.number(),
    })
    .optional(),
  rankedRegexesMatched: z.array(z.string()).optional(),
  regexScore: z.number().optional(),
  keywordMatched: z.boolean().optional(),
  streamExpressionMatched: z
    .object({
      name: z.string().optional(),
      index: z.number(),
    })
    .optional(),

  rankedStreamExpressionsMatched: z
    .array(z.string().min(1).optional())
    .optional(),
  streamExpressionScore: z.number().optional(),
  size: z.number().optional(),
  folderSize: z.number().optional(),
  type: StreamTypes,
  indexer: z.string().optional(),
  /**Age in hours since upload */
  age: z.number().optional(),
  torrent: z
    .object({
      infoHash: z.string().min(1).optional(),
      fileIdx: z.number().optional(),
      seeders: z.number().optional(),
      sources: z.array(z.string().min(1)).optional(),
      private: z.boolean().optional(),
    })
    .optional(),
  countryWhitelist: z.array(z.string().length(3)).optional(),
  notWebReady: z.boolean().optional(),
  bingeGroup: z.string().min(1).optional(),
  requestHeaders: z.record(z.string().min(1), z.string().min(1)).optional(),
  responseHeaders: z.record(z.string().min(1), z.string().min(1)).optional(),
  videoHash: z.string().min(1).optional(),
  subtitles: z.array(SubtitleSchema).optional(),
  filename: z.string().optional(),
  folderName: z.string().optional(),
  service: z
    .object({
      id: z.enum(constants.SERVICES),
      cached: z.boolean(),
    })
    .optional(),
  duration: z.number().optional(),
  bitrate: z.number().optional(),
  library: z.boolean().optional(),
  seadex: z
    .object({
      isBest: z.boolean(),
      isSeadex: z.boolean(),
    })
    .optional(),
  passthrough: PassthroughSchema.optional(),
  url: z.string().optional(),
  nzbUrl: z.string().optional(),
  servers: z.array(z.string().min(1)).optional(),
  rarUrls: z.array(SourceSchema).nullable().optional(),
  zipUrls: z.array(SourceSchema).nullable().optional(),
  '7zipUrls': z.array(SourceSchema).nullable().optional(),
  tgzUrls: z.array(SourceSchema).nullable().optional(),
  tarUrls: z.array(SourceSchema).nullable().optional(),
  ytId: z.string().min(1).optional(),
  externalUrl: z.string().min(1).optional(),
  error: z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
    })
    .optional(),
  originalName: z.string().optional(),
  originalDescription: z.string().optional(),
});

export type ParsedFile = z.infer<typeof ParsedFileSchema>;

export const ParsedStreams = z.array(ParsedStreamSchema);

export type ParsedStream = z.infer<typeof ParsedStreamSchema>;
export type ParsedStreams = z.infer<typeof ParsedStreams>;

const TrailerSchema = z
  .object({
    source: z.string().min(1),
    type: z.enum(['Trailer', 'Clip', 'Teaser']),
  })
  .passthrough();

const MetaLinkSchema = z
  .object({
    name: z.string().min(1),
    category: z.string().min(1),
    url: z.string().url().or(z.string().startsWith('stremio:///')),
  })
  .passthrough();

const MetaVideoSchema = z
  .object({
    id: z.string(),
    title: z.string().or(z.null()).optional(),
    name: z.string().or(z.null()).optional(),
    released: z.string().datetime().or(z.null()).optional(),
    thumbnail: z.string().or(z.null()).optional(),
    streams: z.array(StreamSchema).or(z.null()).optional(),
    available: z.boolean().or(z.null()).optional(),
    episode: z.number().or(z.null()).optional(),
    season: z.number().or(z.null()).optional(),
    trailers: z.array(TrailerSchema).or(z.null()).optional(),
    overview: z.string().or(z.null()).optional(),
  })
  .passthrough();

const MetaParsedVideoSchema = MetaVideoSchema.extend({
  streams: z.array(ParsedStreamSchema).or(z.null()).optional(),
});

export const MetaPreviewSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string().or(z.null()).optional(),
    poster: z.string().or(z.null()).optional(),
    posterShape: z
      .enum(['square', 'poster', 'landscape', 'regular'])
      .optional(),
    // discover sidebar
    //@deprecated use links instead
    genres: z.array(z.string()).or(z.null()).optional(),
    imdbRating: z.string().or(z.null()).or(z.number()).optional(),
    releaseInfo: z.string().or(z.number()).or(z.null()).optional(),
    //@deprecated
    director: z
      .union([z.array(z.string().or(z.null())), z.null(), z.string()])
      .optional(),
    //@deprecated
    cast: z.array(z.string()).or(z.null()).optional(),
    // background: z.string().min(1).optional(),
    // logo: z.string().min(1).optional(),
    description: z.string().or(z.null()).optional(),
    trailers: z.array(TrailerSchema).or(z.null()).optional(),
    links: z.array(MetaLinkSchema).or(z.null()).optional(),
    // released: z.string().datetime().optional(),
  })
  .passthrough();

export const MetaSchema = MetaPreviewSchema.extend({
  poster: z.string().or(z.null()).optional(),
  background: z.string().or(z.null()).optional(),
  logo: z.string().or(z.null()).optional(),
  videos: z.array(MetaVideoSchema).or(z.null()).optional(),
  runtime: z.coerce.string().or(z.null()).optional(),
  language: z.string().or(z.null()).optional(),
  country: z.string().or(z.null()).optional(),
  awards: z.string().or(z.null()).optional(),
  website: z.string().url().or(z.null()).optional(),
  behaviorHints: z
    .object({
      defaultVideoId: z.string().or(z.null()).optional(),
      hasScheduledVideo: z.boolean().nullable().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

export const ParsedMetaSchema = MetaSchema.extend({
  videos: z.array(MetaParsedVideoSchema).optional().nullable(),
});
export type ParsedMeta = z.infer<typeof ParsedMetaSchema>;

export const MetaResponseSchema = z.object({
  meta: MetaSchema,
});
export const CatalogResponseSchema = z.object({
  metas: z.array(MetaPreviewSchema),
});
export type MetaResponse = z.infer<typeof MetaResponseSchema>;
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type MetaPreview = z.infer<typeof MetaPreviewSchema>;

export const AddonCatalogSchema = z
  .object({
    transportName: z.literal('http'),
    transportUrl: z.string().url(),
    manifest: ManifestSchema,
  })
  .passthrough();
export const AddonCatalogResponseSchema = z.object({
  addons: z.array(AddonCatalogSchema),
});
export type AddonCatalogResponse = z.infer<typeof AddonCatalogResponseSchema>;
export type AddonCatalog = z.infer<typeof AddonCatalogSchema>;

export const ExtrasSchema = z
  .object({
    skip: z.coerce.number().optional(),
    genre: z.string().optional(),
    search: z.string().optional(),
    filename: z.string().optional(),
    videoHash: z.string().optional(),
    videoSize: z.coerce.number().optional(),
  })
  .passthrough();
export type Extras = z.infer<typeof ExtrasSchema>;

export const AIOStream = StreamSchema.extend({
  streamData: z
    .object({
      error: z
        .object({
          title: z.string().min(1),
          description: z.string().min(1),
        })
        .optional(),
      proxied: z.boolean().optional(),
      addon: z.string().optional(),
      filename: z.string().optional(),
      folderName: z.string().optional(),
      service: z
        .object({
          id: z.enum(constants.SERVICES),
          cached: z.boolean(),
        })
        .optional(),
      parsedFile: ParsedFileSchema.optional(),
      message: z.string().max(1000).optional(),
      regexMatched: z
        .object({
          name: z.string().optional(),
          pattern: z.string().min(1).optional(),
          index: z.number(),
        })
        .optional(),
      rankedRegexesMatched: z.array(z.string()).optional(),
      regexScore: z.number().optional(),
      keywordMatched: z.boolean().optional(),
      streamExpressionMatched: z
        .object({
          name: z.string().optional(),
          index: z.number(),
        })
        .or(z.number())
        .optional(),
      rankedStreamExpressionsMatched: z
        .array(z.string().min(1).optional())
        .optional(),
      streamExpressionScore: z.number().optional(),
      seadex: z
        .object({
          isBest: z.boolean(),
          isSeadex: z.boolean(),
        })
        .optional(),
      size: z.number().optional(),
      folderSize: z.number().optional(),
      type: StreamTypes.optional(),
      indexer: z.string().optional(),
      age: z.number().or(z.string()).optional(), // Age in hours since upload
      torrent: z
        .object({
          infoHash: z.string().min(1).optional(),
          fileIdx: z.number().optional(),
          seeders: z.number().optional(),
          sources: z.array(z.string().min(1)).optional(),
          private: z.boolean().optional(),
        })
        .optional(),
      duration: z.number().optional(),
      library: z.boolean().optional(),
      id: z.string().min(1).optional(),
    })
    .optional(),
});

export type AIOStream = z.infer<typeof AIOStream>;

const AIOStreamResponseSchema = z.object({
  streams: z.array(AIOStream),
});
export type AIOStreamResponse = z.infer<typeof AIOStreamResponseSchema>;

const PresetMinimalMetadataSchema = z.object({
  ID: z.string(),
  NAME: z.string(),
  LOGO: z.string().optional(),
  DESCRIPTION: z.string(),
  URL: z.string(),
  DISABLED: z
    .object({
      reason: z.string(),
      removed: z.boolean().optional(),
      disabled: z.boolean(),
    })
    .optional(),
  SUPPORTED_RESOURCES: z.array(ResourceSchema),
  SUPPORTED_STREAM_TYPES: z.array(StreamTypes),
  SUPPORTED_SERVICES: z.array(z.string()),
  OPTIONS: z.array(OptionDefinition),
  BUILTIN: z.boolean().optional(),
  CATEGORY: z.enum(constants.PRESET_CATEGORIES).optional(),
});

const PresetMetadataSchema = PresetMinimalMetadataSchema.extend({
  TIMEOUT: z.number(),
  USER_AGENT: z.string(),
});

const StatusResponseSchema = z.object({
  version: z.string(),
  tag: z.string(),
  commit: z.string(),
  buildTime: z.string(),
  commitTime: z.string(),
  users: z.number().or(z.null()),
  settings: z.object({
    baseUrl: z.string().url().optional(),
    addonName: z.string(),
    customHtml: z.string().optional(),
    alternateDesign: z.boolean(),
    protected: z.boolean(),
    regexFilterAccess: z.enum(['none', 'trusted', 'all']),
    selSyncAccess: z.enum(['all', 'trusted']),
    whitelistedSelUrls: z.array(z.string()).optional(),
    allowedRegexPatterns: z
      .object({
        patterns: z.array(z.string()),
        description: z.string().optional(),
        urls: z.array(z.string()).optional(),
      })
      .optional(),
    loggingSensitiveInfo: z.boolean(),
    tmdbApiAvailable: z.boolean(),
    forced: z.object({
      proxy: z.object({
        enabled: z.boolean().or(z.null()),
        id: z.string().or(z.null()),
        url: z.string().or(z.null()),
        publicUrl: z.string().or(z.null()),
        publicIp: z.string().or(z.null()),
        credentials: z.string().or(z.null()),
        disableProxiedAddons: z.boolean(),
        proxiedServices: z.array(z.string()).or(z.null()),
      }),
    }),
    defaults: z.object({
      proxy: z.object({
        enabled: z.boolean().or(z.null()),
        id: z.string().or(z.null()),
        url: z.string().or(z.null()),
        publicUrl: z.string().or(z.null()),
        publicIp: z.string().or(z.null()),
        credentials: z.string().or(z.null()),
        proxiedServices: z.array(z.string()).or(z.null()),
      }),
      timeout: z.number().or(z.null()),
    }),
    presets: z.array(PresetMinimalMetadataSchema),
    services: z.partialRecord(
      z.enum(constants.SERVICES),
      z.object({
        id: z.enum(constants.SERVICES),
        name: z.string(),
        shortName: z.string(),
        knownNames: z.array(z.string()),
        signUpText: z.string(),
        credentials: z.array(OptionDefinition),
      })
    ),
    limits: z.object({
      maxMergedCatalogSources: z.number(),
      maxStreamExpressions: z.number(),
      maxStreamExpressionsTotalCharacters: z.number(),
      maxAddons: z.number(),
    }),
  }),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export type PresetMetadata = z.infer<typeof PresetMetadataSchema>;
export type PresetMinimalMetadata = z.infer<typeof PresetMinimalMetadataSchema>;

export const RPDBIsValidResponse = z.object({
  valid: z.boolean(),
});
export type RPDBIsValidResponse = z.infer<typeof RPDBIsValidResponse>;

export const TopPosterIsValidResponse = z.object({
  valid: z.boolean(),
});
export type TopPosterIsValidResponse = z.infer<typeof TopPosterIsValidResponse>;

export const AIOratingsIsValidResponse = z.object({
  valid: z.boolean(),
});
export type AIOratingsIsValidResponse = z.infer<
  typeof AIOratingsIsValidResponse
>;

export const TemplateSchema = z.object({
  metadata: z.object({
    id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .transform((val) => val ?? crypto.randomUUID()),
    name: z.string().min(1).max(100), // name of the template
    description: z.string().min(1).max(1000), // description of the template
    author: z.string().min(1).max(20), // author of the template
    source: z
      .enum(['builtin', 'custom', 'external'])
      .optional()
      .default('builtin'),
    version: z
      .stringFormat('semver', /^[0-9]+\.[0-9]+\.[0-9]+$/)
      .optional()
      .default('1.0.0'),
    category: z.string().min(1).max(20), // category of the template
    services: z.array(ServiceIds).optional(),
    serviceRequired: z.boolean().optional(), // whether a service is required for this template or not.
    setToSaveInstallMenu: z.boolean().optional().default(true), // whether to set the menu to save-install after importing the template
    sourceUrl: z.url().optional(), // URL from which the template was imported (for auto-updates)
  }),
  config: UserDataSchema.partial(),
});

export type Template = z.infer<typeof TemplateSchema>;
