import type { UserData } from '../db/schemas.js';

export type FieldType = 'list' | 'scalar';
export type FieldGroup =
  | 'branding'
  | 'filters'
  | 'sorting'
  | 'formatter'
  | 'proxy'
  | 'metadata'
  | 'misc';

export interface FieldMeta {
  label: string;
  group: FieldGroup;
  type: FieldType;
  /** For object-array list fields, the property used as the identity key for extend merging */
  identityKey?: string;
}

type IgnoredKeys =
  | 'uuid'
  | 'encryptedPassword'
  | 'presets'
  | 'services'
  | 'parentConfig'
  | 'trusted'
  | 'addons'
  | 'groups'
  | 'proxies'
  | 'ip'
  | 'addonCategories'
  | 'appliedTemplates'
  | 'precacheNextEpisode'
  | 'alwaysPrecache'
  | 'precacheCondition';

// prettier-ignore
export const FIELD_META: Omit<Record<keyof UserData, FieldMeta>, IgnoredKeys> = {
  excludedResolutions: { label: 'Excluded Resolutions', group: 'filters', type: 'list' },
  includedResolutions: { label: 'Included Resolutions', group: 'filters', type: 'list' },
  requiredResolutions: { label: 'Required Resolutions', group: 'filters', type: 'list' },
  preferredResolutions: { label: 'Preferred Resolutions', group: 'filters', type: 'list' },

  excludedQualities: { label: 'Excluded Qualities', group: 'filters', type: 'list' },
  includedQualities: { label: 'Included Qualities', group: 'filters', type: 'list' },
  requiredQualities: { label: 'Required Qualities', group: 'filters', type: 'list' },
  preferredQualities: { label: 'Preferred Qualities', group: 'filters', type: 'list' },

  excludedLanguages: { label: 'Excluded Languages', group: 'filters', type: 'list' },
  includedLanguages: { label: 'Included Languages', group: 'filters', type: 'list' },
  requiredLanguages: { label: 'Required Languages', group: 'filters', type: 'list' },
  preferredLanguages: { label: 'Preferred Languages', group: 'filters', type: 'list' },

  excludedSubtitles: { label: 'Excluded Subtitles', group: 'filters', type: 'list' },
  includedSubtitles: { label: 'Included Subtitles', group: 'filters', type: 'list' },
  requiredSubtitles: { label: 'Required Subtitles', group: 'filters', type: 'list' },
  preferredSubtitles: { label: 'Preferred Subtitles', group: 'filters', type: 'list' },

  excludedVisualTags: { label: 'Excluded Visual Tags', group: 'filters', type: 'list' },
  includedVisualTags: { label: 'Included Visual Tags', group: 'filters', type: 'list' },
  requiredVisualTags: { label: 'Required Visual Tags', group: 'filters', type: 'list' },
  preferredVisualTags: { label: 'Preferred Visual Tags', group: 'filters', type: 'list' },

  excludedAudioTags: { label: 'Excluded Audio Tags', group: 'filters', type: 'list' },
  includedAudioTags: { label: 'Included Audio Tags', group: 'filters', type: 'list' },
  requiredAudioTags: { label: 'Required Audio Tags', group: 'filters', type: 'list' },
  preferredAudioTags: { label: 'Preferred Audio Tags', group: 'filters', type: 'list' },

  excludedAudioChannels: { label: 'Excluded Audio Channels', group: 'filters', type: 'list' },
  includedAudioChannels: { label: 'Included Audio Channels', group: 'filters', type: 'list' },
  requiredAudioChannels: { label: 'Required Audio Channels', group: 'filters', type: 'list' },
  preferredAudioChannels: { label: 'Preferred Audio Channels', group: 'filters', type: 'list' },

  excludedStreamTypes: { label: 'Excluded Stream Types', group: 'filters', type: 'list' },
  includedStreamTypes: { label: 'Included Stream Types', group: 'filters', type: 'list' },
  requiredStreamTypes: { label: 'Required Stream Types', group: 'filters', type: 'list' },
  preferredStreamTypes: { label: 'Preferred Stream Types', group: 'filters', type: 'list' },

  excludedEncodes: { label: 'Excluded Encodes', group: 'filters', type: 'list' },
  includedEncodes: { label: 'Included Encodes', group: 'filters', type: 'list' },
  requiredEncodes: { label: 'Required Encodes', group: 'filters', type: 'list' },
  preferredEncodes: { label: 'Preferred Encodes', group: 'filters', type: 'list' },

  excludedKeywords: { label: 'Excluded Keywords', group: 'filters', type: 'list' },
  includedKeywords: { label: 'Included Keywords', group: 'filters', type: 'list' },
  requiredKeywords: { label: 'Required Keywords', group: 'filters', type: 'list' },
  preferredKeywords: { label: 'Preferred Keywords', group: 'filters', type: 'list' },

  excludedReleaseGroups: { label: 'Excluded Release Groups', group: 'filters', type: 'list' },
  includedReleaseGroups: { label: 'Included Release Groups', group: 'filters', type: 'list' },
  requiredReleaseGroups: { label: 'Required Release Groups', group: 'filters', type: 'list' },
  preferredReleaseGroups: { label: 'Preferred Release Groups', group: 'filters', type: 'list' },

  excludedRegexPatterns: { label: 'Excluded Regex Patterns', group: 'filters', type: 'list' },
  includedRegexPatterns: { label: 'Included Regex Patterns', group: 'filters', type: 'list' },
  requiredRegexPatterns: { label: 'Required Regex Patterns', group: 'filters', type: 'list' },
  preferredRegexPatterns: { label: 'Preferred Regex Patterns', group: 'filters', type: 'list', identityKey: 'pattern' },
  rankedRegexPatterns: { label: 'Ranked Regex Patterns', group: 'filters', type: 'list', identityKey: 'pattern' },
  regexOverrides: { label: 'Regex Overrides', group: 'filters', type: 'list', identityKey: 'pattern' },
  syncedExcludedRegexUrls: { label: 'Synced Excluded Regex URLs', group: 'filters', type: 'list' },
  syncedIncludedRegexUrls: { label: 'Synced Included Regex URLs', group: 'filters', type: 'list' },
  syncedRequiredRegexUrls: { label: 'Synced Required Regex URLs', group: 'filters', type: 'list' },
  syncedPreferredRegexUrls: { label: 'Synced Preferred Regex URLs', group: 'filters', type: 'list' },
  syncedRankedRegexUrls: { label: 'Synced Ranked Regex URLs', group: 'filters', type: 'list' },

  excludedStreamExpressions: { label: 'Excluded Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression' },
  includedStreamExpressions: { label: 'Included Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression' },
  requiredStreamExpressions: { label: 'Required Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression' },
  preferredStreamExpressions: { label: 'Preferred Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression' },
  rankedStreamExpressions: { label: 'Ranked Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression' },
  selOverrides: { label: 'Stream Expression Overrides', group: 'filters', type: 'list', identityKey: 'expression' },
  syncedExcludedStreamExpressionUrls: { label: 'Synced Excluded Expression URLs', group: 'filters', type: 'list' },
  syncedIncludedStreamExpressionUrls: { label: 'Synced Included Expression URLs', group: 'filters', type: 'list' },
  syncedRequiredStreamExpressionUrls: { label: 'Synced Required Expression URLs', group: 'filters', type: 'list' },
  syncedPreferredStreamExpressionUrls: { label: 'Synced Preferred Expression URLs', group: 'filters', type: 'list' },
  syncedRankedStreamExpressionUrls: { label: 'Synced Ranked Expression URLs', group: 'filters', type: 'list' },

  enableSeadex: { label: 'SeaDex', group: 'filters', type: 'scalar' },
  excludeSeasonPacks: { label: 'Exclude Season Packs', group: 'filters', type: 'scalar' },

  excludeCached: { label: 'Exclude Cached Streams', group: 'filters', type: 'scalar' },
  excludeCachedFromAddons: { label: 'Exclude Cached — From Addons', group: 'filters', type: 'list' },
  excludeCachedFromServices: { label: 'Exclude Cached — From Services', group: 'filters', type: 'list' },
  excludeCachedFromStreamTypes: { label: 'Exclude Cached — Stream Types', group: 'filters', type: 'list' },
  excludeCachedMode: { label: 'Exclude Cached Mode', group: 'filters', type: 'scalar' },

  excludeUncached: { label: 'Exclude Uncached Streams', group: 'filters', type: 'scalar' },
  excludeUncachedFromAddons: { label: 'Exclude Uncached — From Addons', group: 'filters', type: 'list' },
  excludeUncachedFromServices: { label: 'Exclude Uncached — From Services', group: 'filters', type: 'list' },
  excludeUncachedFromStreamTypes: { label: 'Exclude Uncached — Stream Types', group: 'filters', type: 'list' },
  excludeUncachedMode: { label: 'Exclude Uncached Mode', group: 'filters', type: 'scalar' },

  excludeSeederRange: { label: 'Exclude Seeder Range', group: 'filters', type: 'scalar' },
  includeSeederRange: { label: 'Include Seeder Range', group: 'filters', type: 'scalar' },
  requiredSeederRange: { label: 'Required Seeder Range', group: 'filters', type: 'scalar' },
  seederRangeTypes: { label: 'Seeder Range Types', group: 'filters', type: 'list' },

  excludeAgeRange: { label: 'Exclude Age Range', group: 'filters', type: 'scalar' },
  includeAgeRange: { label: 'Include Age Range', group: 'filters', type: 'scalar' },
  requiredAgeRange: { label: 'Required Age Range', group: 'filters', type: 'scalar' },
  ageRangeTypes: { label: 'Age Range Types', group: 'filters', type: 'list' },

  digitalReleaseFilter: { label: 'Digital Release Filter', group: 'filters', type: 'scalar' },
  size: { label: 'Size Filter', group: 'filters', type: 'scalar' },
  bitrate: { label: 'Bitrate Filter', group: 'filters', type: 'scalar' },
  titleMatching: { label: 'Title Matching', group: 'filters', type: 'scalar' },
  yearMatching: { label: 'Year Matching', group: 'filters', type: 'scalar' },
  seasonEpisodeMatching: { label: 'Season/Episode Matching', group: 'filters', type: 'scalar' },

  sortCriteria: { label: 'Sort Criteria', group: 'sorting', type: 'scalar' },
  deduplicator: { label: 'Deduplicator', group: 'sorting', type: 'scalar' },
  resultLimits: { label: 'Result Limits', group: 'sorting', type: 'scalar' },

  formatter: { label: 'Formatter', group: 'formatter', type: 'scalar' },

  proxy: { label: 'Proxy', group: 'proxy', type: 'scalar' },

  tmdbApiKey: { label: 'TMDB API Key', group: 'metadata', type: 'scalar' },
  tmdbAccessToken: { label: 'TMDB Access Token', group: 'metadata', type: 'scalar' },
  tvdbApiKey: { label: 'TVDB API Key', group: 'metadata', type: 'scalar' },
  rpdbApiKey: { label: 'RPDB API Key', group: 'metadata', type: 'scalar' },
  topPosterApiKey: { label: 'TopPoster API Key', group: 'metadata', type: 'scalar' },
  aioratingsApiKey: { label: 'AIOratings API Key', group: 'metadata', type: 'scalar' },
  aioratingsProfileId: { label: 'AIOratings Profile ID', group: 'metadata', type: 'scalar' },
  openposterdbApiKey: { label: 'OpenPosterDB API Key', group: 'metadata', type: 'scalar' },
  openposterdbUrl: { label: 'OpenPosterDB URL', group: 'metadata', type: 'scalar' },
  posterService: { label: 'Poster Service', group: 'metadata', type: 'scalar' },
  usePosterRedirectApi: { label: 'Use Poster Redirect API', group: 'metadata', type: 'scalar' },
  usePosterServiceForMeta: { label: 'Use Poster Service for Meta', group: 'metadata', type: 'scalar' },

  autoPlay: { label: 'Auto Play', group: 'misc', type: 'scalar' },
  areYouStillThere: { label: 'Are You Still There?', group: 'misc', type: 'scalar' },
  statistics: { label: 'Statistics', group: 'misc', type: 'scalar' },
  dynamicAddonFetching: { label: 'Dynamic Addon Fetching', group: 'misc', type: 'scalar' },
  nzbFailover: { label: 'NZB Failover', group: 'misc', type: 'scalar' },
  serviceWrap: { label: 'Service Wrap', group: 'misc', type: 'scalar' },
  cacheAndPlay: { label: 'Cache and Play', group: 'misc', type: 'scalar' },
  preloadStreams: { label: 'Preload Streams', group: 'misc', type: 'scalar' },
  precacheSelector: { label: 'Precache Selector', group: 'misc', type: 'scalar' },
  hideErrors: { label: 'Hide Errors', group: 'misc', type: 'scalar' },
  hideErrorsForResources: { label: 'Hide Errors for Resources', group: 'misc', type: 'list' },
  precacheSingleStream: { label: 'Precache Single Stream', group: 'misc', type: 'scalar' },
  addonCategoryColors: { label: 'Addon Category Colors', group: 'misc', type: 'scalar' },
  catalogModifications: { label: 'Catalog Modifications', group: 'misc', type: 'scalar' },
  mergedCatalogs: { label: 'Merged Catalogs', group: 'misc', type: 'scalar' },
  addonPassword: { label: 'Addon Password', group: 'misc', type: 'scalar' },
  externalDownloads: { label: 'External Downloads', group: 'misc', type: 'scalar' },
  autoRemoveDownloads: { label: 'Auto Remove Downloads', group: 'misc', type: 'scalar' },
  checkOwned: { label: 'Check Owned', group: 'misc', type: 'scalar' },
  showChanges: { label: 'Show Changes', group: 'misc', type: 'scalar' },
  randomiseResults: { label: 'Randomise Results', group: 'misc', type: 'scalar' },
  enhanceResults: { label: 'Enhance Results', group: 'misc', type: 'scalar' },
  enhancePosters: { label: 'Enhance Posters', group: 'misc', type: 'scalar' },

  addonName: { label: 'Addon Name', group: 'branding', type: 'scalar' },
  addonLogo: { label: 'Addon Logo', group: 'branding', type: 'scalar' },
  addonBackground: { label: 'Addon Background', group: 'branding', type: 'scalar' },
  addonDescription: { label: 'Addon Description', group: 'branding', type: 'scalar' },
};
