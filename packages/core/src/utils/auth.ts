import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { createLogger } from '../logging/logger.js';
import { APIError, ErrorCode } from './constants.js';
import { toUrlSafeBase64, fromUrlSafeBase64 } from './general.js';
import { config as appConfig, settingsStore } from '../config/index.js';

const logger = createLogger('auth');

const CONFIG_ACCESS_KEY_SETTING = 'api.configAccessKey';
const AUTH_REQUIRED_SETTING = 'api.authRequired';

export interface SessionUser {
  username: string;
  isAdmin: boolean;
}

interface SessionPayload {
  u: string;
  a: boolean;
  exp: number;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Validate a username/password pair against the AIOSTREAMS_AUTH credential
 * map. This is the same map used by the built-in proxy and NZB-grab proxying.
 */
export function validateCredentials(
  username: string,
  password: string
): boolean {
  const stored = appConfig.bootstrap.auth?.get(username);
  if (stored === undefined) return false;
  return constantTimeEquals(stored, password);
}

/**
 * Whether a username is an admin. If AIOSTREAMS_AUTH_ADMINS is unset/empty,
 * every authenticated user is an admin (matches the documented env behaviour).
 */
export function isAdminUser(username: string): boolean {
  const admins = appConfig.bootstrap.authAdmins;
  if (!admins || admins.length === 0) return true;
  return admins.includes(username);
}

function sign(data: string): string {
  return createHmac('sha256', appConfig.bootstrap.secretKey)
    .update(data)
    .digest('base64url');
}

/**
 * Issue a stateless, HMAC-signed session token (JWT-like) for a username.
 */
export function issueSession(username: string): string {
  const ttl = appConfig.api.sessionTtlSeconds;
  const payload: SessionPayload = {
    u: username,
    a: isAdminUser(username),
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  const body = toUrlSafeBase64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/**
 * Verify a session token. Returns the session user on success, null on any
 * failure (bad signature, malformed, expired).
 */
export function verifySession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!constantTimeEquals(sig, sign(body))) return null;
  try {
    const payload = JSON.parse(fromUrlSafeBase64(body)) as SessionPayload;
    if (
      typeof payload.u !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return { username: payload.u, isAdmin: !!payload.a };
  } catch {
    return null;
  }
}

/**
 * The active config access key, or null when the config-write gate is
 * disabled (authRequired is false).
 */
export function getConfigAccessKey(): string | null {
  if (!appConfig.api.authRequired) return null;
  const key = appConfig.api.configAccessKey;
  return key && key.length > 0 ? key : null;
}

function regenerateAccessKey(): string {
  const newKey = randomBytes(24).toString('hex');
  settingsStore.set(CONFIG_ACCESS_KEY_SETTING, newKey, 'system:auth');
  return newKey;
}

/**
 * Ensure a config access key exists. Call once at startup.
 *
 */
export async function ensureConfigAccessKey(): Promise<void> {
  if (appConfig.api.configAccessKey) return;
  if (process.env.CONFIG_ACCESS_KEY !== undefined) return; // env-managed

  const legacy = process.env.ADDON_PASSWORD;
  const passwords = legacy
    ?.split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (legacy && legacy.length > 0 && passwords && passwords.length > 0) {
    await settingsStore.set(
      CONFIG_ACCESS_KEY_SETTING,
      passwords[0],
      'system:auth'
    );
    if (!appConfig.api.authRequired) {
      await settingsStore.set(AUTH_REQUIRED_SETTING, true, 'system:auth');
    }
    logger.warn(
      'Migrated legacy ADDON_PASSWORD env into the config access key setting. ADDON_PASSWORD is deprecated; use CONFIG_ACCESS_KEY or manage the key from the dashboard.'
    );
    return;
  }

  if (!appConfig.api.authRequired) return;
  regenerateAccessKey();
  logger.info(
    'Generated and persisted a config access key (CONFIG_ACCESS_KEY was not set).'
  );
}

/**
 * Enforce the config-write gate. When the gate is active, the config must
 * carry the current access key in its `accessKey` field. Throws
 * ADDON_PASSWORD_INVALID otherwise. No-op when the gate is disabled.
 */
export function assertConfigAccessKey(config: { accessKey?: string }): void {
  let key = getConfigAccessKey();
  if (!key) {
    if (appConfig.api.authRequired) {
      logger.warn(
        'Config access key is missing but auth is required; a new key is being generated'
      );
      key = regenerateAccessKey();
    } else {
      return;
    }
  }
  if (!config.accessKey || !constantTimeEquals(config.accessKey, key)) {
    throw new APIError(ErrorCode.ADDON_PASSWORD_INVALID);
  }
}
