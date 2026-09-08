import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { createLogger } from '../logging/logger.js';
import { APIError, ErrorCode } from './constants.js';
import { toUrlSafeBase64, fromUrlSafeBase64 } from './general.js';
import { config as appConfig, settingsStore } from '../config/index.js';
import { Permission, ALL_PERMISSIONS, isPermission } from './permissions.js';

const logger = createLogger('auth');

const CONFIG_ACCESS_KEY_SETTING = 'api.configAccessKey';
const AUTH_REQUIRED_SETTING = 'api.authRequired';

/**
 * Where a session's permissions come from: `password` re-resolves them from the
 * environment on every request, `oidc` carries the set resolved at login.
 */
export type SessionSource = 'password' | 'oidc';

export interface SessionUser {
  username: string;
  isAdmin: boolean;
  permissions: Permission[];
  source: SessionSource;
}

interface SessionPayload {
  u: string;
  a: boolean;
  exp: number;
  /** Resolved permissions. Written for OIDC sessions only. */
  p?: Permission[];
  /** Absent means a password session. */
  s?: 'oidc';
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Parse a credential string into its username/password parts. Accepts both
 * plaintext `username:password` and `base64(username:password)`. Returns null when the input cannot be parsed into
 * a non-empty username/password pair.
 */
export function parseCredential(
  raw: string | undefined | null
): { username: string; password: string } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  let decoded = raw;
  if (!raw.includes(':')) {
    try {
      const candidate = Buffer.from(raw, 'base64').toString('utf-8');
      if (!candidate.includes(':')) return null;
      decoded = candidate;
    } catch {
      return null;
    }
  }

  const sep = decoded.indexOf(':');
  if (sep === -1) return null;
  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  if (!username || !password) return null;
  return { username, password };
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

export type AuthTokenCheck =
  | { ok: true; username: string; password: string }
  | { ok: false; reason: string };

/**
 * Check a credential token (`user:pass` or `base64(user:pass)`) against the
 * AIOSTREAMS_AUTH map, optionally requiring a permission. On failure, `reason`
 * states which check failed.
 */
export function checkAuthToken(
  raw: string | undefined | null,
  permission?: Permission
): AuthTokenCheck {
  const creds = parseCredential(raw);
  if (!creds) {
    return {
      ok: false,
      reason: 'credential is not a user:pass or base64(user:pass) pair',
    };
  }
  if (!appConfig.bootstrap.auth?.has(creds.username)) {
    return {
      ok: false,
      reason: `user "${creds.username}" not found in AIOSTREAMS_AUTH`,
    };
  }
  if (!validateCredentials(creds.username, creds.password)) {
    return { ok: false, reason: `wrong password for user "${creds.username}"` };
  }
  if (permission && !hasPermission(creds.username, permission)) {
    return {
      ok: false,
      reason: `user "${creds.username}" lacks the "${permission}" permission`,
    };
  }
  return { ok: true, username: creds.username, password: creds.password };
}

/**
 * Resolve the effective permission set for a username.
 *
 * - Users listed in AIOSTREAMS_AUTH_PERMISSIONS get exactly that set (with
 *   `admin` expanded to every permission).
 * - Users not listed fall back to the legacy AIOSTREAMS_AUTH_ADMINS /
 *   AIOSTREAMS_AUTH_PROXY behaviour: admin if the admin list is empty or
 *   includes them; proxy if the proxy list is empty or includes them; service
 *   sabnzbd and webdav are always granted. With no legacy vars set this means every user is an admin.
 *
 * Password identities only: an OIDC subject has no AIOSTREAMS_AUTH entry, so it
 * would take that fallback and receive every permission.
 */
export function getEffectivePermissions(username: string): Set<Permission> {
  const configured = appConfig.bootstrap.authPermissions?.get(username);
  if (configured) {
    if (configured.has(Permission.Admin)) {
      return new Set(ALL_PERMISSIONS);
    }
    return new Set(configured as Set<Permission>);
  }

  const admins = appConfig.bootstrap.authAdmins;
  const isAdmin = !admins || admins.length === 0 || admins.includes(username);
  if (isAdmin) {
    return new Set(ALL_PERMISSIONS);
  }

  const proxyAllow = appConfig.bootstrap.authProxy;
  const canProxy =
    !proxyAllow || proxyAllow.length === 0 || proxyAllow.includes(username);

  // createConfig is included here because the legacy vars only ever excluded a
  // user from *admin*, never from managing configurations.
  const perms = new Set<Permission>([
    Permission.Service,
    Permission.Sabnzbd,
    Permission.Webdav,
    Permission.CreateConfig,
  ]);
  if (canProxy) perms.add(Permission.Proxy);
  return perms;
}

/**
 * Whether a username holds the given permission. `admin` implies all.
 */
export function hasPermission(
  username: string,
  permission: Permission
): boolean {
  const perms = getEffectivePermissions(username);
  return perms.has(Permission.Admin) || perms.has(permission);
}

/**
 * Whether a username is an admin. If AIOSTREAMS_AUTH_ADMINS is unset/empty,
 * every authenticated user is an admin (matches the documented env behaviour).
 */
export function isAdminUser(username: string): boolean {
  return hasPermission(username, Permission.Admin);
}

/**
 * Whether a username is allowed to use the built-in proxy.
 * If AIOSTREAMS_AUTH_PROXY is unset/empty, all authenticated users may use it.
 */
export function canUseProxy(username: string): boolean {
  return hasPermission(username, Permission.Proxy);
}

/**
 * Emit a one-time deprecation warning when the legacy permission env vars are
 * set. Call once at startup. AIOSTREAMS_AUTH_PERMISSIONS supersedes them.
 */
export function warnLegacyAuthVarsIfNeeded(): void {
  const legacy: string[] = [];
  if (appConfig.bootstrap.authAdmins?.length) {
    legacy.push('AIOSTREAMS_AUTH_ADMINS');
  }
  if (appConfig.bootstrap.authProxy?.length) {
    legacy.push('AIOSTREAMS_AUTH_PROXY');
  }
  if (legacy.length === 0) return;

  if ((appConfig.bootstrap.authPermissions?.size ?? 0) > 0) {
    logger.warn(
      `${legacy.join(' and ')} are deprecated and only apply to users not listed in AIOSTREAMS_AUTH_PERMISSIONS. Migrate them into AIOSTREAMS_AUTH_PERMISSIONS.`
    );
  } else {
    logger.warn(
      `${legacy.join(' and ')} are deprecated. Use AIOSTREAMS_AUTH_PERMISSIONS instead (e.g. user1=admin,user2=proxy|sabnzbd).`
    );
  }
}

/**
 * Warn about explicit permission lists that predate a permission they now need.
 * Written before `createConfig` existed, such a list silently loses it. Call
 * once at startup; reuse for any permission added later.
 */
export function warnMissingConfigPermission(): void {
  if (!appConfig.api.authRequired) return;
  const configured = appConfig.bootstrap.authPermissions;
  if (!configured || configured.size === 0) return;

  const affected = [...configured]
    .filter(
      ([, perms]) =>
        !perms.has(Permission.Admin) && !perms.has(Permission.CreateConfig)
    )
    .map(([username]) => username);

  if (affected.length === 0) return;
  logger.warn(
    { users: affected },
    `these users have an explicit AIOSTREAMS_AUTH_PERMISSIONS entry without "${Permission.CreateConfig}" and can no longer create configurations. Add it to their entry if that is not intended.`
  );
}

function sign(data: string): string {
  return createHmac('sha256', appConfig.bootstrap.secretKey)
    .update(data)
    .digest('base64url');
}

/** Encode a payload as `base64url(json).hmac`. */
export function encodeSignedPayload(payload: object): string {
  const body = toUrlSafeBase64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/**
 * Inverse of {@link encodeSignedPayload}. Returns null on a bad signature or
 * malformed body; the caller validates the payload's own fields.
 */
export function decodeSignedPayload<T>(token: string | undefined): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!constantTimeEquals(sig, sign(body))) return null;
  try {
    return JSON.parse(fromUrlSafeBase64(body)) as T;
  } catch {
    return null;
  }
}

/**
 * Issue a stateless, HMAC-signed session token (JWT-like) for a username.
 */
export function issueSession(
  username: string,
  options?: { permissions?: Permission[]; source?: SessionSource }
): string {
  const ttl = appConfig.api.sessionTtlSeconds;
  const isOidc = options?.source === 'oidc';
  const permissions = options?.permissions ?? [];
  const payload: SessionPayload = {
    u: username,
    a: isOidc ? permissions.includes(Permission.Admin) : isAdminUser(username),
    exp: Math.floor(Date.now() / 1000) + ttl,
    ...(isOidc ? { p: permissions, s: 'oidc' as const } : {}),
  };
  return encodeSignedPayload(payload);
}

/**
 * Verify a session token. Returns the session user on success, null on any
 * failure (bad signature, malformed, expired).
 *
 * Tokens without `s` take the password path, which keeps already-issued
 * cookies valid.
 */
export function verifySession(token: string | undefined): SessionUser | null {
  const payload = decodeSignedPayload<SessionPayload>(token);
  if (!payload) return null;
  if (
    typeof payload.u !== 'string' ||
    typeof payload.exp !== 'number' ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  if (payload.s === 'oidc') {
    // Must not fall through to the password path below, whose fallback grants
    // every permission to a username it does not know. An empty array is
    // deliberate (login-only) and stays valid; a missing one is not.
    if (!Array.isArray(payload.p)) return null;
    const granted = payload.p.filter(isPermission);
    // Everything filtered out means this replica predates every name in the
    // token, so re-authenticate rather than silently downgrading to none.
    if (payload.p.length > 0 && granted.length === 0) return null;
    const permissions = granted.includes(Permission.Admin)
      ? [...ALL_PERMISSIONS]
      : granted;
    return {
      username: payload.u,
      isAdmin: permissions.includes(Permission.Admin),
      permissions,
      source: 'oidc',
    };
  }

  const permissions = [...getEffectivePermissions(payload.u)];
  return {
    username: payload.u,
    isAdmin: permissions.includes(Permission.Admin),
    permissions,
    source: 'password',
  };
}

/**
 * Whether a session holds a permission. `admin` implies all. Use this rather
 * than {@link hasPermission} for anything driven by a session cookie.
 */
export function sessionHasPermission(
  user: SessionUser,
  permission: Permission
): boolean {
  return (
    user.permissions.includes(Permission.Admin) ||
    user.permissions.includes(permission)
  );
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
