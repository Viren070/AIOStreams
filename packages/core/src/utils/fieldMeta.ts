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

export const PAGE_IDS = [
  'home',
  'services',
  'addons',
  'catalogs',
  'filters',
  'results',
  'formatter',
  'playback',
  'app',
  'profiles',
  'stremio',
  'other-apps',
  'configuration',
  'advanced',
  'stats',
] as const;
export type PageId = (typeof PAGE_IDS)[number];

export const FILTER_TAB_IDS = [
  'cache',
  'resolution',
  'quality',
  'encode',
  'stream-type',
  'visual-tag',
  'audio-tag',
  'audio-channel',
  'language',
  'subtitle',
  'seeders',
  'age',
  'matching',
  'keyword',
  'release-group',
  'stream-expression',
  'regex',
  'size',
  'bitrate',
  'limit',
  'deduplicator',
  'miscellaneous',
] as const;
export type FilterTabId = (typeof FILTER_TAB_IDS)[number];

export interface FieldMeta {
  label: string;
  group: FieldGroup;
  type: FieldType;
  /** For object-array list fields, the property used as the identity key for extend merging */
  identityKey?: string;
  /** Configure page the field is on */
  page: PageId;
  /** Filter section holding the field */
  filterTab?: FilterTabId;
  /** DOM id of the section/card to scroll to. Defaults to the field key when omitted. */
  sectionId?: string;
  /** Extra search keywords for the command palette */
  keywords?: string[];
  /** Exclude from the parent config field-overrides UI. Field appears in the command palette but cannot be individually overridden in the parent config modal. */
  ignoreForParentConfig?: boolean;
  /** Exclude from the command palette. For fields with no always-rendered card, e.g. options only settable by importing a JSON config. */
  ignoreForCommandPalette?: boolean;
}

type IgnoredKeys =
  | 'uuid'
  | 'encryptedPassword'
  | 'trusted'
  | 'activeVariants'
  | 'autoVariants'
  | 'healthResults'
  | 'variantSelectorLocation'
  | 'addons'
  | 'proxies'
  | 'ip'
  | 'addonCategories'
  | 'appliedTemplates'
  | 'alwaysPrecache'
  | 'precacheCondition';

// prettier-ignore
export const FIELD_META: Omit<Record<keyof UserData, FieldMeta>, IgnoredKeys> = {
  excludedResolutions: { label: 'Excluded Resolutions', group: 'filters', type: 'list', page: 'filters', filterTab: 'resolution' },
  includedResolutions: { label: 'Included Resolutions', group: 'filters', type: 'list', page: 'filters', filterTab: 'resolution' },
  requiredResolutions: { label: 'Required Resolutions', group: 'filters', type: 'list', page: 'filters', filterTab: 'resolution' },
  preferredResolutions: { label: 'Preferred Resolutions', group: 'filters', type: 'list', page: 'filters', filterTab: 'resolution' },

  excludedQualities: { label: 'Excluded Qualities', group: 'filters', type: 'list', page: 'filters', filterTab: 'quality' },
  includedQualities: { label: 'Included Qualities', group: 'filters', type: 'list', page: 'filters', filterTab: 'quality' },
  requiredQualities: { label: 'Required Qualities', group: 'filters', type: 'list', page: 'filters', filterTab: 'quality' },
  preferredQualities: { label: 'Preferred Qualities', group: 'filters', type: 'list', page: 'filters', filterTab: 'quality' },

  excludedLanguages: { label: 'Excluded Languages', group: 'filters', type: 'list', page: 'filters', filterTab: 'language' },
  includedLanguages: { label: 'Included Languages', group: 'filters', type: 'list', page: 'filters', filterTab: 'language' },
  requiredLanguages: { label: 'Required Languages', group: 'filters', type: 'list', page: 'filters', filterTab: 'language' },
  preferredLanguages: { label: 'Preferred Languages', group: 'filters', type: 'list', page: 'filters', filterTab: 'language' },

  excludedSubtitles: { label: 'Excluded Subtitles', group: 'filters', type: 'list', page: 'filters', filterTab: 'subtitle', keywords: ['subs'] },
  includedSubtitles: { label: 'Included Subtitles', group: 'filters', type: 'list', page: 'filters', filterTab: 'subtitle', keywords: ['subs'] },
  requiredSubtitles: { label: 'Required Subtitles', group: 'filters', type: 'list', page: 'filters', filterTab: 'subtitle', keywords: ['subs'] },
  preferredSubtitles: { label: 'Preferred Subtitles', group: 'filters', type: 'list', page: 'filters', filterTab: 'subtitle', keywords: ['subs'] },

  excludedVisualTags: { label: 'Excluded Visual Tags', group: 'filters', type: 'list', page: 'filters', filterTab: 'visual-tag', keywords: ['hdr', 'dolby vision', 'dv'] },
  includedVisualTags: { label: 'Included Visual Tags', group: 'filters', type: 'list', page: 'filters', filterTab: 'visual-tag', keywords: ['hdr', 'dolby vision', 'dv'] },
  requiredVisualTags: { label: 'Required Visual Tags', group: 'filters', type: 'list', page: 'filters', filterTab: 'visual-tag', keywords: ['hdr', 'dolby vision', 'dv'] },
  preferredVisualTags: { label: 'Preferred Visual Tags', group: 'filters', type: 'list', page: 'filters', filterTab: 'visual-tag', keywords: ['hdr', 'dolby vision', 'dv'] },

  excludedAudioTags: { label: 'Excluded Audio Tags', group: 'filters', type: 'list', page: 'filters', filterTab: 'audio-tag', keywords: ['atmos', 'dts', 'truehd'] },
  includedAudioTags: { label: 'Included Audio Tags', group: 'filters', type: 'list', page: 'filters', filterTab: 'audio-tag', keywords: ['atmos', 'dts', 'truehd'] },
  requiredAudioTags: { label: 'Required Audio Tags', group: 'filters', type: 'list', page: 'filters', filterTab: 'audio-tag', keywords: ['atmos', 'dts', 'truehd'] },
  preferredAudioTags: { label: 'Preferred Audio Tags', group: 'filters', type: 'list', page: 'filters', filterTab: 'audio-tag', keywords: ['atmos', 'dts', 'truehd'] },

  excludedAudioChannels: { label: 'Excluded Audio Channels', group: 'filters', type: 'list', page: 'filters', filterTab: 'audio-channel' },
  includedAudioChannels: { label: 'Included Audio Channels', group: 'filters', type: 'list', page: 'filters', filterTab: 'audio-channel' },
  requiredAudioChannels: { label: 'Required Audio Channels', group: 'filters', type: 'list', page: 'filters', filterTab: 'audio-channel' },
  preferredAudioChannels: { label: 'Preferred Audio Channels', group: 'filters', type: 'list', page: 'filters', filterTab: 'audio-channel' },

  excludedStreamTypes: { label: 'Excluded Stream Types', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-type' },
  includedStreamTypes: { label: 'Included Stream Types', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-type' },
  requiredStreamTypes: { label: 'Required Stream Types', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-type' },
  preferredStreamTypes: { label: 'Preferred Stream Types', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-type' },

  excludedEncodes: { label: 'Excluded Encodes', group: 'filters', type: 'list', page: 'filters', filterTab: 'encode' },
  includedEncodes: { label: 'Included Encodes', group: 'filters', type: 'list', page: 'filters', filterTab: 'encode' },
  requiredEncodes: { label: 'Required Encodes', group: 'filters', type: 'list', page: 'filters', filterTab: 'encode' },
  preferredEncodes: { label: 'Preferred Encodes', group: 'filters', type: 'list', page: 'filters', filterTab: 'encode' },

  excludedKeywords: { label: 'Excluded Keywords', group: 'filters', type: 'list', page: 'filters', filterTab: 'keyword' },
  includedKeywords: { label: 'Included Keywords', group: 'filters', type: 'list', page: 'filters', filterTab: 'keyword' },
  requiredKeywords: { label: 'Required Keywords', group: 'filters', type: 'list', page: 'filters', filterTab: 'keyword' },
  preferredKeywords: { label: 'Preferred Keywords', group: 'filters', type: 'list', page: 'filters', filterTab: 'keyword' },

  excludedReleaseGroups: { label: 'Excluded Release Groups', group: 'filters', type: 'list', page: 'filters', filterTab: 'release-group' },
  includedReleaseGroups: { label: 'Included Release Groups', group: 'filters', type: 'list', page: 'filters', filterTab: 'release-group' },
  requiredReleaseGroups: { label: 'Required Release Groups', group: 'filters', type: 'list', page: 'filters', filterTab: 'release-group' },
  preferredReleaseGroups: { label: 'Preferred Release Groups', group: 'filters', type: 'list', page: 'filters', filterTab: 'release-group' },

  excludedRegexPatterns: { label: 'Excluded Regex Patterns', group: 'filters', type: 'list', page: 'filters', filterTab: 'regex' },
  includedRegexPatterns: { label: 'Included Regex Patterns', group: 'filters', type: 'list', page: 'filters', filterTab: 'regex' },
  requiredRegexPatterns: { label: 'Required Regex Patterns', group: 'filters', type: 'list', page: 'filters', filterTab: 'regex' },
  preferredRegexPatterns: { label: 'Preferred Regex Patterns', group: 'filters', type: 'list', identityKey: 'pattern', page: 'filters', filterTab: 'regex' },
  rankedRegexPatterns: { label: 'Ranked Regex Patterns', group: 'filters', type: 'list', identityKey: 'pattern', page: 'filters', filterTab: 'regex' },
  regexOverrides: { label: 'Regex Overrides', group: 'filters', type: 'list', identityKey: 'pattern', page: 'filters', filterTab: 'regex' },
  syncedExcludedRegexUrls: { label: 'Synced Excluded Regex URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'regex' },
  syncedIncludedRegexUrls: { label: 'Synced Included Regex URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'regex' },
  syncedRequiredRegexUrls: { label: 'Synced Required Regex URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'regex' },
  syncedPreferredRegexUrls: { label: 'Synced Preferred Regex URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'regex' },
  syncedRankedRegexUrls: { label: 'Synced Ranked Regex URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'regex' },

  excludedStreamExpressions: { label: 'Excluded Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', page: 'filters', filterTab: 'stream-expression', keywords: ['sel'] },
  includedStreamExpressions: { label: 'Included Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', page: 'filters', filterTab: 'stream-expression', keywords: ['sel'] },
  requiredStreamExpressions: { label: 'Required Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', page: 'filters', filterTab: 'stream-expression', keywords: ['sel'] },
  preferredStreamExpressions: { label: 'Preferred Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', page: 'filters', filterTab: 'stream-expression', keywords: ['sel'] },
  rankedStreamExpressions: { label: 'Ranked Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', page: 'filters', filterTab: 'stream-expression', keywords: ['sel'] },
  selOverrides: { label: 'Stream Expression Overrides', group: 'filters', type: 'list', identityKey: 'expression', page: 'filters', filterTab: 'stream-expression' },
  syncedExcludedStreamExpressionUrls: { label: 'Synced Excluded Expression URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-expression' },
  syncedIncludedStreamExpressionUrls: { label: 'Synced Included Expression URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-expression' },
  syncedRequiredStreamExpressionUrls: { label: 'Synced Required Expression URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-expression' },
  syncedPreferredStreamExpressionUrls: { label: 'Synced Preferred Expression URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-expression' },
  syncedRankedStreamExpressionUrls: { label: 'Synced Ranked Expression URLs', group: 'filters', type: 'list', page: 'filters', filterTab: 'stream-expression' },

  enableSeadex: { label: 'SeaDex', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'miscellaneous', keywords: ['anime', 'releases.moe'] },
  remuxDb: { label: 'RemuxDB', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'miscellaneous', keywords: ['probe', 'media info'] },
  excludeSeasonPacks: { label: 'Exclude Season Packs', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'miscellaneous', ignoreForCommandPalette: true },

  excludeCached: { label: 'Exclude Cached Streams', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'cache' },
  excludeCachedFromAddons: { label: 'Exclude Cached — From Addons', group: 'filters', type: 'list', page: 'filters', filterTab: 'cache', sectionId: 'excludeCached' },
  excludeCachedFromServices: { label: 'Exclude Cached — From Services', group: 'filters', type: 'list', page: 'filters', filterTab: 'cache', sectionId: 'excludeCached' },
  excludeCachedFromStreamTypes: { label: 'Exclude Cached — Stream Types', group: 'filters', type: 'list', page: 'filters', filterTab: 'cache', sectionId: 'excludeCached' },
  excludeCachedMode: { label: 'Exclude Cached Mode', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'cache', sectionId: 'excludeCached' },

  excludeUncached: { label: 'Exclude Uncached Streams', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'cache' },
  excludeUncachedFromAddons: { label: 'Exclude Uncached — From Addons', group: 'filters', type: 'list', page: 'filters', filterTab: 'cache', sectionId: 'excludeUncached' },
  excludeUncachedFromServices: { label: 'Exclude Uncached — From Services', group: 'filters', type: 'list', page: 'filters', filterTab: 'cache', sectionId: 'excludeUncached' },
  excludeUncachedFromStreamTypes: { label: 'Exclude Uncached — Stream Types', group: 'filters', type: 'list', page: 'filters', filterTab: 'cache', sectionId: 'excludeUncached' },
  excludeUncachedMode: { label: 'Exclude Uncached Mode', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'cache', sectionId: 'excludeUncached' },

  excludeSeederRange: { label: 'Exclude Seeder Range', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'seeders' },
  includeSeederRange: { label: 'Include Seeder Range', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'seeders' },
  requiredSeederRange: { label: 'Required Seeder Range', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'seeders' },
  seederRangeTypes: { label: 'Seeder Range Types', group: 'filters', type: 'list', page: 'filters', filterTab: 'seeders' },

  excludeAgeRange: { label: 'Exclude Age Range', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'age' },
  includeAgeRange: { label: 'Include Age Range', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'age' },
  requiredAgeRange: { label: 'Required Age Range', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'age' },
  ageRangeTypes: { label: 'Age Range Types', group: 'filters', type: 'list', page: 'filters', filterTab: 'age' },

  digitalReleaseFilter: { label: 'Digital Release Filter', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'miscellaneous' },
  size: { label: 'Size Filter', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'size' },
  bitrate: { label: 'Bitrate Filter', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'bitrate' },
  titleMatching: { label: 'Title Matching', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'matching' },
  yearMatching: { label: 'Year Matching', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'matching' },
  seasonEpisodeMatching: { label: 'Season/Episode Matching', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'matching' },
  episodeTitleMatching: { label: 'Episode Title Matching', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'matching' },
  languageInference: { label: 'Language Inference', group: 'filters', type: 'scalar', page: 'filters', filterTab: 'matching' },

  sortCriteria: { label: 'Sort Criteria', group: 'sorting', type: 'scalar', page: 'results', keywords: ['sorting'] },
  deduplicator: { label: 'Deduplicator', group: 'sorting', type: 'scalar', page: 'results', filterTab: 'deduplicator' },
  resultLimits: { label: 'Result Limits', group: 'sorting', type: 'scalar', page: 'results', filterTab: 'limit' },

  formatter: { label: 'Formatter', group: 'formatter', type: 'scalar', page: 'formatter' },

  proxy: { label: 'Proxy', group: 'proxy', type: 'scalar', page: 'playback' },

  tmdbApiKey: { label: 'TMDB API Key', group: 'metadata', type: 'scalar', page: 'services', sectionId: 'tmdb', keywords: ['metadata'] },
  tmdbAccessToken: { label: 'TMDB Access Token', group: 'metadata', type: 'scalar', page: 'services', sectionId : 'tmdb', keywords: ['metadata'] },
  tvdbApiKey: { label: 'TVDB API Key', group: 'metadata', type: 'scalar', page: 'services', keywords: ['metadata'] },
  pmdbApiKey: { label: 'PublicMetaDB API Key', group: 'metadata', type: 'scalar', page: 'app', sectionId: 'jellyfin', keywords: ['pmdb', 'publicmetadb', 'skip intro', 'segments'] },
  rpdbApiKey: { label: 'RPDB API Key', group: 'metadata', type: 'scalar', page: 'catalogs', keywords: ['posters'] },
  topPosterApiKey: { label: 'TopPoster API Key', group: 'metadata', type: 'scalar', page: 'catalogs' },
  aioratingsApiKey: { label: 'AIOratings API Key', group: 'metadata', type: 'scalar', page: 'catalogs', keywords: ['posters'] },
  aioratingsProfileId: { label: 'AIOratings Profile ID', group: 'metadata', type: 'scalar', page: 'catalogs', keywords: ['posters'] },
  openposterdbApiKey: { label: 'OpenPosterDB API Key', group: 'metadata', type: 'scalar', page: 'catalogs' },
  openposterdbUrl: { label: 'OpenPosterDB URL', group: 'metadata', type: 'scalar', page: 'catalogs' },
  openposterdbParameters: { label: 'OpenPosterDB Custom Parameters', group: 'metadata', type: 'scalar', page: 'catalogs' },
  customPosterUrl: { label: 'Custom Poster URL', group: 'metadata', type: 'scalar', page: 'catalogs' },
  posterService: { label: 'Poster Service', group: 'metadata', type: 'scalar', page: 'catalogs' },
  usePosterRedirectApi: { label: 'Use Poster Redirect API', group: 'metadata', type: 'scalar', page: 'catalogs' },
  usePosterServiceForMeta: { label: 'Use Poster Service for Meta', group: 'metadata', type: 'scalar', page: 'catalogs' },

  autoPlay: { label: 'Auto Play', group: 'misc', type: 'scalar', page: 'playback' },
  areYouStillThere: { label: 'Are You Still There?', group: 'misc', type: 'scalar', page: 'playback' },
  statistics: { label: 'Statistics', group: 'misc', type: 'scalar', page: 'results' },
  hideErrors: { label: 'Hide Errors', group: 'misc', type: 'scalar', page: 'results' },
  hideErrorsForResources: { label: 'Hide Errors for Resources', group: 'misc', type: 'list', page: 'results', sectionId: 'hideErrors' },
  externalDownloads: { label: 'External Downloads', group: 'misc', type: 'scalar', page: 'results' },
  preloadStreams: { label: 'Preload Streams', group: 'misc', type: 'scalar', page: 'playback' },
  precacheNextEpisode: { label: 'Precache Next Episode', group: 'misc', type: 'scalar', page: 'playback' },
  precacheSelector: { label: 'Precache Selector', group: 'misc', type: 'scalar', page: 'playback' },
  precacheSingleStream: { label: 'Precache Single Stream', group: 'misc', type: 'scalar', page: 'playback' },

  dynamicAddonFetching: { label: 'Dynamic Addon Fetching', group: 'misc', type: 'scalar', page: 'addons', sectionId: 'fetchStrategy', keywords: ['exit condition', 'dynamic fetching', 'fetch strategy'] },
  addonCategoryColors: { label: 'Addon Category Colors', group: 'misc', type: 'scalar', page: 'addons' },
  catalogModifications: { label: 'Catalog Modifications', group: 'misc', type: 'scalar', page: 'catalogs' },
  newCatalogsDisabled: { label: 'New Catalogs Disabled', group: 'misc', type: 'scalar', page: 'catalogs' },
  upstreamCatalogOrder: { label: 'Upstream Catalog Order', group: 'misc', type: 'scalar', page: 'catalogs' },
  mergedCatalogs: { label: 'Merged Catalogs', group: 'misc', type: 'scalar', page: 'catalogs' },

  failover: { label: 'Failover', group: 'misc', type: 'scalar', page: 'playback' },
  serviceWrap: { label: 'Service Wrap', group: 'misc', type: 'scalar', page: 'services' },
  cacheAndPlay: { label: 'Cache and Play', group: 'misc', type: 'scalar', page: 'playback' },
  jellyfin: { label: 'Jellyfin', group: 'misc', type: 'scalar', page: 'app', keywords: ['jellyfin', 'swiftfin', 'streamyfin', 'findroid', 'infuse', 'kodi'] },
  profiles: { label: 'Profiles', group: 'misc', type: 'list', identityKey: 'id', page: 'profiles', keywords: ['users', 'household', 'pin', 'trackers'], ignoreForParentConfig: true },
  autoRemoveDownloads: { label: 'Auto Remove Downloads', group: 'misc', type: 'scalar', page: 'services' },
  checkOwned: { label: 'Check Owned', group: 'misc', type: 'scalar', page: 'services' },

  accessKey: { label: 'Config Access Key', group: 'misc', type: 'scalar', page: 'configuration' },
  showChanges: { label: 'Show Changes', group: 'misc', type: 'scalar', page: 'configuration' },
  manifestNotice: { label: 'Manifest Change Notices', group: 'misc', type: 'scalar', page: 'stremio', keywords: ['reinstall', 'notice', 'diff'] },
  linkedAccounts: { label: 'Linked Accounts', group: 'misc', type: 'scalar', page: 'stremio', keywords: ['sync', 'stremio', 'aiomanager', 'push'] },

  addonName: { label: 'Addon Name', group: 'branding', type: 'scalar', page: 'configuration', keywords: ['branding'] },
  addonLogo: { label: 'Addon Logo', group: 'branding', type: 'scalar', page: 'configuration', keywords: ['branding'] },
  addonBackground: { label: 'Addon Background', group: 'branding', type: 'scalar', page: 'configuration', keywords: ['branding'] },
  addonDescription: { label: 'Addon Description', group: 'branding', type: 'scalar', page: 'configuration', keywords: ['branding'] },


  presets: { label: 'Addons', group: 'misc', type: 'list', identityKey: 'instanceId', page: 'addons', keywords: ['addons', 'presets'], ignoreForParentConfig: true },
  services: { label: 'Services', group: 'misc', type: 'list', identityKey: 'id', page: 'services', ignoreForParentConfig: true },
  parentConfig: { label: 'Parent Config', group: 'misc', type: 'scalar', page: 'advanced', sectionId: 'parentConfig', keywords: ['inherit', 'link', 'parent'], ignoreForParentConfig: true },
  variants: { label: 'Variants', group: 'misc', type: 'list', identityKey: 'id', page: 'advanced', sectionId: 'variants', keywords: ['variant', 'sub-profile', 'cel', 'config expression', 'override'], ignoreForParentConfig: true },
  groups: { label: 'Groups', group: 'misc', type: 'scalar', page: 'addons', keywords: ['groupings'], ignoreForParentConfig: true, sectionId: 'fetchStrategy' },
  healthChecks: { label: 'Health Checks', group: 'misc', type: 'list', identityKey: 'id', page: 'advanced', sectionId: 'healthChecks', keywords: ['health', 'uptime', 'status', 'variant', 'conditional'], ignoreForParentConfig: true },
};
