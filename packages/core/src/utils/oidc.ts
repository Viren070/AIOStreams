import * as client from 'openid-client';
import { ALL_PERMISSIONS, isPermission, Permission } from './permissions.js';
import { config as appConfig, subscribeToConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('oidc');

/** Null when any part is unrecognised, so a typo cannot silently grant less. */
export function parsePermissionSpec(spec: string): Permission[] | null {
  const trimmed = spec.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'none') return [];
  const parts = trimmed.split('|').map((p) => p.trim());
  const out = new Set<Permission>();
  for (const part of parts) {
    if (!isPermission(part)) return null;
    out.add(part);
  }
  if (out.has(Permission.Admin)) return [...ALL_PERMISSIONS];
  return [...out];
}

/**
 * Own-property lookup because group names come from the provider: `constructor`
 * and `__proto__` are legal group names that would otherwise return something
 * off Object.prototype.
 */
function lookupSpec(
  groupPermissions: Record<string, string>,
  group: string
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(groupPermissions, group)) {
    return undefined;
  }
  const spec = groupPermissions[group];
  return typeof spec === 'string' ? spec : undefined;
}

/**
 * Permissions for an OIDC subject, from its group claim. `null` means refuse
 * the login; an empty array means admit with no permissions, matching what
 * `none` does for an AIOSTREAMS_AUTH user (login-only, config page but no
 * permission-gated feature).
 *
 * Kept independent of getEffectivePermissions: an OIDC subject has no
 * AIOSTREAMS_AUTH entry, so that function's fallback would grant it everything.
 */
export function resolveOidcPermissions(
  groups: string[],
  groupPermissions: Record<string, string>,
  defaultSpec: string
): Permission[] | null {
  const granted = new Set<Permission>();
  let matched = false;
  for (const group of groups) {
    const spec = lookupSpec(groupPermissions, group);
    if (spec === undefined) continue;
    matched = true;
    const parsed = parsePermissionSpec(spec);
    if (parsed === null) {
      logger.error(
        { group, spec },
        'SSO group is mapped to an unparseable permission list; refusing the login'
      );
      return null;
    }
    for (const permission of parsed) {
      granted.add(permission);
    }
  }
  if (!matched) {
    // An unset default is the fail-closed case; an explicit `none` is the
    // operator admitting unmatched identities with nothing.
    if (defaultSpec.trim() === '') return null;
    const parsed = parsePermissionSpec(defaultSpec);
    if (parsed === null) {
      logger.error(
        { spec: defaultSpec },
        'SSO default permissions are unparseable; refusing the login'
      );
      return null;
    }
    for (const permission of parsed) {
      granted.add(permission);
    }
  }
  if (granted.has(Permission.Admin)) return [...ALL_PERMISSIONS];
  return [...granted];
}

/**
 * Server-side twin of the frontend's `safeNext`. Only same-origin absolute
 * paths survive.
 */
export function sanitiseNextPath(
  raw: unknown,
  fallback = '/dashboard/'
): string {
  if (typeof raw !== 'string' || raw === '') return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith('/')) return fallback;
  // Browsers normalise `\` to `/`, so `/\host` is protocol-relative too.
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) return fallback;
  if (/[\x00-\x1f\x7f]/.test(decoded)) return fallback;
  if (decoded.length > 512) return fallback;
  return decoded;
}

/** Constrained because the result reaches log lines and a cookie payload. */
export function sanitiseOidcUsername(raw: unknown, prefix = ''): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > 128) return null;
  if (/[\x00-\x1f\x7f-\x9f]/.test(trimmed)) return null;
  return `${prefix}${trimmed}`;
}

/** Groups arrive as an array from most providers and a delimited string from some. */
export function normaliseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((g): g is string => typeof g === 'string' && g !== '');
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,]+/)
      .map((g) => g.trim())
      .filter(Boolean);
  }
  return [];
}

export function isOidcAvailable(): boolean {
  const { enabled, issuer, clientId } = appConfig.oidc;
  return enabled && !!issuer && !!clientId;
}

/** The redirect URI that must be registered with the provider. */
export function effectiveRedirectUri(): string {
  const base = (appConfig.bootstrap.baseUrl ?? '').replace(/\/$/, '');
  return `${base}/api/v1/auth/oidc/callback`;
}

const DISCOVERY_TIMEOUT_SECONDS = 10;
const FAILURE_COOLDOWN_MS = 30_000;

let memo: { key: string; promise: Promise<client.Configuration> } | null = null;
let lastFailure: { at: number; error: unknown } | null = null;

function memoKey(): string {
  const { issuer, clientId, clientSecret, allowInsecureRequests } =
    appConfig.oidc;
  return JSON.stringify([
    issuer,
    clientId,
    clientSecret ? 'set' : null,
    allowInsecureRequests,
  ]);
}

/** Drops cached provider metadata, and with it the JWKS cache. */
export function invalidateOidcCache(): void {
  memo = null;
  lastFailure = null;
}

async function discover(): Promise<client.Configuration> {
  const { issuer, clientId, clientSecret, allowInsecureRequests } =
    appConfig.oidc;
  return client.discovery(
    new URL(issuer!),
    clientId!,
    {
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      // Clock drift against the provider is a common cause of exp/iat rejections.
      [client.clockTolerance]: 30,
    },
    clientSecret ? undefined : client.None(),
    {
      timeout: DISCOVERY_TIMEOUT_SECONDS,
      ...(allowInsecureRequests
        ? { execute: [client.allowInsecureRequests] }
        : {}),
    }
  );
}

/**
 * Provider metadata, discovered on first use and cached. The memo key covers
 * every field discovery depends on, so a missed invalidation self-corrects.
 */
export async function getOidcClientConfig(): Promise<client.Configuration> {
  if (!isOidcAvailable()) {
    throw new Error('OIDC is not configured');
  }
  const key = memoKey();
  if (memo && memo.key === key) return memo.promise;

  // Cooldown so autoRedirect against a dead provider cannot become a reload loop.
  if (lastFailure && Date.now() - lastFailure.at < FAILURE_COOLDOWN_MS) {
    throw lastFailure.error;
  }

  const promise = discover().catch((error) => {
    memo = null;
    lastFailure = { at: Date.now(), error };
    throw error;
  });
  memo = { key, promise };
  return promise;
}

/**
 * Registers the config subscription and warms the discovery cache. Never
 * throws: a slow or misconfigured provider must not stop startup, or the
 * dashboard needed to fix it is unreachable.
 */
export async function initialiseOidc(): Promise<void> {
  subscribeToConfig(({ changed }) => {
    for (const key of changed) {
      if (key.startsWith('oidc.')) {
        invalidateOidcCache();
        return;
      }
    }
  });

  if (!appConfig.oidc.enabled) return;

  if (!isOidcAvailable()) {
    logger.error(
      'SSO login is enabled but the issuer or client ID is missing; it will be unavailable until both are set.'
    );
    return;
  }
  if (appConfig.oidc.allowInsecureRequests) {
    logger.warn(
      'SSO is configured to allow insecure (http) provider requests; the client secret and tokens travel in the clear.'
    );
  }

  void getOidcClientConfig().then(
    () =>
      logger.info(
        { issuer: appConfig.oidc.issuer, redirectUri: effectiveRedirectUri() },
        'discovered SSO provider'
      ),
    (error) =>
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'SSO provider discovery failed at startup; login will retry on demand'
      )
  );
}

export interface OidcAuthorisationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Build the provider redirect, returning the values the caller must persist. */
export async function buildOidcAuthorisationRequest(): Promise<OidcAuthorisationRequest> {
  const configuration = await getOidcClientConfig();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: effectiveRedirectUri(),
    scope: appConfig.oidc.scopes.join(' '),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return { url: url.href, state, nonce, codeVerifier };
}

export interface OidcIdentity {
  username: string;
  groups: string[];
}

/**
 * Exchange the authorization code and resolve the identity behind it. The
 * callback URL is rebuilt from config, not the request: the redirect_uri sent
 * to the token endpoint must byte-match the one sent to the authorization
 * endpoint.
 */
export async function completeOidcLogin(
  callbackQuery: string,
  expected: { state: string; nonce: string; codeVerifier: string }
): Promise<OidcIdentity> {
  const configuration = await getOidcClientConfig();
  const currentUrl = new URL(effectiveRedirectUri());
  currentUrl.search = callbackQuery;

  const tokens = await client.authorizationCodeGrant(
    configuration,
    currentUrl,
    {
      expectedState: expected.state,
      expectedNonce: expected.nonce,
      pkceCodeVerifier: expected.codeVerifier,
      idTokenExpected: true,
    }
  );

  const { usernameClaim, groupsClaim, usernamePrefix } = appConfig.oidc;
  let claims: Record<string, unknown> = { ...tokens.claims() };

  // Some providers (Authentik, Okta) expose groups only from userinfo.
  if (
    (claims[usernameClaim] === undefined ||
      claims[groupsClaim] === undefined) &&
    tokens.access_token
  ) {
    try {
      const info = await client.fetchUserInfo(
        configuration,
        tokens.access_token,
        typeof claims.sub === 'string' ? claims.sub : client.skipSubjectCheck
      );
      claims = { ...claims, ...info };
    } catch (error) {
      logger.debug(
        { err: error instanceof Error ? error.message : String(error) },
        'userinfo lookup failed; continuing with ID token claims'
      );
    }
  }

  const username = sanitiseOidcUsername(claims[usernameClaim], usernamePrefix);
  if (!username) {
    throw new OidcClaimsError(
      `provider did not return a usable "${usernameClaim}" claim`
    );
  }
  return { username, groups: normaliseGroups(claims[groupsClaim]) };
}

/** Thrown when the provider authenticated someone we cannot identify. */
export class OidcClaimsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcClaimsError';
  }
}
