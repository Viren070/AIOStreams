import {
  UserData,
  UserDataSchema,
  PresetObject,
  Service,
  Option,
  StreamProxyConfig,
  Group,
  PresetMetadata,
} from '../db/schemas.js';
import { AIOStreams } from '../main/index.js';
import { Preset, PresetManager } from '../presets/index.js';
import { createProxy } from '../proxy/index.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import {
  isEncrypted,
  decryptString,
  encryptString,
  Env,
  maskSensitiveInfo,
  RPDB,
  AIOratings,
  FeatureControl,
  RegexAccess,
  compileRegex,
  constants,
  SelAccess,
  createPosterService,
  APIError,
} from './index.js';
import { parseSyncedUrl } from './sync.js';
import { z, ZodError } from 'zod';
import {
  ExitConditionEvaluator,
  GroupConditionEvaluator,
  StreamSelector,
} from '../parser/streamExpression.js';
import { createLogger } from './logger.js';
import { TVDBMetadata } from '../metadata/tvdb.js';
import { FIELD_META } from './fieldMeta.js';

const logger = createLogger('core');

export const formatZodError = (error: ZodError) => {
  return z.prettifyError(error);
};

function parseServiceCredentials(
  raw: string | undefined
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  if (!raw) return result;
  const normalized = raw.replace(/\\n/g, '\n');
  for (const line of normalized.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const dotIdx = trimmed.indexOf('.');
    const eqIdx = trimmed.indexOf('=');
    if (dotIdx === -1 || eqIdx === -1 || dotIdx > eqIdx) continue;
    const serviceId = trimmed.slice(0, dotIdx).trim();
    const credentialId = trimmed.slice(dotIdx + 1, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1);
    if (!serviceId || !credentialId) continue;
    if (!result.has(serviceId)) result.set(serviceId, new Map());
    result.get(serviceId)!.set(credentialId, value);
  }
  return result;
}

const parsedDefaultServiceCredentials = parseServiceCredentials(
  Env.DEFAULT_SERVICE_CREDENTIALS
);
const parsedForcedServiceCredentials = parseServiceCredentials(
  Env.FORCED_SERVICE_CREDENTIALS
);

function getServiceCredentialDefault(
  serviceId: constants.ServiceId,
  credentialId: string
) {
  const fromUnified = parsedDefaultServiceCredentials
    .get(serviceId)
    ?.get(credentialId);
  if (fromUnified !== undefined) return fromUnified;

  // legacy per-service env vars
  switch (serviceId) {
    case constants.REALDEBRID_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.DEFAULT_REALDEBRID_API_KEY;
      }
      break;
    case constants.ALLDEBRID_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.DEFAULT_ALLDEBRID_API_KEY;
      }
      break;
    case constants.PREMIUMIZE_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.DEFAULT_PREMIUMIZE_API_KEY;
      }
      break;
    case constants.DEBRIDLINK_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.DEFAULT_DEBRIDLINK_API_KEY;
      }
      break;
    case constants.TORBOX_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.DEFAULT_TORBOX_API_KEY;
      }
      break;
    case constants.EASYDEBRID_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.DEFAULT_EASYDEBRID_API_KEY;
      }
      break;
    case constants.DEBRIDER_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.DEFAULT_DEBRIDER_API_KEY;
      }
      break;
    case constants.PUTIO_SERVICE:
      switch (credentialId) {
        case 'clientId':
          return Env.DEFAULT_PUTIO_CLIENT_ID;
        case 'clientSecret':
          return Env.DEFAULT_PUTIO_CLIENT_SECRET;
      }
      break;
    case constants.PIKPAK_SERVICE:
      switch (credentialId) {
        case 'email':
          return Env.DEFAULT_PIKPAK_EMAIL;
        case 'password':
          return Env.DEFAULT_PIKPAK_PASSWORD;
      }
      break;
    case constants.OFFCLOUD_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.DEFAULT_OFFCLOUD_API_KEY;
        case 'email':
          return Env.DEFAULT_OFFCLOUD_EMAIL;
        case 'password':
          return Env.DEFAULT_OFFCLOUD_PASSWORD;
      }
      break;
    case constants.SEEDR_SERVICE:
      switch (credentialId) {
        case 'encodedToken':
          return Env.DEFAULT_SEEDR_ENCODED_TOKEN;
      }
      break;
    case constants.EASYNEWS_SERVICE:
      switch (credentialId) {
        case 'username':
          return Env.DEFAULT_EASYNEWS_USERNAME;
        case 'password':
          return Env.DEFAULT_EASYNEWS_PASSWORD;
      }
      break;
    default:
      return null;
  }
}

function getServiceCredentialForced(
  serviceId: constants.ServiceId,
  credentialId: string
) {
  const fromUnified = parsedForcedServiceCredentials
    .get(serviceId)
    ?.get(credentialId);
  if (fromUnified !== undefined) return fromUnified;

  // legacy per-service env vars
  switch (serviceId) {
    case constants.REALDEBRID_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.FORCED_REALDEBRID_API_KEY;
      }
      break;
    case constants.ALLDEBRID_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.FORCED_ALLDEBRID_API_KEY;
      }
      break;
    case constants.PREMIUMIZE_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.FORCED_PREMIUMIZE_API_KEY;
      }
      break;
    case constants.DEBRIDLINK_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.FORCED_DEBRIDLINK_API_KEY;
      }
      break;
    case constants.TORBOX_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.FORCED_TORBOX_API_KEY;
      }
      break;
    case constants.EASYDEBRID_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.FORCED_EASYDEBRID_API_KEY;
      }
      break;
    case constants.DEBRIDER_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.FORCED_DEBRIDER_API_KEY;
      }
      break;
    case constants.PUTIO_SERVICE:
      switch (credentialId) {
        case 'clientId':
          return Env.FORCED_PUTIO_CLIENT_ID;
        case 'clientSecret':
          return Env.FORCED_PUTIO_CLIENT_SECRET;
      }
      break;
    case constants.PIKPAK_SERVICE:
      switch (credentialId) {
        case 'email':
          return Env.FORCED_PIKPAK_EMAIL;
        case 'password':
          return Env.FORCED_PIKPAK_PASSWORD;
      }
      break;
    case constants.OFFCLOUD_SERVICE:
      switch (credentialId) {
        case 'apiKey':
          return Env.FORCED_OFFCLOUD_API_KEY;
        case 'email':
          return Env.FORCED_OFFCLOUD_EMAIL;
        case 'password':
          return Env.FORCED_OFFCLOUD_PASSWORD;
      }
      break;
    case constants.SEEDR_SERVICE:
      switch (credentialId) {
        case 'encodedToken':
          return Env.FORCED_SEEDR_ENCODED_TOKEN;
      }
      break;
    case constants.EASYNEWS_SERVICE:
      switch (credentialId) {
        case 'username':
          return Env.FORCED_EASYNEWS_USERNAME;
        case 'password':
          return Env.FORCED_EASYNEWS_PASSWORD;
      }
      break;
    default:
      return null;
  }
}

export function getEnvironmentServiceDetails(): typeof constants.SERVICE_DETAILS {
  return Object.fromEntries(
    Object.entries(constants.SERVICE_DETAILS)
      .filter(([id, _]) => !FeatureControl.disabledServices.has(id))
      .map(([id, service]) => [
        id as constants.ServiceId,
        {
          id: service.id,
          name: service.name,
          shortName: service.shortName,
          knownNames: service.knownNames,
          signUpText: service.signUpText,
          credentials: service.credentials.map((cred) => ({
            id: cred.id,
            name: cred.name,
            description: cred.description,
            type: cred.type,
            intent: cred.intent,
            required: cred.required,
            default: getServiceCredentialDefault(service.id, cred.id)
              ? encryptString(getServiceCredentialDefault(service.id, cred.id)!)
                  .data
              : null,
            forced: getServiceCredentialForced(service.id, cred.id)
              ? encryptString(getServiceCredentialForced(service.id, cred.id)!)
                  .data
              : null,
            constraints: cred.required
              ? {
                  min: 1,
                }
              : undefined,
          })),
        },
      ])
  ) as typeof constants.SERVICE_DETAILS;
}

export interface ValidateConfigOptions {
  skipErrorsFromAddonsOrProxies?: boolean;
  decryptValues?: boolean;
  increasedManifestTimeout?: boolean;
  bypassManifestCache?: boolean;
}

export async function validateConfig(
  data: any,
  options?: ValidateConfigOptions
): Promise<UserData> {
  const {
    success,
    data: config,
    error,
  } = UserDataSchema.safeParse(
    removeInvalidPresetReferences(applyMigrations(data))
  );
  if (!success) {
    throw new Error(formatZodError(error));
  }

  if (
    Env.ADDON_PASSWORD.length > 0 &&
    !Env.ADDON_PASSWORD.includes(config.addonPassword || '')
  ) {
    throw new APIError(constants.ErrorCode.ADDON_PASSWORD_INVALID);
  }

  validateSyncedRegexUrls(config, options?.skipErrorsFromAddonsOrProxies);
  validateSyncedSelUrls(config, options?.skipErrorsFromAddonsOrProxies);
  validateSyncedPlaceholders(config);

  let excludedStreamExpressions: { expression: string; enabled: boolean }[] =
    [];
  let requiredStreamExpressions: { expression: string; enabled: boolean }[] =
    [];
  let preferredStreamExpressions: { expression: string; enabled: boolean }[] =
    [];
  let includedStreamExpressions: { expression: string; enabled: boolean }[] =
    [];
  let rankedStreamExpressions: {
    expression: string;
    score: number;
    enabled: boolean;
  }[] = [];

  try {
    const result =
      await SelAccess.resolveSyncedExpressionsForValidation(config);
    excludedStreamExpressions = result.excluded;
    requiredStreamExpressions = result.required;
    preferredStreamExpressions = result.preferred;
    includedStreamExpressions = result.included;
    rankedStreamExpressions = result.ranked;
  } catch (error) {
    if (!options?.skipErrorsFromAddonsOrProxies) {
      throw error;
    }
    logger.warn(`Failed to resolve synced stream expressions: ${error}`);
    // Use the expressions from the config directly
    excludedStreamExpressions = config.excludedStreamExpressions || [];
    requiredStreamExpressions = config.requiredStreamExpressions || [];
    preferredStreamExpressions = config.preferredStreamExpressions || [];
    includedStreamExpressions = config.includedStreamExpressions || [];
    rankedStreamExpressions = config.rankedStreamExpressions || [];
  }

  // Validate total stream expressions count across all filter types
  const totalStreamExpressions =
    (excludedStreamExpressions?.length || 0) +
    (requiredStreamExpressions?.length || 0) +
    (preferredStreamExpressions?.length || 0) +
    (includedStreamExpressions?.length || 0);

  if (totalStreamExpressions > Env.MAX_STREAM_EXPRESSIONS) {
    throw new Error(
      `You have ${totalStreamExpressions} total stream expressions across all filter types, but the maximum is ${Env.MAX_STREAM_EXPRESSIONS}`
    );
  }

  // Validate total character count across all stream expressions
  const allExpressions: string[] = [
    ...(excludedStreamExpressions?.map((e) => e.expression) || []),
    ...(requiredStreamExpressions?.map((e) => e.expression) || []),
    ...(preferredStreamExpressions?.map((e) => e.expression) || []),
    ...(includedStreamExpressions?.map((e) => e.expression) || []),
    ...(rankedStreamExpressions?.map((r) => r.expression) || []),
  ];
  const totalCharacters = allExpressions.reduce(
    (sum, expr) => sum + expr.length,
    0
  );

  if (totalCharacters > Env.MAX_STREAM_EXPRESSIONS_TOTAL_CHARACTERS) {
    throw new Error(
      `Your stream expressions have ${totalCharacters} total characters, but the maximum is ${Env.MAX_STREAM_EXPRESSIONS_TOTAL_CHARACTERS}`
    );
  }

  const validations = {
    'excluded keywords': [config.excludedKeywords, Env.MAX_KEYWORD_FILTERS],
    'included keywords': [config.includedKeywords, Env.MAX_KEYWORD_FILTERS],
    'required keywords': [config.requiredKeywords, Env.MAX_KEYWORD_FILTERS],
    'preferred keywords': [config.preferredKeywords, Env.MAX_KEYWORD_FILTERS],
    groups: [config.groups, Env.MAX_GROUPS],
  };

  for (const [name, [items, max]] of Object.entries(validations)) {
    if (items && max && (items as any[]).length > (max as number)) {
      throw new Error(
        `You have ${(items as any[]).length} ${name}, but the maximum is ${max}`
      );
    }
  }

  // validate merged catalogs source limits
  if (config.mergedCatalogs) {
    for (const mergedCatalog of config.mergedCatalogs) {
      if (mergedCatalog.catalogIds.length > Env.MAX_MERGED_CATALOG_SOURCES) {
        throw new Error(
          `Merged catalog "${mergedCatalog.name}" has ${mergedCatalog.catalogIds.length} source catalogs, but the maximum is ${Env.MAX_MERGED_CATALOG_SOURCES}`
        );
      }
    }
  }

  // validate NZB failover count against the server limit
  if (
    config.nzbFailover?.count &&
    config.nzbFailover.count > Env.MAX_NZB_FAILOVER_COUNT
  ) {
    if (options?.skipErrorsFromAddonsOrProxies) {
      config.nzbFailover.count = Env.MAX_NZB_FAILOVER_COUNT;
    } else {
      throw new Error(
        `NZB failover count is ${config.nzbFailover.count}, but the maximum allowed is ${Env.MAX_NZB_FAILOVER_COUNT}`
      );
    }
  }

  // now, validate preset options and service credentials.

  if (config.presets) {
    // ensure uniqenesss of instanceIds
    const instanceIds = new Set<string>();
    for (const preset of config.presets) {
      if (preset.instanceId && instanceIds.has(preset.instanceId)) {
        throw new Error(`Preset instanceId ${preset.instanceId} is not unique`);
      }
      if (preset.instanceId.includes('.')) {
        throw new Error(
          `Preset instanceId ${preset.instanceId} cannot contain a dot`
        );
      }
      instanceIds.add(preset.instanceId);
      try {
        validatePreset(preset);
      } catch (error) {
        if (!options?.skipErrorsFromAddonsOrProxies) {
          throw error;
        }
        logger.warn(`Invalid preset ${preset.instanceId}: ${error}`);
      }
    }
  }

  if (config.groups?.groupings) {
    for (const group of config.groups.groupings) {
      await validateGroup(group);
    }
  }

  if (config.dynamicAddonFetching?.enabled) {
    try {
      if (!config.dynamicAddonFetching.condition) {
        throw new Error('Missing condition');
      }
      await ExitConditionEvaluator.testEvaluate(
        config.dynamicAddonFetching.condition
      );
    } catch (error) {
      throw new Error(`Invalid dynamic addon fetching condition: ${error}`);
    }
  }

  // validate excluded filter condition
  const expressionsToValidate: string[] = [
    ...(config.excludedStreamExpressions?.map((e) => e.expression) ?? []),
    ...(config.requiredStreamExpressions?.map((e) => e.expression) ?? []),
    ...(config.preferredStreamExpressions?.map((e) => e.expression) ?? []),
    ...(config.includedStreamExpressions?.map((e) => e.expression) ?? []),
    ...(config.rankedStreamExpressions?.map((r) => r.expression) ?? []),
  ].filter((expr) => !parseSyncedUrl(expr));

  for (const expression of expressionsToValidate) {
    try {
      await StreamSelector.testSelect(expression);
    } catch (error) {
      throw new Error(`Invalid stream expression: ${expression}: ${error}`);
    }
  }

  // validate precache selector
  if (config.precacheSelector) {
    try {
      await StreamSelector.testSelect(config.precacheSelector);
    } catch (error) {
      throw new Error(`Invalid precache selector: ${error}`);
    }
  }

  if (config.services) {
    config.services = config.services.map((service: Service) =>
      validateService(service, options?.decryptValues)
    );
  }

  config.proxy = await validateProxy(
    config,
    options?.skipErrorsFromAddonsOrProxies,
    options?.decryptValues
  );

  const posterService = createPosterService(config);
  if (config.posterService && posterService) {
    try {
      await posterService.validateApiKey();
    } catch (error) {
      if (!options?.skipErrorsFromAddonsOrProxies) {
        throw new Error(`Invalid Poster API key: ${error}`);
      }
      logger.warn(`Invalid Poster API key: ${error}`);
    }
  }

  const tmdbAuth =
    config.tmdbApiKey ||
    config.tmdbAccessToken ||
    Env.TMDB_API_KEY ||
    Env.TMDB_ACCESS_TOKEN;

  const needTmdb =
    config.titleMatching?.enabled ||
    config.yearMatching?.enabled ||
    config.digitalReleaseFilter?.enabled ||
    config.bitrate?.useMetadataRuntime;

  if (needTmdb && !tmdbAuth) {
    throw new Error(
      'A TMDB API key or access token is required for the following features: title matching, year matching, and digital release filter'
    );
  }

  // validate tmdb auth if it is needed or if it is provided in the config.
  if (needTmdb || config.tmdbAccessToken || config.tmdbApiKey) {
    try {
      const tmdb = new TMDBMetadata({
        accessToken: config.tmdbAccessToken,
        apiKey: config.tmdbApiKey,
      });
      await tmdb.validateAuthorisation();
    } catch (error) {
      if (!options?.skipErrorsFromAddonsOrProxies) {
        throw new Error(
          `Failed to validate TMDB API Key/Access Token: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  if (config.tvdbApiKey) {
    try {
      const tvdb = new TVDBMetadata({
        apiKey: config.tvdbApiKey,
      });
      await tvdb.validateApiKey();
    } catch (error) {
      if (!options?.skipErrorsFromAddonsOrProxies) {
        throw new Error(`Invalid TVDB API key: ${error}`);
      }
      logger.warn(`Invalid TVDB API key: ${error}`);
    }
  }

  if (FeatureControl.disabledServices.size > 0) {
    for (const service of config.services ?? []) {
      if (FeatureControl.disabledServices.has(service.id)) {
        service.enabled = false;
      }
    }
  }

  await validateRegexes(config, options?.skipErrorsFromAddonsOrProxies);

  await new AIOStreams(ensureDecrypted(config), {
    skipFailedAddons: options?.skipErrorsFromAddonsOrProxies ?? false,
    increasedManifestTimeout: options?.increasedManifestTimeout ?? false,
    bypassManifestCache: options?.bypassManifestCache ?? false,
  }).initialise();

  return config;
}

function removeInvalidPresetReferences(config: UserData) {
  // remove references to non-existent presets in options:
  const existingPresetIds = config.presets?.map((preset) => preset.instanceId);
  if (config.proxy) {
    config.proxy.proxiedAddons = config.proxy.proxiedAddons?.filter((addon) =>
      existingPresetIds?.includes(addon)
    );
  }
  if (config.yearMatching) {
    config.yearMatching.addons = config.yearMatching.addons?.filter((addon) =>
      existingPresetIds?.includes(addon)
    );
  }
  if (config.titleMatching) {
    config.titleMatching.addons = config.titleMatching.addons?.filter((addon) =>
      existingPresetIds?.includes(addon)
    );
  }
  if (config.seasonEpisodeMatching) {
    config.seasonEpisodeMatching.addons =
      config.seasonEpisodeMatching.addons?.filter((addon) =>
        existingPresetIds?.includes(addon)
      );
  }
  if (config.groups?.groupings) {
    config.groups.groupings = config.groups.groupings.map((group) => ({
      ...group,
      addons: group.addons?.filter((addon) =>
        existingPresetIds?.includes(addon)
      ),
    }));
  }

  if (config.serviceWrap?.presets) {
    config.serviceWrap.presets = config.serviceWrap.presets.filter((preset) =>
      existingPresetIds?.includes(preset)
    );
  }
  return config;
}

export function applyMigrations(config: any): UserData {
  if (
    config.deduplicator &&
    typeof config.deduplicator.multiGroupBehaviour === 'string'
  ) {
    switch (config.deduplicator.multiGroupBehaviour as string) {
      case 'remove_uncached':
        config.deduplicator.multiGroupBehaviour = 'aggressive';
        break;
      case 'remove_uncached_same_service':
        config.deduplicator.multiGroupBehaviour = 'conservative';
        break;
      case 'remove_nothing':
        config.deduplicator.multiGroupBehaviour = 'keep_all';
        break;
    }
  }

  if (typeof config.digitalReleaseFilter === 'boolean') {
    const oldValue = config.digitalReleaseFilter;
    config.digitalReleaseFilter = {
      enabled: oldValue,
      tolerance: 1,
      requestTypes: ['movie', 'series', 'anime'],
      addons: [],
    };
  }
  if (config.titleMatching?.matchYear) {
    config.yearMatching = {
      enabled: true,
      tolerance: config.titleMatching.yearTolerance
        ? config.titleMatching.yearTolerance
        : 1,
      requestTypes: config.titleMatching.requestTypes ?? [],
      addons: config.titleMatching.addons ?? [],
    };
    delete config.titleMatching.matchYear;
  }

  if (Array.isArray(config.groups)) {
    config.groups = {
      enabled: config.disableGroups ? false : true,
      groupings: config.groups,
      behaviour: 'parallel',
    };
  }

  if (config.showStatistics || config.statisticsPosition) {
    config.statistics = {
      enabled: config.showStatistics ?? false,
      position: config.statisticsPosition ?? 'bottom',
      statsToShow: ['addon', 'filter', 'timing'],
      ...(config.statistics ?? {}),
    };
    delete config.showStatistics;
    delete config.statisticsPosition;
  }

  const migrateHOSBS = (
    type: 'preferred' | 'required' | 'excluded' | 'included'
  ) => {
    if (Array.isArray(config[type + 'Encodes'])) {
      config[type + 'Encodes'] = config[type + 'Encodes'].filter(
        (encode: string) => {
          if (encode === 'H-OU' || encode === 'H-SBS') {
            // add H-OU and H-SBS to visual tags if in encodes.
            config[type + 'VisualTags'] = [
              ...(config[type + 'VisualTags'] ?? []),
              encode,
            ];
            // filter out H-OU and H-SBS from encodes
            return false;
          }
          return true;
        }
      );
    }
  };

  migrateHOSBS('preferred');
  migrateHOSBS('required');
  migrateHOSBS('excluded');
  migrateHOSBS('included');

  // migrate comparisons of queryType to 'anime' to 'anime.series' or 'anime.movie'
  const migrateAnimeQueryTypeInExpression = (expr?: string) => {
    if (typeof expr !== 'string') return expr as any;
    // Replace equality comparisons
    let updated = expr.replace(
      /queryType\s*==\s*(["'])anime\1/g,
      "(queryType == 'anime.series' or queryType == 'anime.movie')"
    );
    updated = updated.replace(
      /(["'])anime\1\s*==\s*queryType/g,
      "(queryType == 'anime.series' or queryType == 'anime.movie')"
    );
    // Replace inequality comparisons
    updated = updated.replace(
      /queryType\s*!=\s*(["'])anime\1/g,
      "(queryType != 'anime.series' and queryType != 'anime.movie')"
    );
    updated = updated.replace(
      /(["'])anime\1\s*!=\s*queryType/g,
      "(queryType != 'anime.series' and queryType != 'anime.movie')"
    );
    return updated;
  };

  const expressionLists = [
    'excludedStreamExpressions',
    'requiredStreamExpressions',
    'includedStreamExpressions',
    'preferredStreamExpressions',
  ] as const;

  for (const key of expressionLists) {
    if (Array.isArray((config as any)[key])) {
      (config as any)[key] = (config as any)[key].map((expr: unknown) => {
        if (typeof expr === 'string') {
          return migrateAnimeQueryTypeInExpression(expr);
        }
        if (typeof expr === 'object' && expr !== null && 'expression' in expr) {
          return {
            ...(expr as any),
            expression: migrateAnimeQueryTypeInExpression(
              (expr as any).expression
            ),
          };
        }
        return expr;
      });
    }
  }

  if (config.dynamicAddonFetching?.condition) {
    config.dynamicAddonFetching.condition = migrateAnimeQueryTypeInExpression(
      config.dynamicAddonFetching.condition
    );
  }

  if (config.groups?.groupings) {
    config.groups.groupings = config.groups.groupings.map((group: any) => ({
      ...group,
      condition: migrateAnimeQueryTypeInExpression(group.condition),
    }));
  }

  // migrate rpdbUseRedirectApi to usePosterRedirectApi
  if (
    config.rpdbUseRedirectApi !== undefined &&
    config.usePosterRedirectApi === undefined
  ) {
    config.usePosterRedirectApi = config.rpdbUseRedirectApi;
    delete config.rpdbUseRedirectApi;
  }

  // migrate 'rpdb' to 'usePosterService' in all catalog modifications
  if (Array.isArray(config.catalogModifications)) {
    for (const mod of config.catalogModifications) {
      if (mod.usePosterService === undefined && mod.rpdb === true) {
        mod.usePosterService = true;
      }
      delete mod.rpdb;
    }
  }

  // migrate alwaysPrecache to precacheCondition, then precacheCondition to precacheSelector
  if (config.precacheSelector === undefined && config.precacheNextEpisode) {
    // First handle the old precacheCondition field
    if (config.precacheCondition !== undefined) {
      // Convert condition to selector format
      config.precacheSelector = `${config.precacheCondition} ? uncached(streams) : []`;
    } else {
      // Handle even older alwaysPrecache field
      config.precacheSelector =
        config.alwaysPrecache === true
          ? 'true ? uncached(streams) : []'
          : constants.DEFAULT_PRECACHE_SELECTOR;
    }
  }
  delete config.alwaysPrecache;
  delete config.precacheCondition;

  // migrate stream expressions from string[] to {expression, enabled}[]
  const streamExpressionKeys = [
    'excludedStreamExpressions',
    'requiredStreamExpressions',
    'preferredStreamExpressions',
    'includedStreamExpressions',
  ] as const;
  for (const key of streamExpressionKeys) {
    if (Array.isArray(config[key])) {
      config[key] = config[key].map((item: unknown) =>
        typeof item === 'string' ? { expression: item, enabled: true } : item
      );
    }
  }

  // migrate forceToTop at addon level to pinPosition set to 'top'
  if (config.presets && Array.isArray(config.presets)) {
    config.presets = config.presets.map((preset: any) => {
      if (
        preset.options?.forceToTop === true &&
        preset.options.pinPosition === undefined
      ) {
        delete preset.options.forceToTop;
        return {
          ...preset,
          options: {
            ...preset.options,
            pinPosition: 'top',
          },
        };
      }
      return preset;
    });
  }

  if (config.formatter && config.formatter.definition) {
    config.formatter.definitions = {
      ...(config.formatter.definitions ?? {}),
      custom: config.formatter.definition,
    };
    delete config.formatter.definition;
  }

  return config;
}

async function validateRegexes(config: UserData, skipErrors: boolean = false) {
  // Resolve synced URL patterns for validation only — does not modify config.
  let synced = {
    excluded: [] as string[],
    included: [] as string[],
    required: [] as string[],
    preferred: [] as { name: string; pattern: string; score?: number }[],
    ranked: [] as { name?: string; pattern: string; score: number }[],
  };
  try {
    synced = await RegexAccess.resolveSyncedRegexesForValidation(config);
  } catch (error) {
    if (!skipErrors) throw error;
    logger.warn(`Failed to resolve synced regex patterns: ${error}`);
  }

  // All patterns to validate: synced (from URLs) + direct (from config), deduplicated.
  const regexes = [
    ...new Set([
      ...synced.excluded,
      ...(config.excludedRegexPatterns || []),
      ...synced.included,
      ...(config.includedRegexPatterns || []),
      ...synced.required,
      ...(config.requiredRegexPatterns || []),
      ...synced.preferred.map((r) => r.pattern),
      ...(config.preferredRegexPatterns || []).map((r) => r.pattern),
      ...synced.ranked.map((r) => r.pattern),
      ...(config.rankedRegexPatterns || []).map((r) => r.pattern),
    ]),
  ].filter((pattern) => !parseSyncedUrl(pattern));

  if (regexes.length === 0) return;

  const regexAllowed = await RegexAccess.isRegexAllowed(config, regexes);

  if (!regexAllowed) {
    if (!skipErrors) {
      const allowedPatterns = (await RegexAccess.allowedRegexPatterns())
        .patterns;
      const notAllowed = regexes.filter((r) => !allowedPatterns.includes(r));
      if (notAllowed.length === regexes.length) {
        throw new Error(
          'You do not have permission to use regex filters, please remove them from your config'
        );
      }
      throw new Error(
        `You are only permitted to use specific regex patterns, you have ${notAllowed.length} / ${regexes.length} regexes that are not allowed. Please remove them from your config.`
      );
    }
    return;
  }

  await Promise.all(
    regexes.map(async (regex) => {
      try {
        await compileRegex(regex);
      } catch (error: any) {
        logger.error(`Invalid regex: ${regex}: ${error.message}`);
        throw new Error(`Invalid regex: ${regex}: ${error.message}`);
      }
    })
  );
}

function validateSyncedRegexUrls(
  config: UserData,
  skipErrors: boolean = false
) {
  const isUnrestricted =
    Env.REGEX_FILTER_ACCESS === 'all' ||
    (Env.REGEX_FILTER_ACCESS === 'trusted' && config.trusted);

  if (isUnrestricted) return;

  const allowedUrls = RegexAccess.getAllowedUrls();
  const urlsToCheck = [
    ...(config.syncedIncludedRegexUrls || []),
    ...(config.syncedExcludedRegexUrls || []),
    ...(config.syncedRequiredRegexUrls || []),
    ...(config.syncedPreferredRegexUrls || []),
    ...(config.syncedRankedRegexUrls || []),
  ];

  const invalidUrls = urlsToCheck.filter((url) => !allowedUrls.includes(url));

  if (invalidUrls.length > 0) {
    if (!skipErrors) {
      throw new Error(
        `Forbidden URL(s) in regex configuration: ${invalidUrls.join(', ')}`
      );
    }
  }
}

function validateSyncedSelUrls(config: UserData, skipErrors: boolean = false) {
  const isUnrestricted =
    Env.SEL_SYNC_ACCESS === 'all' ||
    (Env.SEL_SYNC_ACCESS === 'trusted' && config.trusted);

  if (isUnrestricted) return;

  const allowedUrls = SelAccess.getAllowedUrls();
  const urlsToCheck = [
    ...(config.syncedIncludedStreamExpressionUrls || []),
    ...(config.syncedExcludedStreamExpressionUrls || []),
    ...(config.syncedRequiredStreamExpressionUrls || []),
    ...(config.syncedPreferredStreamExpressionUrls || []),
    ...(config.syncedRankedStreamExpressionUrls || []),
  ];

  const invalidUrls = urlsToCheck.filter((url) => !allowedUrls.includes(url));

  if (invalidUrls.length > 0) {
    if (!skipErrors) {
      throw new Error(
        `Forbidden URL(s) in stream expression sync configuration: ${invalidUrls.join(', ')}`
      );
    }
  }
}

/**
 * Validate that every `<SYNCED: url>` placeholder in a values array
 * references a URL present in the corresponding synced URLs array.
 */
function validateSyncedPlaceholders(config: UserData) {
  const checks: {
    valuesKey: keyof UserData;
    syncedKey: keyof UserData;
    extract: (item: any) => string;
  }[] = [
    {
      valuesKey: 'excludedRegexPatterns',
      syncedKey: 'syncedExcludedRegexUrls',
      extract: (v) => v,
    },
    {
      valuesKey: 'includedRegexPatterns',
      syncedKey: 'syncedIncludedRegexUrls',
      extract: (v) => v,
    },
    {
      valuesKey: 'requiredRegexPatterns',
      syncedKey: 'syncedRequiredRegexUrls',
      extract: (v) => v,
    },
    {
      valuesKey: 'preferredRegexPatterns',
      syncedKey: 'syncedPreferredRegexUrls',
      extract: (v) => v.pattern,
    },
    {
      valuesKey: 'rankedRegexPatterns',
      syncedKey: 'syncedRankedRegexUrls',
      extract: (v) => v.pattern,
    },
    {
      valuesKey: 'excludedStreamExpressions',
      syncedKey: 'syncedExcludedStreamExpressionUrls',
      extract: (v) => v.expression,
    },
    {
      valuesKey: 'includedStreamExpressions',
      syncedKey: 'syncedIncludedStreamExpressionUrls',
      extract: (v) => v.expression,
    },
    {
      valuesKey: 'requiredStreamExpressions',
      syncedKey: 'syncedRequiredStreamExpressionUrls',
      extract: (v) => v.expression,
    },
    {
      valuesKey: 'preferredStreamExpressions',
      syncedKey: 'syncedPreferredStreamExpressionUrls',
      extract: (v) => v.expression,
    },
    {
      valuesKey: 'rankedStreamExpressions',
      syncedKey: 'syncedRankedStreamExpressionUrls',
      extract: (v) => v.expression,
    },
  ];

  const invalid: string[] = [];

  for (const { valuesKey, syncedKey, extract } of checks) {
    const values = (config as any)[valuesKey] as any[] | undefined;
    if (!values?.length) continue;

    const syncedUrls = new Set<string>((config as any)[syncedKey] ?? []);

    for (const entry of values) {
      const field = extract(entry);
      const url = parseSyncedUrl(field);
      if (url && !syncedUrls.has(url)) {
        invalid.push(url);
      }
    }
  }

  if (invalid.length > 0) {
    throw new Error(
      `Found synced placeholder(s) referencing URL(s) not in the synced URLs list: ${invalid.join(', ')}`
    );
  }
}

function ensureDecrypted(config: UserData): UserData {
  const decryptedConfig: UserData = structuredClone(config);

  // Helper function to decrypt a value if needed
  const tryDecrypt = (value: any, context: string) => {
    if (!isEncrypted(value)) return value;
    const { success, data, error } = decryptString(value);
    if (!success) {
      throw new Error(`Failed to decrypt ${context}: ${error}`);
    }
    return data;
  };

  // Decrypt service credentials
  for (const service of decryptedConfig.services ?? []) {
    if (!service.credentials) continue;
    for (const [credential, value] of Object.entries(service.credentials)) {
      service.credentials[credential] = tryDecrypt(
        value,
        `credential ${credential}`
      );
    }
  }
  // Decrypt proxy config
  if (decryptedConfig.proxy) {
    decryptedConfig.proxy.credentials = decryptedConfig.proxy.credentials
      ? tryDecrypt(decryptedConfig.proxy.credentials, 'proxy credentials')
      : undefined;
    decryptedConfig.proxy.url = decryptedConfig.proxy.url
      ? tryDecrypt(decryptedConfig.proxy.url, 'proxy URL')
      : undefined;
    decryptedConfig.proxy.publicUrl = decryptedConfig.proxy.publicUrl
      ? tryDecrypt(decryptedConfig.proxy.publicUrl, 'proxy public URL')
      : undefined;
  }

  return decryptedConfig;
}

function validateService(
  service: Service,
  decryptValues: boolean = false
): Service {
  const serviceMeta = getEnvironmentServiceDetails()[service.id];

  if (!serviceMeta) {
    throw new Error(`Service ${service.id} not found`);
  }

  if (serviceMeta.credentials.every((cred) => cred.forced)) {
    service.enabled = true;
  }

  if (service.enabled) {
    for (const credential of serviceMeta.credentials) {
      try {
        service.credentials[credential.id] = validateOption(
          credential,
          service.credentials?.[credential.id],
          decryptValues
        );
      } catch (error) {
        throw new Error(
          `The value for credential '${credential.name}' in service '${serviceMeta.name}' is invalid: ${error}`
        );
      }
    }
  }
  return service;
}

function validatePreset(preset: PresetObject) {
  const presetMeta = PresetManager.fromId(preset.type)
    .METADATA as PresetMetadata;

  const optionMetas = presetMeta.OPTIONS;

  if (presetMeta.DISABLED) {
    throw new Error(
      `${presetMeta.NAME} has been ${presetMeta.DISABLED.removed ? 'removed' : 'disabled'}: ${presetMeta.DISABLED.reason}`
    );
  }

  for (const optionMeta of optionMetas) {
    const optionValue = preset.options[optionMeta.id];
    try {
      preset.options[optionMeta.id] = validateOption(optionMeta, optionValue);
    } catch (error) {
      throw new Error(
        `The value for option '${optionMeta.name}' in preset '${presetMeta.NAME}' is invalid: ${error}`
      );
    }
  }
}

async function validateGroup(group: Group) {
  if (!group) {
    return;
  }

  // each group must have at least one addon, and we must be able to parse the condition
  if (group.addons.length === 0) {
    throw new Error('Every group must have at least one addon');
  }

  // we must be able to parse the condition
  let result;
  try {
    result = await GroupConditionEvaluator.testEvaluate(group.condition);
  } catch (error: any) {
    throw new Error(
      `Your group condition - '${group.condition}' - is invalid: ${error.message}`
    );
  }
  if (typeof result !== 'boolean') {
    throw new Error(
      `Your group condition - '${group.condition}' - is invalid. Expected evaluation to a boolean, instead got '${typeof result}'`
    );
  }
}

function validateOption(
  option: Option,
  value: any,
  decryptValues: boolean = false
): any {
  if (typeof value === 'string' && value === 'undefined') {
    value = undefined;
  }
  const forcedValue =
    option.forced !== undefined && option.forced !== null
      ? option.forced
      : undefined;
  if (forcedValue !== undefined) {
    value = forcedValue;
  }
  if (value === undefined) {
    if (option.required) {
      throw new Error(`Option ${option.id} is required, got ${value}`);
    }
    return value;
  }
  if (option.type === 'subsection') {
    for (const subOption of option.subOptions ?? []) {
      // for subsection, the value must be an object
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(
          `The value for subsection option '${option.name}' must be an object, got ${Array.isArray(value) ? 'array' : typeof value}`
        );
      }
      const subValue = value[subOption.id];
      try {
        value[subOption.id] = validateOption(
          subOption,
          subValue,
          decryptValues
        );
      } catch (error) {
        throw new Error(
          `The value for sub-option '${subOption.name}' in subsection option '${option.name}' is invalid: ${error}`
        );
      }
    }
    return value;
  }
  if (option.type === 'multi-select') {
    if (!Array.isArray(value)) {
      throw new Error(
        `Option ${option.id} must be an array, got ${typeof value}`
      );
    }
    if (option.constraints?.max && value.length > option.constraints.max) {
      throw new Error(
        `Option ${option.id} must be at most ${option.constraints.max} items, got ${value.length}`
      );
    }
    if (option.constraints?.min && value.length < option.constraints.min) {
      throw new Error(
        `Option ${option.id} must be at least ${option.constraints.min} items, got ${value.length}`
      );
    }
    return value;
  }

  if (option.type === 'select') {
    if (typeof value !== 'string') {
      throw new Error(
        `Option ${option.id} must be a string, got ${typeof value}`
      );
    }
  }

  if (option.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(
        `Option ${option.id} must be a boolean, got ${typeof value}`
      );
    }
  }

  if (option.type === 'number') {
    if (typeof value !== 'number') {
      throw new Error(
        `Option ${option.id} must be a number, got ${typeof value}`
      );
    }
    if (option.constraints?.min && value < option.constraints.min) {
      throw new Error(
        `Option ${option.id} must be at least ${option.constraints.min}, got ${value}`
      );
    }
    if (option.constraints?.max && value > option.constraints.max) {
      throw new Error(
        `Option ${option.id} must be at most ${option.constraints.max}, got ${value}`
      );
    }
  }

  if (option.type === 'string' || option.type === 'password') {
    if (typeof value !== 'string') {
      throw new Error(
        `Option ${option.id} must be a string, got ${typeof value}: ${value}`
      );
    }
    if (option.constraints?.min && value.length < option.constraints.min) {
      throw new Error(
        `Option ${option.id} must be at least ${option.constraints.min} characters, got ${value.length}`
      );
    }
    if (option.constraints?.max && value.length > option.constraints.max) {
      throw new Error(
        `Option ${option.id} must be at most ${option.constraints.max} characters, got ${value.length}`
      );
    }
  }

  if (option.type === 'password') {
    if (isEncrypted(value) && decryptValues) {
      const { success, data, error } = decryptString(value);
      if (!success) {
        throw new Error(
          `Option ${option.id} is encrypted but failed to decrypt: ${error}`
        );
      }
      value = data;
    }
  }

  if (option.type === 'url') {
    if (forcedValue !== undefined) {
      value = forcedValue;
    }
    if (typeof value !== 'string') {
      throw new Error(
        `Option ${option.id} must be a string, got ${typeof value}`
      );
    }
  }

  return value;
}

async function validateProxy(
  config: UserData,
  skipProxyErrors: boolean = false,
  decryptCredentials: boolean = false
): Promise<StreamProxyConfig> {
  // apply forced values if they exist
  const proxy = config.proxy ?? {};
  proxy.enabled = Env.FORCE_PROXY_ENABLED ?? proxy.enabled;
  proxy.id = Env.FORCE_PROXY_ID ?? proxy.id;
  proxy.url = Env.FORCE_PROXY_URL
    ? (encryptString(Env.FORCE_PROXY_URL).data ?? undefined)
    : (proxy.url ?? undefined);
  let forcedPublicUrl: string | undefined;
  if (
    proxy.url &&
    (Env.FORCE_PUBLIC_PROXY_HOST !== undefined ||
      Env.FORCE_PUBLIC_PROXY_PROTOCOL !== undefined ||
      Env.FORCE_PUBLIC_PROXY_PORT !== undefined)
  ) {
    const proxyUrl = new URL(
      isEncrypted(proxy.url) ? decryptString(proxy.url).data || '' : proxy.url
    );
    const port = Env.FORCE_PUBLIC_PROXY_PORT ?? proxyUrl.port;
    forcedPublicUrl = `${Env.FORCE_PUBLIC_PROXY_PROTOCOL ?? proxyUrl.protocol}://${Env.FORCE_PUBLIC_PROXY_HOST ?? proxyUrl.hostname}${port ? `:${port}` : ''}`;
  }
  forcedPublicUrl = Env.FORCE_PROXY_PUBLIC_URL ?? forcedPublicUrl;
  proxy.publicUrl = forcedPublicUrl
    ? (encryptString(forcedPublicUrl).data ?? undefined)
    : (proxy.publicUrl ?? undefined);
  proxy.credentials = Env.FORCE_PROXY_CREDENTIALS
    ? (encryptString(Env.FORCE_PROXY_CREDENTIALS).data ?? undefined)
    : (proxy.credentials ?? undefined);
  proxy.publicIp = Env.FORCE_PROXY_PUBLIC_IP ?? proxy.publicIp;
  proxy.proxiedAddons = Env.FORCE_PROXY_DISABLE_PROXIED_ADDONS
    ? undefined
    : proxy.proxiedAddons;
  proxy.proxiedServices =
    Env.FORCE_PROXY_PROXIED_SERVICES ?? proxy.proxiedServices;
  if (proxy.enabled) {
    if (!proxy.id) {
      throw new Error('Proxy ID is required');
    }
    if (proxy.id === constants.BUILTIN_SERVICE) {
      proxy.url = Env.BASE_URL;
    }
    if (!proxy.url) {
      throw new Error('Proxy URL is required');
    }
    if (!proxy.credentials) {
      throw new Error('Proxy credentials are required');
    }

    if (isEncrypted(proxy.credentials) && decryptCredentials) {
      const { success, data, error } = decryptString(proxy.credentials);
      if (!success) {
        throw new Error(
          `Proxy credentials for ${proxy.id} are encrypted but failed to decrypt: ${error}`
        );
      }
      proxy.credentials = data;
    }
    if (isEncrypted(proxy.url) && decryptCredentials) {
      const { success, data, error } = decryptString(proxy.url);
      if (!success) {
        throw new Error(
          `Proxy URL for ${proxy.id} is encrypted but failed to decrypt: ${error}`
        );
      }
      proxy.url = data;
    }
    if (proxy.publicUrl && isEncrypted(proxy.publicUrl) && decryptCredentials) {
      const { success, data, error } = decryptString(proxy.publicUrl);
      if (!success) {
        throw new Error(
          `Proxy public URL for ${proxy.id} is encrypted but failed to decrypt: ${error}`
        );
      }
      proxy.publicUrl = data;
    }

    // use decrypted proxy config for validation.
    const ProxyService = createProxy(ensureDecrypted(config).proxy ?? {});

    try {
      proxy.publicIp || (await ProxyService.getPublicIp());
    } catch (error) {
      if (!skipProxyErrors) {
        logger.error(
          `Failed to get the public IP of the proxy service ${proxy.id} (${maskSensitiveInfo(proxy.url)}): ${error}`
        );
        throw new Error(
          `Failed to get the public IP of the proxy service ${proxy.id}: ${error}`
        );
      }
    }
  }
  return proxy;
}

// ---------------------------------------------------------------------------
// Config inheritance / parent merging
// ---------------------------------------------------------------------------

// prettier-ignore
const FILTER_FIELDS: (keyof UserData)[] = [
  'excludedResolutions', 'includedResolutions', 'requiredResolutions', 'preferredResolutions',
  'excludedQualities', 'includedQualities', 'requiredQualities', 'preferredQualities',
  'excludedLanguages', 'includedLanguages', 'requiredLanguages', 'preferredLanguages',
  'excludedSubtitles', 'includedSubtitles', 'requiredSubtitles', 'preferredSubtitles',
  'excludedVisualTags', 'includedVisualTags', 'requiredVisualTags', 'preferredVisualTags',
  'excludedAudioTags', 'includedAudioTags', 'requiredAudioTags', 'preferredAudioTags',
  'excludedAudioChannels', 'includedAudioChannels', 'requiredAudioChannels', 'preferredAudioChannels',
  'excludedStreamTypes', 'includedStreamTypes', 'requiredStreamTypes', 'preferredStreamTypes',
  'excludedEncodes', 'includedEncodes', 'requiredEncodes', 'preferredEncodes',
  'excludedRegexPatterns', 'includedRegexPatterns', 'requiredRegexPatterns',
  'preferredRegexPatterns', 'rankedRegexPatterns', 'regexOverrides', 'selOverrides',
  'syncedPreferredRegexUrls', 'syncedExcludedRegexUrls', 'syncedIncludedRegexUrls',
  'syncedRequiredRegexUrls', 'syncedRankedRegexUrls',
  'syncedPreferredStreamExpressionUrls', 'syncedExcludedStreamExpressionUrls',
  'syncedIncludedStreamExpressionUrls', 'syncedRequiredStreamExpressionUrls',
  'syncedRankedStreamExpressionUrls',
  'excludedStreamExpressions', 'requiredStreamExpressions', 'preferredStreamExpressions',
  'includedStreamExpressions', 'rankedStreamExpressions',
  'excludedKeywords', 'includedKeywords', 'requiredKeywords', 'preferredKeywords',
  'excludedReleaseGroups', 'includedReleaseGroups', 'requiredReleaseGroups', 'preferredReleaseGroups',
  'enableSeadex', 'excludeSeasonPacks',
  'excludeCached', 'excludeCachedFromAddons', 'excludeCachedFromServices',
  'excludeCachedFromStreamTypes', 'excludeCachedMode',
  'excludeUncached', 'excludeUncachedFromAddons', 'excludeUncachedFromServices',
  'excludeUncachedFromStreamTypes', 'excludeUncachedMode',
  'excludeSeederRange', 'includeSeederRange', 'requiredSeederRange', 'seederRangeTypes',
  'excludeAgeRange', 'includeAgeRange', 'requiredAgeRange', 'ageRangeTypes',
  'digitalReleaseFilter', 'size', 'bitrate', 'titleMatching', 'yearMatching', 'seasonEpisodeMatching'
];

// prettier-ignore
const SORTING_FIELDS: (keyof UserData)[] = [
  'sortCriteria', 'deduplicator', 'resultLimits',
];

// prettier-ignore
const FORMATTER_FIELDS: (keyof UserData)[] = [
  'formatter',
];

// prettier-ignore
const PROXY_FIELDS: (keyof UserData)[] = [
  'proxy',
];

// prettier-ignore
const METADATA_FIELDS: (keyof UserData)[] = [
  'tmdbApiKey', 'tmdbAccessToken', 'tvdbApiKey',
  'rpdbApiKey', 'topPosterApiKey', 'aioratingsApiKey', 'aioratingsProfileId',
  'openposterdbApiKey', 'openposterdbUrl', 'posterService',
  'usePosterRedirectApi', 'usePosterServiceForMeta',
];

// prettier-ignore
const MISC_FIELDS: (keyof UserData)[] = [
  'autoPlay', 'areYouStillThere', 'statistics', 'dynamicAddonFetching',
  'nzbFailover', 'serviceWrap', 'cacheAndPlay', 'preloadStreams', 'precacheSelector',
  'hideErrors', 'hideErrorsForResources', 'addonCategoryColors', 'catalogModifications', 'mergedCatalogs',
  'addonPassword', 'externalDownloads', 'autoRemoveDownloads', 'checkOwned', 'showChanges',
  'randomiseResults', 'enhanceResults', 'enhancePosters',
];

// prettier-ignore
const BRANDING_FIELDS: (keyof UserData)[] = [
  'addonName', 'addonLogo', 'addonBackground', 'addonDescription',
];

// Personal fields are never inherited — always use the child's own values.
// Includes per-user identity and per-instance state that has no meaning across configs.
// prettier-ignore
const PERSONAL_FIELDS: (keyof UserData)[] = [
  'appliedTemplates',
];

/**
 * Merges two arrays using "override by identity" semantics:
 * - Parent entries are the base.
 * - Child entries whose identity matches a parent entry replace it.
 * - Child entries with no matching parent entry are appended.
 * - For primitive arrays (no identityKey), deduplication by value is used.
 */
function extendList(
  parentArr: any[],
  childArr: any[],
  identityKey?: string
): any[] {
  if (!identityKey) {
    const seen = new Set(parentArr);
    const result = [...parentArr];
    for (const item of childArr) {
      if (!seen.has(item)) {
        result.push(item);
        seen.add(item);
      }
    }
    return result;
  }
  const merged = [...parentArr];
  for (const item of childArr) {
    const idx = merged.findIndex((p) => p[identityKey] === item[identityKey]);
    if (idx >= 0) merged[idx] = item;
    else merged.push(item);
  }
  return merged;
}

function applyBinarySection(
  result: UserData,
  parent: UserData,
  strategy: 'inherit' | 'override',
  fields: (keyof UserData)[]
): void {
  if (strategy !== 'inherit') return;
  for (const field of fields) {
    if (parent[field] !== undefined) {
      (result as any)[field] = parent[field];
    } else {
      delete (result as any)[field];
    }
  }
}

export function mergeConfigs(parent: UserData, child: UserData): UserData {
  const strategies = child.parentConfig?.mergeStrategies;
  const result: UserData = { ...child };

  // Presets & groups
  const presetsMerge = strategies?.presets ?? 'inherit';
  if (presetsMerge === 'inherit') {
    result.presets = parent.presets;
    result.groups = parent.groups;
  } else if (presetsMerge === 'extend') {
    const merged = [...(parent.presets ?? [])];
    for (const cp of child.presets ?? []) {
      const idx = merged.findIndex((p) => p.instanceId === cp.instanceId);
      if (idx >= 0) merged[idx] = cp;
      else merged.push(cp);
    }
    result.presets = merged;
    result.groups = child.groups ?? parent.groups;
  }
  // 'override': keep child's presets already in result

  // Services
  const servicesMerge = strategies?.services ?? 'inherit';
  if (servicesMerge === 'inherit') {
    result.services = parent.services;
  } else if (servicesMerge === 'extend') {
    const merged = [...(parent.services ?? [])];
    for (const cs of child.services ?? []) {
      if (cs.enabled === false) continue;
      const idx = merged.findIndex((s) => s.id === cs.id);
      if (idx >= 0) {
        merged[idx] = cs;
      } else {
        merged.push(cs);
      }
    }
    result.services = merged;
  }
  // 'override': keep child's services already in result

  applyBinarySection(
    result,
    parent,
    strategies?.filters ?? 'inherit',
    FILTER_FIELDS
  );
  applyBinarySection(
    result,
    parent,
    strategies?.sorting ?? 'inherit',
    SORTING_FIELDS
  );
  applyBinarySection(
    result,
    parent,
    strategies?.formatter ?? 'inherit',
    FORMATTER_FIELDS
  );
  applyBinarySection(
    result,
    parent,
    strategies?.proxy ?? 'inherit',
    PROXY_FIELDS
  );
  applyBinarySection(
    result,
    parent,
    strategies?.metadata ?? 'inherit',
    METADATA_FIELDS
  );
  applyBinarySection(
    result,
    parent,
    strategies?.misc ?? 'inherit',
    MISC_FIELDS
  );
  applyBinarySection(
    result,
    parent,
    strategies?.branding ?? 'inherit',
    BRANDING_FIELDS
  );

  // Personal fields always come from the child regardless of merge strategies.
  for (const field of PERSONAL_FIELDS) {
    if (child[field] !== undefined) {
      (result as any)[field] = child[field];
    } else {
      delete (result as any)[field];
    }
  }

  // Per-field overrides - applied last so they win over group strategies.
  const fieldOverrides = strategies?.fieldOverrides ?? {};
  for (const [fieldKey, override] of Object.entries(fieldOverrides)) {
    const field = fieldKey as keyof typeof FIELD_META;
    const meta = FIELD_META[field];
    if (!meta || meta.ignoreForParentConfig) continue;

    if (override === 'inherit') {
      if (parent[field] !== undefined) {
        (result as any)[field] = parent[field];
      } else {
        delete (result as any)[field];
      }
    } else if (override === 'override') {
      if (child[field] !== undefined) {
        (result as any)[field] = child[field];
      } else {
        delete (result as any)[field];
      }
    } else if (override === 'extend') {
      if (meta.type !== 'list') continue; // extend is only valid for list fields
      const parentVal = (parent[field] as any[] | undefined) ?? [];
      const childVal = (child[field] as any[] | undefined) ?? [];
      if (parentVal.length === 0 && childVal.length === 0) {
        delete (result as any)[field];
      } else {
        (result as any)[field] = extendList(
          parentVal,
          childVal,
          meta.identityKey
        );
      }
    }
  }

  return result;
}
