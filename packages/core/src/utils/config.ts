import {
  UserData,
  UserDataSchema,
  PresetObject,
  Service,
  Option,
  StreamProxyConfig,
  Group,
} from '../db/schemas.js';
import { AIOStreams } from '../main.js';
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
  FeatureControl,
  compileRegex,
  constants,
} from './index.js';
import { ZodError } from 'zod';
import {
  GroupConditionEvaluator,
  StreamSelector,
} from '../parser/streamExpression.js';
import { createLogger } from './logger.js';
import { TVDBMetadata } from '../metadata/tvdb.js';

const logger = createLogger('core');

export const formatZodError = (error: ZodError) => {
  let errs = [];
  for (const issue of error.issues) {
    errs.push(
      `Invalid value for ${issue.path.join('.')}: ${issue.message}${
        (issue as any).unionErrors
          ? `. Union checks performed:\n${(issue as any).unionErrors
              .map((issue: any) => `- ${formatZodError(issue)}`)
              .join('\n')}`
          : ''
      }`
    );
  }
  return errs.join(' | ');
};

function getServiceCredentialDefault(
  serviceId: constants.ServiceId,
  credentialId: string
) {
  // env mapping
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
  // env mapping
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
            // remove required attribute from field to allow users to remove credentials.
            // server will still validate.
            required: false,
            default: getServiceCredentialDefault(service.id, cred.id)
              ? encryptString(getServiceCredentialDefault(service.id, cred.id)!)
                  .data
              : null,
            forced: getServiceCredentialForced(service.id, cred.id)
              ? encryptString(getServiceCredentialForced(service.id, cred.id)!)
                  .data
              : null,
            constraints: {
              min: 1,
            },
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
    throw new Error(
      'Invalid addon password. Please enter the value of the ADDON_PASSWORD environment variable '
    );
  }
  const validations = {
    'excluded stream expressions': [
      config.excludedStreamExpressions,
      Env.MAX_STREAM_EXPRESSION_FILTERS,
    ],
    'required stream expressions': [
      config.requiredStreamExpressions,
      Env.MAX_STREAM_EXPRESSION_FILTERS,
    ],
    'preferred stream expressions': [
      config.preferredStreamExpressions,
      Env.MAX_STREAM_EXPRESSION_FILTERS,
    ],
    'included stream expressions': [
      config.includedStreamExpressions,
      Env.MAX_STREAM_EXPRESSION_FILTERS,
    ],
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

  // validate excluded filter condition
  const streamExpressions = [
    ...(config.excludedStreamExpressions ?? []),
    ...(config.requiredStreamExpressions ?? []),
    ...(config.preferredStreamExpressions ?? []),
    ...(config.includedStreamExpressions ?? []),
  ];

  for (const expression of streamExpressions) {
    try {
      await StreamSelector.testSelect(expression);
    } catch (error) {
      throw new Error(`Invalid stream expression: ${expression}: ${error}`);
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

  if (config.rpdbApiKey) {
    try {
      const rpdb = new RPDB(config.rpdbApiKey);
      await rpdb.validateApiKey();
    } catch (error) {
      if (!options?.skipErrorsFromAddonsOrProxies) {
        throw new Error(`Invalid RPDB API key: ${error}`);
      }
      logger.warn(`Invalid RPDB API key: ${error}`);
    }
  }

  if (config.titleMatching?.enabled === true) {
    try {
      const tmdb = new TMDBMetadata({
        accessToken: config.tmdbAccessToken,
        apiKey: config.tmdbApiKey,
      });
      await tmdb.validateAuthorisation();
    } catch (error) {
      if (!options?.skipErrorsFromAddonsOrProxies) {
        throw new Error(`Invalid TMDB access token: ${error}`);
      }
      logger.warn(`Invalid TMDB access token: ${error}`);
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
      statsToShow: ['addon', 'filter'],
    };
    delete config.showStatistics;
    delete config.statisticsPosition;
  }
  return config;
}

async function validateRegexes(config: UserData, skipErrors: boolean = false) {
  const excludedRegexes = config.excludedRegexPatterns;
  const includedRegexes = config.includedRegexPatterns;
  const requiredRegexes = config.requiredRegexPatterns;
  const preferredRegexes = config.preferredRegexPatterns;
  const regexAllowed = await FeatureControl.isRegexAllowed(config);

  const regexes = [
    ...(excludedRegexes ?? []),
    ...(includedRegexes ?? []),
    ...(requiredRegexes ?? []),
    ...(preferredRegexes ?? []).map((regex) => regex.pattern),
  ];

  if (!regexAllowed && regexes.length > 0) {
    const allowedPatterns = (await FeatureControl.allowedRegexPatterns())
      .patterns;
    const allowedRegexes = regexes.filter((regex) =>
      allowedPatterns.includes(regex)
    );
    if (allowedRegexes.length === 0) {
      if (!skipErrors) {
        throw new Error(
          'You do not have permission to use regex filters, please remove them from your config'
        );
      }
      return;
    }
    if (allowedRegexes.length !== regexes.length) {
      if (!skipErrors) {
        throw new Error(
          `You are only permitted to use specific regex patterns, you have ${regexes.length - allowedRegexes.length} / ${regexes.length} regexes that are not allowed. Please remove them from your config.`
        );
      }
      return;
    }
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
  const presetMeta = PresetManager.fromId(preset.type).METADATA;

  const optionMetas = presetMeta.OPTIONS;

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
