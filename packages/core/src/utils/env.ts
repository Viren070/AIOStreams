import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  cleanEnv,
  str,
  bool,
  makeValidator,
  makeExactValidator,
  num,
  EnvError,
  port,
  EnvMissingError,
} from 'envalid';
import { randomBytes } from 'crypto';
import fs from 'fs';

/**
 * Bootstrap environment validation.
 *
 */

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
  function getResource(resourceName: string) {
    const filePath = path.join(
      __dirname,
      '../../../../',
      'resources',
      resourceName
    );
    if (!fs.existsSync(filePath)) {
      throw new Error(`Resource ${resourceName} not found at ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  metadata = getResource('metadata.json') || {};
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

const removeTrailingSlash = (x: string) =>
  x.endsWith('/') ? x.slice(0, -1) : x;

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

const readonly = makeValidator((x) => {
  if (x) {
    throw new EnvError('Readonly environment variable, cannot be set');
  }
  return x;
});

const proxyAuth = makeValidator((x) => {
  if (typeof x !== 'string') {
    throw new EnvError('Proxy auth must be a string');
  }
  // comma separated list of username:password
  const userMap: Map<string, string> = new Map();
  x.split(',').forEach((x) => {
    const [username, password] = x.split(':');
    if (!username || !password) {
      throw new EnvError(
        'Proxy auth must be a comma separated list of username:password pairs'
      );
    }
    userMap.set(username, password);
  });
  return userMap;
});

/** Permission names accepted in AIOSTREAMS_AUTH_PERMISSIONS. */
const PERMISSION_NAMES = ['admin', 'proxy', 'service', 'sabnzbd'] as const;

const permissionsMap = makeExactValidator<Map<string, Set<string>>>((x) => {
  const map = new Map<string, Set<string>>();
  if (x === '') {
    return map;
  }
  // comma separated list of `username=perm1|perm2`
  for (const entry of x.split(',').map((e) => e.trim())) {
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq === -1) {
      throw new EnvError(
        `Invalid permission entry "${entry}". Expected username=perm1|perm2`
      );
    }
    const username = entry.slice(0, eq).trim();
    const permsRaw = entry.slice(eq + 1).trim();
    if (!username) {
      throw new EnvError(
        `Invalid permission entry "${entry}". Expected username=perm1|perm2`
      );
    }
    const perms = new Set<string>();
    // `none` (or an empty value) grants no permissions: the user can still log
    // in to a protected config page but cannot use any permission-gated feature.
    if (permsRaw === '' || permsRaw === 'none') {
      map.set(username, perms);
      continue;
    }
    for (const perm of permsRaw.split('|').map((p) => p.trim())) {
      if (!perm) continue;
      if (perm === 'none') {
        throw new EnvError(
          `Permission "none" for user "${username}" cannot be combined with other permissions`
        );
      }
      if (!(PERMISSION_NAMES as readonly string[]).includes(perm)) {
        throw new EnvError(
          `Unknown permission "${perm}" for user "${username}". Valid permissions: ${PERMISSION_NAMES.join(', ')}, none`
        );
      }
      perms.add(perm);
    }
    map.set(username, perms);
  }
  return map;
});

const connectionLimits = makeValidator((x) => {
  if (typeof x !== 'string') {
    throw new EnvError('Connection limits must be a string');
  }
  // comma separated list of username:limit where limit is a number
  const limitMap: Map<string, number> = new Map();
  x.split(',').forEach((x) => {
    const [username, limitStr] = x.split(':');
    if (!username || !limitStr) {
      throw new EnvError(
        'Connection limits must be a comma separated list of username:limit pairs'
      );
    }
    const limit = Number(limitStr);
    if (limit === -1)
      if (Number.isNaN(limit) || limit < 0 || !Number.isInteger(limit)) {
        throw new EnvError(
          'Connection limit must be a positive integer or 0 for unlimited'
        );
      }
    limitMap.set(username, limit);
  });
  return limitMap;
});

/**
 * Resolves the effective time value for a given service from a serviceTimeMap.
 * Checks for a service-specific entry first, then falls back to the wildcard `*`.
 */
export function resolveServiceTime(
  map: Record<string, number>,
  serviceId: string
): number {
  return map[serviceId] ?? map['*'] ?? 0;
}

export const Env = cleanEnv(process.env, {
  VERSION: readonly({
    default: metadata?.version || 'unknown',
    desc: 'Version of the addon',
  }),
  TAG: readonly({
    default: metadata?.tag || 'unknown',
    desc: 'Tag of the addon',
  }),
  CHANNEL: readonly({
    default: (metadata?.channel as 'stable' | 'nightly' | 'dev') || 'stable',
    choices: ['stable', 'nightly', 'dev'],
    desc: 'Build channel of the addon',
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
  PORT: port({
    default: 3000,
    desc: 'Port to run the addon on',
  }),
  SECRET_KEY: secretKey({
    desc: 'Session/encryption secret used to derive keys for stored configurations. Must be a 64-character hex string. Generate with `openssl rand -hex 32`. Cannot be changed after first run. (Legacy alias `SESSION_SECRET` is still accepted for one minor release.)',
    example: 'Generate using: openssl rand -hex 32',
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
    default: 5000,
    desc: 'Redis timeout for the addon',
  }),
  SETTINGS_REFRESH_INTERVAL: num({
    default: 30,
    desc: 'How often (seconds) each instance polls the DB settings version and reloads runtime config if another instance changed it. Set 0 to disable (single-instance deployments).',
  }),
  LOG_LEVEL: str({
    default: 'info',
    desc: 'Log level for the addon',
    choices: [
      'info',
      'debug',
      'warn',
      'error',
      'verbose',
      'silly',
      'http',
      'trace',
    ],
  }),
  LOG_FORMAT: str({
    default: 'json',
    desc: 'Log format for the addon',
    choices: ['text', 'json'],
  }),
  LOG_BUFFER_MAX_BYTES: num({
    default: 67108864,
    desc: 'Max bytes of recent log lines kept in memory for the dashboard Logs page.',
  }),
  LOG_BUFFER_MAX_ENTRIES: num({
    default: 200000,
    desc: 'Hard cap on the number of recent log lines kept in memory for the dashboard Logs page.',
  }),
  AIOSTREAMS_AUTH: proxyAuth({
    default: new Map<string, string>(),
    desc: 'Authorisation credentials for this AIOStreams instance',
  }),
  AIOSTREAMS_AUTH_ADMINS: commaSeparated({
    default: undefined,
    desc: 'Comma separated list of admin usernames. If not set, all users are admins.',
  }),
  AIOSTREAMS_AUTH_PROXY: commaSeparated({
    default: undefined,
    desc: 'Comma separated list of usernames allowed to use the built-in proxy. If not set, all authenticated users can use the proxy.',
  }),
  AIOSTREAMS_AUTH_CONNECTIONS_LIMIT: connectionLimits({
    default: undefined,
    desc: 'Connection limits for authenticated users',
  }),
  AIOSTREAMS_AUTH_PERMISSIONS: permissionsMap({
    default: new Map<string, Set<string>>(),
    desc: 'Per-user permissions. Comma-separated `username=perm1|perm2` entries (valid permissions: admin, proxy, service, sabnzbd; or `none` for login-only with no permissions). Users not listed default to admin (a superset of all permissions). Supersedes the deprecated AIOSTREAMS_AUTH_ADMINS / AIOSTREAMS_AUTH_PROXY for any user listed here.',
  }),
  SYSTEM_LIFECYCLE_ENABLED: bool({
    default: false,
    desc: 'Allow the dashboard System page to restart/stop the AIOStreams process.',
  }),
});
