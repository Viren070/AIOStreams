import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  cleanEnv,
  str,
  host,
  bool,
  json,
  makeValidator,
  makeExactValidator,
  num,
  EnvError,
  port,
  EnvMissingError,
} from 'envalid';
import { ResourceManager } from './resources.js';
import * as constants from './constants.js';
import { randomBytes } from 'crypto';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
} catch (error) {
  console.error('Error loading .env file', error);
}
let metadata: any = undefined;
try {
  metadata = ResourceManager.getResource('metadata.json') || {};
} catch (error) {
  console.error('Error loading metadata.json file', error);
}

const secretKey = makeValidator((x) => {
  if (!/^[0-9a-fA-F]{64}$/.test(x)) {
    throw new EnvError('Secret key must be a 64-character hex string');
  }
  return x;
});

const commaSeparated = makeExactValidator<string[]>((x) => {
  if (x === '') {
    return [];
  }
  const parsed = x.split(',').map((item) => item.trim());
  if (parsed.some((item) => item === '')) {
    throw new EnvError('Comma separated values cannot be empty');
  }
  return parsed;
});

const regexes = makeValidator((x) => {
  // json array of string
  const parsed = JSON.parse(x);
  if (!Array.isArray(parsed)) {
    throw new EnvError('Regexes must be an array');
  }
  // each element must be a string
  parsed.forEach((x) => {
    if (typeof x !== 'string') {
      throw new EnvError('Regexes must be an array of strings');
    }
    try {
      new RegExp(x);
    } catch (e) {
      throw new EnvError(`Invalid regex pattern: ${x}`);
    }
  });
  return parsed;
});

const namedRegexes = makeValidator((x) => {
  // array of objects with properties name and pattern
  const parsed = JSON.parse(x);
  if (!Array.isArray(parsed)) {
    throw new EnvError('Named regexes must be an array');
  }
  // each element must be an object with properties name and pattern
  parsed.forEach((x) => {
    if (typeof x !== 'object' || !x.name || !x.pattern) {
      throw new EnvError(
        'Named regexes must be an array of objects with properties name and pattern'
      );
    }
    try {
      new RegExp(x.pattern);
    } catch (e) {
      throw new EnvError(`Invalid regex pattern: ${x.pattern}`);
    }
  });

  return parsed;
});

const removeTrailingSlash = (x: string) =>
  x.endsWith('/') ? x.slice(0, -1) : x;

const urlOrUrlList = makeExactValidator<readonly string[]>((x) => {
  if (!x) {
    return [];
  }
  if (typeof x !== 'string') {
    throw new EnvError('List of URLs must be a string or an array of strings');
  }
  const validateUrl = (x: string) => {
    try {
      new URL(x);
      return true;
    } catch (e) {
      return false;
    }
  };
  try {
    const urls = JSON.parse(x);
    if (!Array.isArray(urls) || urls.some((x) => !validateUrl(x))) {
      throw new EnvError(
        'List of URLs must be an array of URLs or a single URL'
      );
    }
    return Object.freeze(urls.map(removeTrailingSlash));
  } catch (e) {
    if (typeof x === 'string' && validateUrl(x)) {
      return Object.freeze([removeTrailingSlash(x)]);
    }
    throw new EnvError('Preset URLs must be an array of URLs or a single URL');
  }
});

const url = makeValidator((x) => {
  if (x === '') {
    throw new EnvMissingError(`URL cannot be empty`);
  }
  try {
    new URL(x);
  } catch (e) {
    throw new EnvError(`Invalid URL: ${x}`);
  }
  // remove trailing slash
  return removeTrailingSlash(x);
});

export const forcedPort = makeValidator<string>((input: string) => {
  if (input === '') {
    return '';
  }

  const coerced = +input;
  if (
    Number.isNaN(coerced) ||
    `${coerced}` !== `${input}` ||
    coerced % 1 !== 0 ||
    coerced < 1 ||
    coerced > 65535
  ) {
    throw new EnvError(`Invalid port input: "${input}"`);
  }
  return coerced.toString();
});

const userAgent = makeValidator((x) => {
  if (typeof x !== 'string') {
    throw new Error('User agent must be a string');
  }
  // replace {version} with the version of the addon
  return x.replace(/{version}/g, metadata?.version || 'unknown');
});

// comma separated list of alias:uuid
const aliasedUUIDs = makeValidator((x) => {
  try {
    const aliases: Record<string, { uuid: string; password: string }> = {};
    const parsed = x.split(',').map((x) => {
      const [alias, uuid, password] = x.split(':');
      if (!alias || !uuid || !password) {
        throw new Error('Invalid alias:uuid:password pair');
      } else if (
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
          uuid
        ) === false
      ) {
        throw new Error('Invalid UUID');
      }
      aliases[alias] = { uuid, password };
    });
    return aliases;
  } catch (e) {
    throw new Error(
      `Custom configs must be a valid comma separated list of alias:uuid:password pairs`
    );
  }
});

const readonly = makeValidator((x) => {
  if (x) {
    throw new EnvError('Readonly environment variable, cannot be set');
  }
  return x;
});

const boolOrList = makeValidator((x) => {
  if (typeof x !== 'string') {
    return undefined;
  }
  x = x.toLowerCase();
  if (['true', 'false', '1', '0'].includes(x)) {
    return x === 'true' || x === '1';
  }
  return x.split(',').map((x) => x.trim());
});

const urlMappings = makeValidator<Record<string, string>>((x) => {
  // json object with string properties
  const parsed = JSON.parse(x);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new EnvError('URL mappings must be an object');
  }
  const mappings: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new EnvError(
        'URL mappings must be an object with string properties only'
      );
    }
    try {
      const keyUrl = new URL(removeTrailingSlash(key));
      const valueUrl = new URL(removeTrailingSlash(value));
      mappings[keyUrl.origin] = valueUrl.origin;
    } catch (e) {
      throw new EnvError(
        `Each key and value in the URL mappings must be a valid URL`
      );
    }
  }
  return mappings;
});

export const Env = cleanEnv(process.env, {
  VERSION: readonly({
    default: metadata?.version || 'unknown',
    desc: 'Version of the addon',
  }),
  TAG: readonly({
    default: metadata?.tag || 'unknown',
    desc: 'Tag of the addon',
  }),
  DESCRIPTION: readonly({
    default: metadata?.description || 'unknown',
    desc: 'Description of the addon',
  }),
  NODE_ENV: str({
    default: 'production',
    desc: 'Node environment of the addon',
    choices: ['production', 'development', 'test'],
  }),
  GIT_COMMIT: readonly({
    default: metadata?.commitHash || 'unknown',
    desc: 'Git commit hash of the addon',
  }),
  BUILD_TIME: readonly({
    default: metadata?.buildTime || 'unknown',
    desc: 'Build time of the addon',
  }),
  BUILD_COMMIT_TIME: readonly({
    default: metadata?.commitTime || 'unknown',
    desc: 'Build commit time of the addon',
  }),
  DISABLE_SELF_SCRAPING: bool({
    default: true,
    desc: 'Disable self scraping. If true, addons will not be able to scrape the same AIOStreams instance.',
  }),
  DISABLED_HOSTS: str({
    default: undefined,
    desc: 'Comma separated list of disabled hosts in format of host:reason',
  }),
  DISABLED_ADDONS: str({
    default: undefined,
    desc: 'Comma separated list of disabled addons in format of addon:reason',
  }),
  DISABLED_SERVICES: str({
    default: undefined,
    desc: 'Comma separated list of disabled services in format of service:reason',
  }),
  REGEX_FILTER_ACCESS: str({
    default: 'trusted',
    desc: 'Who can use regex filters',
    choices: ['none', 'trusted', 'all'],
  }),
  BASE_URL: url({
    desc: 'Base URL of the addon, including protocol, hostname, and optionally port',
    example: 'https://aiostreams.example.com',
    devDefault: `http://localhost:${process.env.PORT || 3000}`,
  }),
  INTERNAL_URL: url({
    default: `http://localhost:${process.env.PORT || 3000}`,
    desc: 'Internal URL of the addon, used for internal communication between built-in addons and the server',
  }),
  INTERNAL_SECRET: readonly({
    default: randomBytes(32).toString('hex'),
    desc: 'Internal secret for the addon, used for internal communication between built-in addons and the server',
  }),
  ADDON_NAME: str({
    default: 'AIOStreams',
    desc: 'Name of the addon',
  }),
  ADDON_ID: str({
    default: 'com.aiostreams.viren070',
    desc: 'ID of the addon',
  }),
  PORT: port({
    default: 3000,
    desc: 'Port to run the addon on',
  }),
  PTT_PORT: port({
    default: 3001,
    desc: 'Port to run the PTT server on (only used on Windows)',
  }),
  PTT_SOCKET: str({
    default: '/tmp/ptt.sock',
    desc: 'Socket to run the PTT server on',
  }),
  CUSTOM_HTML: str({
    default: undefined,
    desc: 'Custom HTML for the addon',
  }),
  SECRET_KEY: secretKey({
    desc: 'Secret key for the addon, used for encryption and must be 64 characters of hex',
    example: 'Generate using: openssl rand -hex 32',
  }),
  ADDON_PASSWORD: commaSeparated({
    default:
      typeof process.env.API_KEY === 'string' ? [process.env.API_KEY] : [],
    desc: 'Password required to create and modify addon configurations. Supports multiple passwords separated by commas.',
  }),
  DATABASE_URI: str({
    default: 'sqlite://./data/db.sqlite',
    desc: 'Database URI for the addon',
  }),
  REDIS_URI: str({
    default: undefined,
    desc: 'Redis URI for the addon',
  }),
  REDIS_TIMEOUT: num({
    default: 500,
    desc: 'Redis timeout for the addon',
  }),
  ADDON_PROXY: urlOrUrlList({
    default: undefined,
    desc: 'Proxy URL for the addon',
  }),
  ADDON_PROXY_CONFIG: str({
    default: undefined,
    desc: 'Proxy config for the addon in format of comma separated hostname:(boolean|number). If you have multiple proxies, use a number to specify the index of the proxy. (starts from 0)',
  }),
  REQUEST_URL_MAPPINGS: urlMappings({
    default: undefined,
    desc: 'Mapping of URLs to another, converts requests to the original URL to the mapped URL',
  }),
  ALIASED_CONFIGURATIONS: aliasedUUIDs({
    default: {},
    desc: 'Comma separated list of alias:uuid:encryptedPassword pairs. Can then access at /stremio/u/alias/manifest.json ',
  }),
  TRUSTED_UUIDS: str({
    default: undefined,
    desc: 'Comma separated list of trusted UUIDs. Trusted UUIDs can currently use regex filters if.',
  }),
  TMDB_ACCESS_TOKEN: str({
    default: undefined,
    desc: 'TMDB Read Access Token. Used for fetching metadata for the strict title matching option.',
  }),
  TMDB_API_KEY: str({
    default: undefined,
    desc: 'TMDB API Key. Used for fetching metadata for the strict title matching option.',
  }),
  TVDB_API_KEY: str({
    default: undefined,
    desc: 'TVDB API Key. Used for fetching metadata.',
  }),
  TRAKT_CLIENT_ID: str({
    default: undefined,
    desc: 'Trakt Client ID. Used for fetching Trakt aliases.',
  }),
  PROVIDE_STREAM_DATA: boolOrList<boolean | string[] | undefined>({
    default: undefined,
    desc: 'Provide stream data to the client in stream responses. Required for users to wrap this addon within another AIOStreams instance.',
  }),
  TRUSTED_IPS: commaSeparated({
    default: ['172.17.0.0/16', '127.0.0.1/32', '::1/128'],
    desc: 'Comma separated list of trusted IPs / IP ranges. Used when determining the requesting IP. Not required for user IP as all headers are always trusted for user IP.',
  }),
  ENABLE_SEARCH_API: bool({
    default: true,
    desc: 'Enable the search API. If true, the search API will be enabled.',
  }),
  ANIME_DB_LEVEL_OF_DETAIL: str({
    default: 'required',
    desc: 'Detail level for the anime database. none: no anime database, required: only load the required databases, full: load all data',
    choices: ['none', 'required', 'full'],
  }),
  ANIME_DB_FRIBB_MAPPINGS_REFRESH_INTERVAL: num({
    default: 24 * 60 * 60 * 1000, // 24 hours
    desc: 'Interval for refreshing the anime mappings in milliseconds',
  }),
  ANIME_DB_MANAMI_DB_REFRESH_INTERVAL: num({
    default: 7 * 24 * 60 * 60 * 1000, // 7 days
    desc: 'Interval for refreshing the Manami anime offline database in milliseconds',
  }),
  ANIME_DB_KITSU_IMDB_MAPPING_REFRESH_INTERVAL: num({
    default: 24 * 60 * 60 * 1000, // 24 hours
    desc: 'Interval for refreshing the Kitsu IMDB mapping in milliseconds',
  }),
  ANIME_DB_EXTENDED_ANITRAKT_MOVIES_REFRESH_INTERVAL: num({
    default: 24 * 60 * 60 * 1000, // 24 hours
    desc: 'Interval for refreshing the Extended Anitrakt Movies in milliseconds',
  }),
  ANIME_DB_EXTENDED_ANITRAKT_TV_REFRESH_INTERVAL: num({
    default: 24 * 60 * 60 * 1000, // 24 hours
    desc: 'Interval for refreshing the Extended Anitrakt TV in milliseconds',
  }),
  // logging settings
  LOG_SENSITIVE_INFO: bool({
    default: false,
    desc: 'Log sensitive information',
  }),
  LOG_LEVEL: str({
    default: 'info',
    desc: 'Log level for the addon',
    choices: ['info', 'debug', 'warn', 'error', 'verbose', 'silly', 'http'],
  }),
  LOG_FORMAT: str({
    default: 'text',
    desc: 'Log format for the addon',
    choices: ['text', 'json'],
  }),
  LOG_TIMEZONE: str({
    default: 'UTC',
    desc: 'Timezone for log timestamps (e.g., America/New_York, Europe/London)',
  }),
  LOG_CACHE_STATS_INTERVAL: num({
    default: 30,
    desc: 'Interval for logging cache stats in minutes (verbose level only)',
  }),

  STREMIO_ADDONS_CONFIG_ISSUER: url({
    default: 'https://stremio-addons.net',
    desc: 'Issuer for the Stremio addons config',
  }),
  STREMIO_ADDONS_CONFIG_SIGNATURE: str({
    default: undefined,
    desc: 'Signature for the Stremio addons config',
  }),

  PRUNE_INTERVAL: num({
    default: 86400, // 24 hours
    desc: 'Interval for pruning inactive users in seconds',
  }),
  PRUNE_MAX_DAYS: num({
    default: -1,
    desc: 'Maximum days of inactivity before pruning, set to -1 to disable',
  }),

  EXPOSE_USER_COUNT: bool({
    default: false,
    desc: 'Expose the number of users through the status endpoint',
  }),

  RECURSION_THRESHOLD_LIMIT: num({
    default: 60,
    desc: 'Maximum number of requests to the same URL',
  }),
  RECURSION_THRESHOLD_WINDOW: num({
    default: 10,
    desc: 'Time window for recursion threshold in seconds',
  }),

  DEFAULT_USER_AGENT: userAgent({
    default: `AIOStreams/${metadata?.version || 'unknown'}`,
    desc: 'Default user agent for the addon',
  }),

  HOSTNAME_USER_AGENT_OVERRIDES: str({
    default: '*.strem.fun:Stremio',
    desc: 'Comma separated list of hostname:useragent pairs. Takes priority over any other user agent settings.',
  }),

  DEFAULT_MAX_CACHE_SIZE: num({
    default: 100000,
    desc: 'Default max cache size for a cache instance',
  }),
  PROXY_IP_CACHE_TTL: num({
    default: 900,
    desc: 'Cache TTL for proxy IPs',
  }),
  MANIFEST_CACHE_TTL: num({
    default: 21600,
    desc: 'Cache TTL for manifest files',
  }),
  MANIFEST_CACHE_MAX_SIZE: num({
    default: undefined,
    desc: 'Max number of manifest items to cache',
  }),
  SUBTITLE_CACHE_TTL: num({
    default: 300,
    desc: 'Cache TTL for subtitle files',
  }),
  SUBTITLE_CACHE_MAX_SIZE: num({
    default: undefined,
    desc: 'Max number of subtitle items to cache',
  }),
  STREAM_CACHE_TTL: num({
    default: -1,
    desc: 'Cache TTL for stream files. If -1, no caching will be done.',
  }),
  STREAM_CACHE_MAX_SIZE: num({
    default: undefined,
    desc: 'Max number of stream items to cache',
  }),
  CATALOG_CACHE_TTL: num({
    default: 300,
    desc: 'Cache TTL for catalog files',
  }),
  CATALOG_CACHE_MAX_SIZE: num({
    default: 1000,
    desc: 'Max number of catalog items to cache',
  }),
  META_CACHE_TTL: num({
    default: 300,
  }),
  META_CACHE_MAX_SIZE: num({
    default: undefined,
    desc: 'Max number of metadata items to cache',
  }),
  ADDON_CATALOG_CACHE_TTL: num({
    default: 300,
    desc: 'Cache TTL for addon catalog files',
  }),
  ADDON_CATALOG_CACHE_MAX_SIZE: num({
    default: undefined,
    desc: 'Max number of addon catalog items to cache',
  }),
  RPDB_API_KEY_VALIDITY_CACHE_TTL: num({
    default: 604800, // 7 days
    desc: 'Cache TTL for RPDB API key validity',
  }),

  PRECACHE_NEXT_EPISODE_MIN_INTERVAL: num({
    default: 86400, // 24 hours
    desc: 'Minimum interval for precaching the next episode of the current episode in seconds. i.e. the minimum wait before attempting to precache the same next episode again.',
  }),

  // configuration settings

  MAX_ADDONS: num({
    default: 15,
    desc: 'Max number of addons',
  }),
  // TODO
  MAX_KEYWORD_FILTERS: num({
    default: 30,
    desc: 'Max number of keyword filters',
  }),
  MAX_STREAM_EXPRESSION_FILTERS: num({
    default: 30,
    desc: 'Max number of condition filters',
  }),
  MAX_GROUPS: num({
    default: 20,
    desc: 'Max number of groups',
  }),

  ALLOWED_REGEX_PATTERNS: json<string[]>({
    default: [],
    desc: 'Allowed regex patterns',
  }),
  ALLOWED_REGEX_PATTERNS_URLS: json<string[]>({
    default: undefined,
    desc: 'Comma separated list of allowed regex patterns URLs',
  }),
  ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL: num({
    default: 86400000,
    desc: 'Interval for refreshing regex patterns from URLs in milliseconds',
  }),
  ALLOWED_REGEX_PATTERNS_DESCRIPTION: str({
    default: undefined,
    desc: 'Description of the allowed regex patterns',
  }),

  MAX_TIMEOUT: num({
    default: 50000,
    desc: 'Max timeout for the addon',
  }),
  MIN_TIMEOUT: num({
    default: 1000,
    desc: 'Min timeout for the addon',
  }),

  DEFAULT_TIMEOUT: num({
    default: 10000,
    desc: 'Default timeout for the addon',
  }),
  CATALOG_TIMEOUT: num({
    default: 30000,
    desc: 'Timeout for catalog requests',
  }),
  META_TIMEOUT: num({
    default: 30000,
    desc: 'Timeout for meta requests',
  }),
  MANIFEST_TIMEOUT: num({
    default: 3000,
    desc: 'Timeout for manifest requests',
  }),
  MANIFEST_INCREASED_TIMEOUT: num({
    default: 10000,
    desc: 'Increased timeout for manifest requests',
  }),

  BACKGROUND_RESOURCE_REQUEST_TIMEOUT: num({
    default: undefined,
    desc: 'Timeout for background resource requests, uses your maximum timeout if not set',
  }),

  FORCE_PUBLIC_PROXY_HOST: host({
    default: undefined,
    desc: 'Force public proxy host',
  }),
  FORCE_PUBLIC_PROXY_PORT: forcedPort({
    default: undefined,
    desc: 'Force public proxy port',
  }),
  FORCE_PUBLIC_PROXY_PROTOCOL: str({
    default: undefined,
    desc: 'Force public proxy protocol',
    choices: ['http', 'https'],
  }),

  FORCE_PROXY_ENABLED: bool({
    default: undefined,
    desc: 'Force proxy enabled',
  }),
  FORCE_PROXY_ID: str({
    default: undefined,
    desc: 'Force proxy id',
    choices: constants.PROXY_SERVICES,
  }),
  FORCE_PROXY_URL: url({
    default: undefined,
    desc: 'Force proxy url',
  }),
  FORCE_PROXY_PUBLIC_URL: url({
    default: undefined,
    desc: 'Force proxy public url',
  }),
  FORCE_PROXY_CREDENTIALS: str({
    default: undefined,
    desc: 'Force proxy credentials',
  }),
  FORCE_PROXY_PUBLIC_IP: str({
    default: undefined,
    desc: 'Force proxy public ip',
  }),
  FORCE_PROXY_DISABLE_PROXIED_ADDONS: bool({
    default: false,
    desc: 'Force proxy disable proxied addons',
  }),
  FORCE_PROXY_PROXIED_SERVICES: json({
    default: undefined,
    desc: 'Force proxy proxied services',
  }),

  DEFAULT_PROXY_ENABLED: bool({
    default: undefined,
    desc: 'Default proxy enabled',
  }),
  DEFAULT_PROXY_ID: str({
    default: undefined,
    desc: 'Default proxy id',
  }),
  DEFAULT_PROXY_URL: url({
    default: undefined,
    desc: 'Default proxy url',
  }),
  DEFAULT_PROXY_PUBLIC_URL: url({
    default: undefined,
    desc: 'Default proxy public url',
  }),
  DEFAULT_PROXY_CREDENTIALS: str({
    default: undefined,
    desc: 'Default proxy credentials',
  }),
  DEFAULT_PROXY_PUBLIC_IP: str({
    default: undefined,
    desc: 'Default proxy public ip',
  }),
  DEFAULT_PROXY_PROXIED_SERVICES: json({
    default: undefined,
    desc: 'Default proxy proxied services',
  }),

  ENCRYPT_MEDIAFLOW_URLS: bool({
    default: true,
    desc: 'Encrypt MediaFlow URLs',
  }),

  ENCRYPT_STREMTHRU_URLS: bool({
    default: true,
    desc: 'Encrypt StremThru URLs',
  }),

  // service settings
  DEFAULT_REALDEBRID_API_KEY: str({
    default: undefined,
    desc: 'Default RealDebrid API key',
  }),
  DEFAULT_ALLDEBRID_API_KEY: str({
    default: undefined,
    desc: 'Default AllDebrid API key',
  }),
  DEFAULT_PREMIUMIZE_API_KEY: str({
    default: undefined,
    desc: 'Default Premiumize API key',
  }),
  DEFAULT_DEBRIDLINK_API_KEY: str({
    default: undefined,
    desc: 'Default DebridLink API key',
  }),
  DEFAULT_TORBOX_API_KEY: str({
    default: undefined,
    desc: 'Default Torbox API key',
  }),
  DEFAULT_OFFCLOUD_API_KEY: str({
    default: undefined,
    desc: 'Default OffCloud API key',
  }),
  DEFAULT_OFFCLOUD_EMAIL: str({
    default: undefined,
    desc: 'Default OffCloud email',
  }),
  DEFAULT_OFFCLOUD_PASSWORD: str({
    default: undefined,
    desc: 'Default OffCloud password',
  }),
  DEFAULT_PUTIO_CLIENT_ID: str({
    default: undefined,
    desc: 'Default Putio client id',
  }),
  DEFAULT_PUTIO_CLIENT_SECRET: str({
    default: undefined,
    desc: 'Default Putio client secret',
  }),
  DEFAULT_EASYNEWS_USERNAME: str({
    default: undefined,
    desc: 'Default EasyNews username',
  }),
  DEFAULT_EASYNEWS_PASSWORD: str({
    default: undefined,
    desc: 'Default EasyNews password',
  }),
  DEFAULT_EASYDEBRID_API_KEY: str({
    default: undefined,
    desc: 'Default EasyDebrid API key',
  }),
  DEFAULT_DEBRIDER_API_KEY: str({
    default: undefined,
    desc: 'Default Debrider API key',
  }),
  DEFAULT_PIKPAK_EMAIL: str({
    default: undefined,
    desc: 'Default PikPak email',
  }),
  DEFAULT_PIKPAK_PASSWORD: str({
    default: undefined,
    desc: 'Default PikPak password',
  }),
  DEFAULT_SEEDR_ENCODED_TOKEN: str({
    default: undefined,
    desc: 'Default Seedr encoded token',
  }),

  // forced services
  FORCED_REALDEBRID_API_KEY: str({
    default: undefined,
    desc: 'Forced RealDebrid API key',
  }),
  FORCED_ALLDEBRID_API_KEY: str({
    default: undefined,
    desc: 'Forced AllDebrid API key',
  }),
  FORCED_PREMIUMIZE_API_KEY: str({
    default: undefined,
    desc: 'Forced Premiumize API key',
  }),
  FORCED_DEBRIDLINK_API_KEY: str({
    default: undefined,
    desc: 'Forced DebridLink API key',
  }),
  FORCED_TORBOX_API_KEY: str({
    default: undefined,
    desc: 'Forced Torbox API key',
  }),
  FORCED_OFFCLOUD_API_KEY: str({
    default: undefined,
    desc: 'Forced OffCloud API key',
  }),
  FORCED_OFFCLOUD_EMAIL: str({
    default: undefined,
    desc: 'Forced OffCloud email',
  }),
  FORCED_OFFCLOUD_PASSWORD: str({
    default: undefined,
    desc: 'Forced OffCloud password',
  }),
  FORCED_PUTIO_CLIENT_ID: str({
    default: undefined,
    desc: 'Forced Putio client id',
  }),
  FORCED_PUTIO_CLIENT_SECRET: str({
    default: undefined,
    desc: 'Forced Putio client secret',
  }),
  FORCED_EASYNEWS_USERNAME: str({
    default: undefined,
    desc: 'Forced EasyNews username',
  }),
  FORCED_EASYNEWS_PASSWORD: str({
    default: undefined,
    desc: 'Forced EasyNews password',
  }),
  FORCED_EASYDEBRID_API_KEY: str({
    default: undefined,
    desc: 'Forced EasyDebrid API key',
  }),
  FORCED_DEBRIDER_API_KEY: str({
    default: undefined,
    desc: 'Forced Debrider API key',
  }),
  FORCED_PIKPAK_EMAIL: str({
    default: undefined,
    desc: 'Forced PikPak email',
  }),
  FORCED_PIKPAK_PASSWORD: str({
    default: undefined,
    desc: 'Forced PikPak password',
  }),
  FORCED_SEEDR_ENCODED_TOKEN: str({
    default: undefined,
    desc: 'Forced Seedr encoded token',
  }),

  STREAM_URL_MAPPINGS: urlMappings({
    default: undefined,
    desc: 'Mapping of URLs to another, converts stream URLs from the original URL to the mapped URL',
  }),

  AIOSTREAMS_USER_AGENT: userAgent({
    default: `AIOStreams/${metadata?.version || 'unknown'}`,
    desc: 'AIOStreams user agent',
  }),

  COMET_URL: urlOrUrlList({
    default: ['https://comet.elfhosted.com'],
    desc: 'Comet URL',
  }),
  FORCE_COMET_HOSTNAME: host({
    default: undefined,
    desc: 'Force Comet hostname',
  }),
  FORCE_COMET_PORT: forcedPort({
    default: undefined,
    desc: 'Force Comet port',
  }),
  FORCE_COMET_PROTOCOL: str({
    default: undefined,
    desc: 'Force Comet protocol',
    choices: ['http', 'https'],
  }),
  DEFAULT_COMET_TIMEOUT: num({
    default: undefined,
    desc: 'Default Comet timeout',
  }),
  DEFAULT_COMET_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Comet user agent',
  }),

  // MediaFusion settings
  MEDIAFUSION_URL: urlOrUrlList({
    default: ['https://mediafusion.elfhosted.com'],
    desc: 'MediaFusion URL',
  }),
  MEDIAFUSION_API_PASSWORD: str({
    default: '',
    desc: 'MediaFusion API password',
  }),
  MEDIAFUSION_DEFAULT_USE_CACHED_RESULTS_ONLY: bool({
    default: true,
    desc: 'Default MediaFusion use cached results only',
  }),
  MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY: bool({
    default: undefined,
    desc: 'Force MediaFusion use cached results only',
  }),
  DEFAULT_MEDIAFUSION_TIMEOUT: num({
    default: undefined,
    desc: 'Default MediaFusion timeout',
  }),
  DEFAULT_MEDIAFUSION_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default MediaFusion user agent',
  }),

  // Jackettio settings
  JACKETTIO_URL: urlOrUrlList({
    default: ['https://jackettio.elfhosted.com'],
    desc: 'Jackettio URL',
  }),
  DEFAULT_JACKETTIO_INDEXERS: json({
    default: ['eztv', 'thepiratebay', 'therarbg', 'yts'],
    desc: 'Default Jackettio indexers',
  }),
  DEFAULT_JACKETTIO_STREMTHRU_URL: url({
    default: 'https://stremthru.13377001.xyz',
    desc: 'Default Jackettio StremThru URL',
  }),
  DEFAULT_JACKETTIO_TIMEOUT: num({
    default: undefined,
    desc: 'Default Jackettio timeout',
  }),
  FORCE_JACKETTIO_HOSTNAME: host({
    default: undefined,
    desc: 'Force Jackettio hostname',
  }),
  FORCE_JACKETTIO_PORT: forcedPort({
    default: undefined,
    desc: 'Force Jackettio port',
  }),
  FORCE_JACKETTIO_PROTOCOL: str({
    default: undefined,
    desc: 'Force Jackettio protocol',
    choices: ['http', 'https'],
  }),
  DEFAULT_JACKETTIO_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Jackettio user agent',
  }),

  // Torrentio settings
  TORRENTIO_URL: url({
    default: 'https://torrentio.strem.fun',
    desc: 'Torrentio URL',
  }),
  DEFAULT_TORRENTIO_TIMEOUT: num({
    default: undefined,
    desc: 'Default Torrentio timeout',
  }),
  DEFAULT_TORRENTIO_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Torrentio user agent',
  }),

  // Orion settings
  ORION_STREMIO_ADDON_URL: url({
    default: 'https://5a0d1888fa64-orion.baby-beamup.club',
    desc: 'Orion Stremio addon URL',
  }),
  DEFAULT_ORION_TIMEOUT: num({
    default: undefined,
    desc: 'Default Orion timeout',
  }),
  DEFAULT_ORION_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Orion user agent',
  }),

  // Peerflix settings
  PEERFLIX_URL: url({
    default: 'https://addon.peerflix.mov',
    desc: 'Peerflix URL',
  }),
  DEFAULT_PEERFLIX_TIMEOUT: num({
    default: undefined,
    desc: 'Default Peerflix timeout',
  }),
  DEFAULT_PEERFLIX_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Peerflix user agent',
  }),

  // Torbox settings
  TORBOX_STREMIO_URL: url({
    default: 'https://stremio.torbox.app',
    desc: 'Torbox Stremio URL',
  }),
  DEFAULT_TORBOX_TIMEOUT: num({
    default: undefined,
    desc: 'Default Torbox timeout',
  }),
  DEFAULT_TORBOX_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Torbox user agent',
  }),

  // Easynews settings
  EASYNEWS_URL: url({
    default: 'https://ea627ddf0ee7-easynews.baby-beamup.club',
    desc: 'Easynews URL',
  }),
  DEFAULT_EASYNEWS_TIMEOUT: num({
    default: undefined,
    desc: 'Default Easynews timeout',
  }),
  DEFAULT_EASYNEWS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Easynews user agent',
  }),

  // Easynews+ settings
  EASYNEWS_PLUS_URL: url({
    default: 'https://b89262c192b0-stremio-easynews-addon.baby-beamup.club',
    desc: 'Easynews+ URL',
  }),
  DEFAULT_EASYNEWS_PLUS_TIMEOUT: num({
    default: undefined,
    desc: 'Default Easynews+ timeout',
  }),
  DEFAULT_EASYNEWS_PLUS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Easynews+ user agent',
  }),

  // Easynews++ settings
  EASYNEWS_PLUS_PLUS_URL: url({
    default: 'https://easynews-cloudflare-worker.jqrw92fchz.workers.dev',
    desc: 'Easynews++ URL',
  }),
  EASYNEWS_PLUS_PLUS_PUBLIC_URL: url({
    default: undefined,
    desc: 'Easynews++ public URL',
  }),
  DEFAULT_EASYNEWS_PLUS_PLUS_TIMEOUT: num({
    default: undefined,
    desc: 'Default Easynews++ timeout',
  }),
  DEFAULT_EASYNEWS_PLUS_PLUS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Easynews++ user agent',
  }),

  // Debridio Settings
  DEBRIDIO_URL: url({
    default: 'https://addon.debridio.com',
    desc: 'Debridio URL',
  }),
  DEFAULT_DEBRIDIO_TIMEOUT: num({
    default: undefined,
    desc: 'Default Debridio timeout',
  }),
  DEFAULT_DEBRIDIO_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Debridio user agent',
  }),

  DEBRIDIO_TVDB_URL: url({
    default: 'https://tvdb-addon.debridio.com',
    desc: 'Debridio TVDB URL',
  }),
  DEFAULT_DEBRIDIO_TVDB_TIMEOUT: num({
    default: undefined,
    desc: 'Default Debridio TVDB timeout',
  }),
  DEFAULT_DEBRIDIO_TVDB_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Debridio TVDB user agent',
  }),

  DEBRIDIO_TMDB_URL: url({
    default: 'https://tmdb-addon.debridio.com',
    desc: 'Debridio TMDB URL',
  }),
  DEFAULT_DEBRIDIO_TMDB_TIMEOUT: num({
    default: undefined,
    desc: 'Default Debridio TMDB timeout',
  }),
  DEFAULT_DEBRIDIO_TMDB_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Debridio TMDB user agent',
  }),

  DEBRIDIO_TV_URL: url({
    default: 'https://tv-addon.debridio.com',
    desc: 'Debridio TV URL',
  }),
  DEFAULT_DEBRIDIO_TV_TIMEOUT: num({
    default: undefined,
    desc: 'Default Debridio TV timeout',
  }),
  DEFAULT_DEBRIDIO_TV_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Debridio TV user agent',
  }),

  DEBRIDIO_WATCHTOWER_URL: url({
    default: 'https://wt-addon.debridio.com',
    desc: 'Debridio Watchtower URL',
  }),
  DEFAULT_DEBRIDIO_WATCHTOWER_TIMEOUT: num({
    default: undefined,
    desc: 'Default Debridio Watchtower timeout',
  }),
  DEFAULT_DEBRIDIO_WATCHTOWER_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Debridio Watchtower user agent',
  }),

  // StremThru Store settings
  STREMTHRU_STORE_URL: urlOrUrlList({
    default: ['https://stremthru.13377001.xyz/'],
    desc: 'StremThru Store URL',
  }),
  DEFAULT_STREMTHRU_STORE_TIMEOUT: num({
    default: undefined,
    desc: 'Default StremThru Store timeout',
  }),
  DEFAULT_STREMTHRU_STORE_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default StremThru Store user agent',
  }),
  FORCE_STREMTHRU_STORE_HOSTNAME: host({
    default: undefined,
    desc: 'Force StremThru Store hostname',
  }),
  FORCE_STREMTHRU_STORE_PORT: forcedPort({
    default: undefined,
    desc: 'Force StremThru Store port',
  }),
  FORCE_STREMTHRU_STORE_PROTOCOL: str({
    default: undefined,
    desc: 'Force StremThru Store protocol',
    choices: ['http', 'https'],
  }),

  // StremThru Torz settings
  STREMTHRU_TORZ_URL: urlOrUrlList({
    default: ['https://stremthru.13377001.xyz/stremio/torz'],
    desc: 'StremThru Torz URL',
  }),
  DEFAULT_STREMTHRU_TORZ_TIMEOUT: num({
    default: undefined,
    desc: 'Default StremThru Torz timeout',
  }),
  DEFAULT_STREMTHRU_TORZ_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default StremThru Torz user agent',
  }),
  FORCE_STREMTHRU_TORZ_HOSTNAME: host({
    default: undefined,
    desc: 'Force StremThru Torz hostname',
  }),
  FORCE_STREMTHRU_TORZ_PORT: forcedPort({
    default: undefined,
    desc: 'Force StremThru Torz port',
  }),
  FORCE_STREMTHRU_TORZ_PROTOCOL: str({
    default: undefined,
    desc: 'Force StremThru Torz protocol',
    choices: ['http', 'https'],
  }),

  DEFAULT_STREAMFUSION_URL: url({
    default: 'https://stream-fusion.stremiofr.com',
    desc: 'Default StreamFusion URL',
  }),
  DEFAULT_STREAMFUSION_TIMEOUT: num({
    default: undefined,
    desc: 'Default StreamFusion timeout',
  }),
  DEFAULT_STREAMFUSION_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default StreamFusion user agent',
  }),
  DEFAULT_STREAMFUSION_STREMTHRU_URL: url({
    default: 'https://stremthru.13377001.xyz',
    desc: 'Default StreamFusion StremThru URL',
  }),

  // DMM Cast settings
  DEFAULT_DMM_CAST_TIMEOUT: num({
    default: undefined,
    desc: 'Default DMM Cast timeout',
  }),
  DEFAULT_DMM_CAST_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default DMM Cast user agent',
  }),

  OPENSUBTITLES_URL: url({
    default: 'https://opensubtitles-v3.strem.io',
    desc: 'The base URL of the OpenSubtitles stremio addon',
  }),
  DEFAULT_OPENSUBTITLES_TIMEOUT: num({
    default: undefined,
    desc: 'Default OpenSubtitles timeout',
  }),
  DEFAULT_OPENSUBTITLES_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default OpenSubtitles user agent',
  }),

  MARVEL_UNIVERSE_URL: url({
    default: 'https://addon-marvel.onrender.com',
    desc: 'Default Marvel catalog URL',
  }),
  DEFAULT_MARVEL_CATALOG_TIMEOUT: num({
    default: undefined,
    desc: 'Default Marvel timeout',
  }),
  DEFAULT_MARVEL_CATALOG_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Marvel user agent',
  }),

  DC_UNIVERSE_URL: url({
    default: 'https://addon-dc-cq85.onrender.com',
    desc: 'Default DC Universe catalog URL',
  }),
  DEFAULT_DC_UNIVERSE_TIMEOUT: num({
    default: undefined,
    desc: 'Default DC Universe timeout',
  }),
  DEFAULT_DC_UNIVERSE_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default DC Universe user agent',
  }),

  DEFAULT_STAR_WARS_UNIVERSE_URL: url({
    default: 'https://addon-star-wars-u9e3.onrender.com',
    desc: 'Default Star Wars Universe catalog URL',
  }),
  DEFAULT_STAR_WARS_UNIVERSE_TIMEOUT: num({
    default: undefined,
    desc: 'Default Star Wars Universe timeout',
  }),
  DEFAULT_STAR_WARS_UNIVERSE_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Star Wars Universe user agent',
  }),

  ANIME_KITSU_URL: url({
    default: 'https://anime-kitsu.strem.fun',
    desc: 'Anime Kitsu URL',
  }),
  DEFAULT_ANIME_KITSU_TIMEOUT: num({
    default: undefined,
    desc: 'Default Anime Kitsu timeout',
  }),
  DEFAULT_ANIME_KITSU_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Anime Kitsu user agent',
  }),

  NUVIOSTREAMS_URL: url({
    default: 'https://nuviostreams.hayd.uk',
    desc: 'NuvioStreams URL',
  }),
  DEFAULT_NUVIOSTREAMS_TIMEOUT: num({
    default: undefined,
    desc: 'Default NuvioStreams timeout',
  }),
  DEFAULT_NUVIOSTREAMS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default NuvioStreams user agent',
  }),

  TORRENT_CATALOGS_URL: url({
    default: 'https://torrent-catalogs.strem.fun',
    desc: 'Default Torrent Catalogs URL',
  }),
  DEFAULT_TORRENT_CATALOGS_TIMEOUT: num({
    default: undefined,
    desc: 'Default Torrent Catalogs timeout',
  }),
  DEFAULT_TORRENT_CATALOGS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Torrent Catalogs user agent',
  }),

  TMDB_COLLECTIONS_URL: url({
    default: 'https://61ab9c85a149-tmdb-collections.baby-beamup.club',
    desc: 'Default TMDB Collections URL',
  }),
  DEFAULT_TMDB_COLLECTIONS_TIMEOUT: num({
    default: undefined,
    desc: 'Default TMDB Collections timeout',
  }),
  DEFAULT_TMDB_COLLECTIONS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default TMDB Collections user agent',
  }),

  RPDB_CATALOGS_URL: url({
    default: 'https://1fe84bc728af-rpdb.baby-beamup.club',
    desc: 'Default RPDB Catalogs URL',
  }),
  DEFAULT_RPDB_CATALOGS_TIMEOUT: num({
    default: undefined,
    desc: 'Default RPDB Catalogs timeout',
  }),
  DEFAULT_RPDB_CATALOGS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default RPDB Catalogs user agent',
  }),
  STREAMING_CATALOGS_URL: url({
    default:
      'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club',
    desc: 'Default Streaming Catalogs URL',
  }),
  DEFAULT_STREAMING_CATALOGS_TIMEOUT: num({
    default: undefined,
    desc: 'Default Streaming Catalogs timeout',
  }),
  DEFAULT_STREAMING_CATALOGS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Streaming Catalogs user agent',
  }),
  ANIME_CATALOGS_URL: url({
    default: 'https://1fe84bc728af-stremio-anime-catalogs.baby-beamup.club',
    desc: 'Default Anime Catalogs URL',
  }),
  DEFAULT_ANIME_CATALOGS_TIMEOUT: num({
    default: undefined,
    desc: 'Default Anime Catalogs timeout',
  }),
  DEFAULT_ANIME_CATALOGS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Anime Catalogs user agent',
  }),

  DOCTOR_WHO_UNIVERSE_URL: url({
    default: 'https://new-who.onrender.com',
    desc: 'Default Doctor Who Universe URL',
  }),
  DEFAULT_DOCTOR_WHO_UNIVERSE_TIMEOUT: num({
    default: undefined,
    desc: 'Default Doctor Who Universe timeout',
  }),
  DEFAULT_DOCTOR_WHO_UNIVERSE_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Doctor Who Universe user agent',
  }),

  WEBSTREAMR_URL: url({
    default: 'https://webstreamr.hayd.uk',
    desc: 'WebStreamr URL',
  }),
  DEFAULT_WEBSTREAMR_TIMEOUT: num({
    default: undefined,
    desc: 'Default WebStreamr timeout',
  }),
  DEFAULT_WEBSTREAMR_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default WebStreamr user agent',
  }),

  TMDB_ADDON_URL: url({
    default: 'https://tmdb.elfhosted.com',
    desc: 'TMDB Addon URL',
  }),
  DEFAULT_TMDB_ADDON_TIMEOUT: num({
    default: undefined,
    desc: 'Default TMDB Addon timeout',
  }),
  DEFAULT_TMDB_ADDON_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default TMDB Addon user agent',
  }),

  TORRENTS_DB_URL: url({
    default: 'https://torrentsdb.com',
    desc: 'Torrents DB URL',
  }),
  DEFAULT_TORRENTS_DB_TIMEOUT: num({
    default: undefined,
    desc: 'Default Torrents DB timeout',
  }),
  DEFAULT_TORRENTS_DB_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Torrents DB user agent',
  }),

  USA_TV_URL: url({
    default: 'https://848b3516657c-usatv.baby-beamup.club',
    desc: 'USA TV URL',
  }),
  DEFAULT_USA_TV_TIMEOUT: num({
    default: undefined,
    desc: 'Default USA TV timeout',
  }),
  DEFAULT_USA_TV_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default USA TV user agent',
  }),

  ARGENTINA_TV_URL: url({
    default: 'https://848b3516657c-argentinatv.baby-beamup.club',
    desc: 'Argentina TV URL',
  }),
  DEFAULT_ARGENTINA_TV_TIMEOUT: num({
    default: undefined,
    desc: 'Default Argentina TV timeout',
  }),
  DEFAULT_ARGENTINA_TV_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Argentina TV user agent',
  }),

  SUBDL_URL: url({
    default: 'https://subdl.strem.top',
    desc: 'SubDL URL',
  }),
  DEFAULT_SUBDL_TIMEOUT: num({
    default: undefined,
    desc: 'Default SubDL timeout',
  }),
  DEFAULT_SUBDL_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default SubDL user agent',
  }),

  SUBSOURCE_URL: url({
    default: 'https://subsource.strem.top',
    desc: 'SubSource URL',
  }),
  DEFAULT_SUBSOURCE_TIMEOUT: num({
    default: undefined,
    desc: 'Default SubSource timeout',
  }),
  DEFAULT_SUBSOURCE_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default SubSource user agent',
  }),

  OPENSUBTITLES_V3_PLUS_URL: url({
    default: 'https://opensubtitles.stremio.homes',
    desc: 'OpenSubtitles V3 Plus URL',
  }),
  DEFAULT_OPENSUBTITLES_V3_PLUS_TIMEOUT: num({
    default: undefined,
    desc: 'Default OpenSubtitles V3 Plus timeout',
  }),
  DEFAULT_OPENSUBTITLES_V3_PLUS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default OpenSubtitles V3 Plus user agent',
  }),

  AI_SEARCH_URL: url({
    default: 'https://stremio.itcon.au',
    desc: 'AI Search URL',
  }),
  DEFAULT_AI_SEARCH_TIMEOUT: num({
    default: undefined,
    desc: 'Default AI Search timeout',
  }),
  DEFAULT_AI_SEARCH_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default AI Search user agent',
  }),

  FKSTREAM_URL: url({
    default: 'https://streamio.fankai.fr',
    desc: 'FKStream URL',
  }),
  DEFAULT_FKSTREAM_TIMEOUT: num({
    default: undefined,
    desc: 'Default FKStream timeout',
  }),
  DEFAULT_FKSTREAM_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default FKStream user agent',
  }),

  AIOSUBTITLE_URL: url({
    default: 'https://3b4bbf5252c4-aio-streaming.baby-beamup.club',
    desc: 'AIOSubtitle URL',
  }),
  DEFAULT_AIOSUBTITLE_TIMEOUT: num({
    default: undefined,
    desc: 'Default AIOSubtitle timeout',
  }),
  DEFAULT_AIOSUBTITLE_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default AIOSubtitle user agent',
  }),

  SUBHERO_URL: url({
    default: 'https://subhero.onrender.com',
    desc: 'SubHero URL',
  }),
  DEFAULT_SUBHERO_TIMEOUT: num({
    default: undefined,
    desc: 'Default SubHero timeout',
  }),
  DEFAULT_SUBHERO_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default SubHero user agent',
  }),

  STREAMASIA_URL: url({
    default: 'https://stremio-dramacool-addon.xyz',
    desc: 'StreamAsia URL',
  }),
  DEFAULT_STREAMASIA_TIMEOUT: num({
    default: undefined,
    desc: 'Default StreamAsia timeout',
  }),
  DEFAULT_STREAMASIA_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default StreamAsia user agent',
  }),

  MORE_LIKE_THIS_URL: url({
    default: 'https://bbab4a35b833-more-like-this.baby-beamup.club',
    desc: 'More Like This URL',
  }),
  DEFAULT_MORE_LIKE_THIS_TIMEOUT: num({
    default: undefined,
    desc: 'Default More Like This timeout',
  }),
  DEFAULT_MORE_LIKE_THIS_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default More Like This user agent',
  }),

  CONTENT_DEEP_DIVE_URL: url({
    default:
      'https://stremio-content-deepdive-addon-dc8f7b513289.herokuapp.com',
    desc: 'Content Deep Dive URL',
  }),
  DEFAULT_CONTENT_DEEP_DIVE_TIMEOUT: num({
    default: undefined,
    desc: 'Default Content Deep Dive timeout',
  }),
  DEFAULT_CONTENT_DEEP_DIVE_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default Content Deep Dive user agent',
  }),

  AI_COMPANION_URL: url({
    default: 'https://ai-companion.saladprecedestretch123.uk',
    desc: 'AI Companion URL',
  }),
  DEFAULT_AI_COMPANION_TIMEOUT: num({
    default: undefined,
    desc: 'Default AI Companion timeout',
  }),
  DEFAULT_AI_COMPANION_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default AI Companion user agent',
  }),

  ASTREAM_URL: url({
    default: 'https://astream.stremiofr.com',
    desc: 'AStream URL',
  }),
  DEFAULT_ASTREAM_TIMEOUT: num({
    default: undefined,
    desc: 'Default AStream timeout',
  }),
  DEFAULT_ASTREAM_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Default AStream user agent',
  }),

  BUILTIN_STREMTHRU_URL: url({
    default: 'https://stremthru.13377001.xyz',
    desc: 'Builtin StremThru URL',
  }),
  BUILTIN_DEBRID_INSTANT_AVAILABILITY_CACHE_TTL: num({
    default: 60 * 30, // 30 minutes
    desc: 'Builtin Debrid instant availability cache TTL',
  }),
  BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL: num({
    default: 60 * 60, // 1 hour
    desc: 'Builtin Debrid playback link cache TTL',
  }),

  BUILTIN_GET_TORRENT_TIMEOUT: num({
    default: 5000,
    desc: 'Builtin Get Torrent timeout',
  }),
  BUILTIN_GET_TORRENT_CONCURRENCY: num({
    default: 100,
    desc: 'Builtin Get Torrent concurrency limit',
  }),
  BUILTIN_TORRENT_METADATA_CACHE_TTL: num({
    default: 7 * 24 * 60 * 60, // 7 days
    desc: 'Builtin Torrent metadata cache TTL',
  }),

  BUILTIN_GDRIVE_CLIENT_ID: str({
    default: undefined,
    desc: 'Builtin GDrive client ID',
  }),
  BUILTIN_GDRIVE_CLIENT_SECRET: str({
    default: undefined,
    desc: 'Builtin GDrive client secret',
  }),
  BUILTIN_GDRIVE_TIMEOUT: num({
    default: undefined,
    desc: 'Builtin GDrive timeout',
  }),
  BUILTIN_GDRIVE_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Builtin GDrive user agent',
  }),
  BUILTIN_GDRIVE_PAGE_SIZE_LIMIT: num({
    default: 1000,
    desc: 'Builtin GDrive page size limit',
  }),

  BUILTIN_TORBOX_SEARCH_TIMEOUT: num({
    default: undefined,
    desc: 'Builtin TorBox Search timeout',
  }),
  BUILTIN_TORBOX_SEARCH_USER_AGENT: userAgent({
    default: undefined,
    desc: 'Builtin TorBox Search user agent',
  }),
  BUILTIN_TORBOX_SEARCH_SEARCH_API_TIMEOUT: num({
    default: 30000, // 30 seconds
    desc: 'Builtin TorBox Search search API timeout',
  }),
  BUILTIN_TORBOX_SEARCH_SEARCH_API_CACHE_TTL: num({
    default: 7 * 24 * 60 * 60, // 7 days
    desc: 'Builtin TorBox Search search API cache TTL',
  }),
  BUILTIN_TORBOX_SEARCH_METADATA_CACHE_TTL: num({
    default: 14 * 24 * 60 * 60, // 14 days
    desc: 'Builtin TorBox Search metadata cache TTL',
  }),
  BUILTIN_TORBOX_SEARCH_CACHE_PER_USER_SEARCH_ENGINE: bool({
    default: false,
    desc: 'Whether to cache results separately for every user that is using their own search engines.',
  }),

  BUILTIN_NAB_SEARCH_TIMEOUT: num({
    default: 30000, // 30 seconds
    desc: 'Builtin Torznab/Newznab Search timeout',
  }),
  BUILTIN_NAB_SEARCH_CACHE_TTL: num({
    default: 7 * 24 * 60 * 60, // 7 days
    desc: 'Builtin Torznab/Newznab Search cache TTL',
  }),
  BUILTIN_NAB_CAPABILITIES_CACHE_TTL: num({
    default: 14 * 24 * 60 * 60, // 14 days
    desc: 'Builtin Torznab/Newznab Capabilities cache TTL',
  }),

  BUILTIN_ZILEAN_URL: url({
    default: 'https://zilean.elfhosted.com',
    desc: 'Builtin Zilean URL',
  }),
  BUILTIN_ZILEAN_TIMEOUT: num({
    default: undefined,
    desc: 'Builtin Zilean timeout',
  }),

  BUILTIN_ANIMETOSHO_URL: url({
    default: 'https://feed.animetosho.org',
    desc: 'Builtin AnimeTosho URL',
  }),
  BUILTIN_ANIMETOSHO_TIMEOUT: num({
    default: undefined,
    desc: 'Builtin AnimeTosho timeout',
  }),

  BUILTIN_JACKETT_URL: url({
    default: undefined,
    desc: 'Builtin Jackett URL',
  }),
  BUILTIN_JACKETT_API_KEY: str({
    default: undefined,
    desc: 'Builtin Jackett API Key',
  }),
  BUILTIN_JACKETT_TIMEOUT: num({
    default: undefined,
    desc: 'Builtin Jackett timeout',
  }),

  BUILTIN_NZBHYDRA_URL: url({
    default: undefined,
    desc: 'Builtin NZBHydra URL',
  }),
  BUILTIN_NZBHYDRA_API_KEY: str({
    default: undefined,
    desc: 'Builtin NZBHydra API Key',
  }),
  BUILTIN_NZBHYDRA_TIMEOUT: num({
    default: undefined,
    desc: 'Builtin NZBHydra timeout',
  }),

  BUILTIN_PROWLARR_URL: url({
    default: undefined,
    desc: 'Builtin Prowlarr URL',
  }),
  BUILTIN_PROWLARR_API_KEY: str({
    default: undefined,
    desc: 'Builtin Prowlarr API Key',
  }),
  BUILTIN_PROWLARR_INDEXERS: commaSeparated({
    default: undefined,
    desc: 'Comma separated list of prowlarr indexers to use.',
  }),
  BUILTIN_PROWLARR_SEARCH_TIMEOUT: num({
    default: 30000, // 30 seconds
    desc: 'Builtin Prowlarr Search timeout',
  }),
  BUILTIN_PROWLARR_SEARCH_CACHE_TTL: num({
    default: 7 * 24 * 60 * 60, // 7 days
    desc: 'Builtin Prowlarr Search cache TTL',
  }),
  BUILTIN_PROWLARR_INDEXERS_CACHE_TTL: num({
    default: 14 * 24 * 60 * 60, // 14 days
    desc: 'Builtin Prowlarr Indexers cache TTL',
  }),

  // Rate limiting settings
  DISABLE_RATE_LIMITS: bool({
    default: false,
    desc: 'Disable rate limiting',
  }),

  STATIC_RATE_LIMIT_WINDOW: num({
    default: 5, // 1 minute
    desc: 'Time window for static file serving rate limiting in seconds',
  }),
  STATIC_RATE_LIMIT_MAX_REQUESTS: num({
    default: 75, // allow 100 requests per IP per minute
    desc: 'Maximum number of requests allowed per IP within the time window',
  }),
  USER_API_RATE_LIMIT_WINDOW: num({
    default: 5, // 1 minute
    desc: 'Time window for user API rate limiting in seconds',
  }),
  USER_API_RATE_LIMIT_MAX_REQUESTS: num({
    default: 5, // allow 100 requests per IP per minute
  }),
  STREAM_API_RATE_LIMIT_WINDOW: num({
    default: 10, // 1 minute
    desc: 'Time window for stream API rate limiting in seconds',
  }),
  STREAM_API_RATE_LIMIT_MAX_REQUESTS: num({
    default: 5, // allow 100 requests per IP per minute
  }),
  FORMAT_API_RATE_LIMIT_WINDOW: num({
    default: 5, // 10 seconds
    desc: 'Time window for format API rate limiting in seconds',
  }),
  FORMAT_API_RATE_LIMIT_MAX_REQUESTS: num({
    default: 30, // allow 50 requests per IP per 10 seconds
  }),
  CATALOG_API_RATE_LIMIT_WINDOW: num({
    default: 5, // 1 minute
    desc: 'Time window for catalog API rate limiting in seconds',
  }),
  CATALOG_API_RATE_LIMIT_MAX_REQUESTS: num({
    default: 5, // allow 100 requests per IP per minute
  }),
  ANIME_API_RATE_LIMIT_WINDOW: num({
    default: 60, // 1 minute
    desc: 'Time window for mappings API rate limiting in seconds',
  }),
  ANIME_API_RATE_LIMIT_MAX_REQUESTS: num({
    default: 120,
    desc: 'Maximum number of requests allowed per IP within the time window',
  }),
  STREMIO_STREAM_RATE_LIMIT_WINDOW: num({
    default: 15, // 1 minute
    desc: 'Time window for Stremio stream rate limiting in seconds',
  }),
  STREMIO_STREAM_RATE_LIMIT_MAX_REQUESTS: num({
    default: 10, // allow 100 requests per IP per minute
    desc: 'Maximum number of requests allowed per IP within the time window',
  }),
  STREMIO_CATALOG_RATE_LIMIT_WINDOW: num({
    default: 5, // 1 minute
    desc: 'Time window for Stremio catalog rate limiting in seconds',
  }),
  STREMIO_CATALOG_RATE_LIMIT_MAX_REQUESTS: num({
    default: 30, // allow 100 requests per IP per minute
    desc: 'Maximum number of requests allowed per IP within the time window',
  }),
  STREMIO_MANIFEST_RATE_LIMIT_WINDOW: num({
    default: 5, // 1 minute
    desc: 'Time window for Stremio manifest rate limiting in seconds',
  }),
  STREMIO_MANIFEST_RATE_LIMIT_MAX_REQUESTS: num({
    default: 5, // allow 100 requests per IP per minute
    desc: 'Maximum number of requests allowed per IP within the time window',
  }),
  STREMIO_SUBTITLE_RATE_LIMIT_WINDOW: num({
    default: 5, // 1 minute
    desc: 'Time window for Stremio subtitle rate limiting in seconds',
  }),
  STREMIO_SUBTITLE_RATE_LIMIT_MAX_REQUESTS: num({
    default: 10, // allow 100 requests per IP per minute
    desc: 'Maximum number of requests allowed per IP within the time window',
  }),
  STREMIO_META_RATE_LIMIT_WINDOW: num({
    default: 5, // 1 minute
    desc: 'Time window for Stremio meta rate limiting in seconds',
  }),
  STREMIO_META_RATE_LIMIT_MAX_REQUESTS: num({
    default: 15, // allow 100 requests per IP per minute
    desc: 'Maximum number of requests allowed per IP within the time window',
  }),
  GDRIVE_STREAM_RATE_LIMIT_WINDOW: num({
    default: 5, // 1 minute
    desc: 'Time window for Google Drive stream rate limiting in seconds',
  }),
  GDRIVE_STREAM_RATE_LIMIT_MAX_REQUESTS: num({
    default: 10, // allow 100 requests per IP per minute
    desc: 'Maximum number of requests allowed per IP within the time window',
  }),
});
