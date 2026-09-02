import { Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  config as appConfig,
  verifySession,
  issueSession,
  getConfigAccessKey,
  sessionHasPermission,
  Permission,
  SessionSource,
  encodeSignedPayload,
  decodeSignedPayload,
} from '@aiostreams/core';

export const SESSION_COOKIE = 'aiostreams.session';

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

export function setSessionCookie(
  req: Request,
  res: Response,
  user: { username: string; permissions?: Permission[]; source?: SessionSource }
): void {
  const token = issueSession(user.username, {
    permissions: user.permissions,
    source: user.source,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
    maxAge: appConfig.api.sessionTtlSeconds * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const CONFIG_SESSION_COOKIE = 'aiostreams.config-session';

/** Carries no secret; lets the page tell whether a restore is worth a request. */
export const CONFIG_SESSION_MARKER_COOKIE = 'aiostreams.has-config-session';

const CONFIG_SESSION_PATH = '/api';

// Must be readable from the configure page, which is not under /api.
const CONFIG_SESSION_MARKER_PATH = '/';

export function readConfigSessionToken(req: Request): string | undefined {
  return readCookie(req, CONFIG_SESSION_COOKIE);
}

export function setConfigSessionCookie(
  req: Request,
  res: Response,
  token: string,
  remembered: boolean,
  expiresAt: number
): void {
  // No maxAge means the browser drops it on close.
  const maxAge = remembered ? Math.max(expiresAt - Date.now(), 0) : undefined;
  res.cookie(CONFIG_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    path: CONFIG_SESSION_PATH,
    ...(maxAge === undefined ? {} : { maxAge }),
  });
  res.cookie(CONFIG_SESSION_MARKER_COOKIE, '1', {
    httpOnly: false,
    secure: req.secure,
    sameSite: 'strict',
    path: CONFIG_SESSION_MARKER_PATH,
    ...(maxAge === undefined ? {} : { maxAge }),
  });
}

export function clearConfigSessionCookie(res: Response): void {
  res.clearCookie(CONFIG_SESSION_COOKIE, { path: CONFIG_SESSION_PATH });
  res.clearCookie(CONFIG_SESSION_MARKER_COOKIE, {
    path: CONFIG_SESSION_MARKER_PATH,
  });
}

export const OIDC_STATE_COOKIE = 'aiostreams.oidc';
const OIDC_COOKIE_PATH = '/api/v1/auth/oidc';
const OIDC_STATE_TTL_SECONDS = 600;

export interface OidcStateBlob {
  /** state */
  st: string;
  /** nonce */
  n: string;
  /** PKCE code verifier */
  v: string;
  /** post-login redirect target */
  nx: string;
  exp: number;
}

/**
 * CSRF binding for one in-flight login.
 *
 * sameSite must be 'lax': the callback is a top-level navigation from the
 * provider's origin, and a 'strict' cookie is withheld from it.
 */
export function setOidcStateCookie(
  req: Request,
  res: Response,
  blob: Omit<OidcStateBlob, 'exp'>
): void {
  const payload: OidcStateBlob = {
    ...blob,
    exp: Math.floor(Date.now() / 1000) + OIDC_STATE_TTL_SECONDS,
  };
  res.cookie(OIDC_STATE_COOKIE, encodeSignedPayload(payload), {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    path: OIDC_COOKIE_PATH,
    maxAge: OIDC_STATE_TTL_SECONDS * 1000,
  });
}

export function readOidcStateCookie(req: Request): OidcStateBlob | null {
  const blob = decodeSignedPayload<OidcStateBlob>(
    readCookie(req, OIDC_STATE_COOKIE)
  );
  if (!blob) return null;
  if (
    typeof blob.st !== 'string' ||
    typeof blob.n !== 'string' ||
    typeof blob.v !== 'string' ||
    typeof blob.exp !== 'number' ||
    blob.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return blob;
}

export function clearOidcStateCookie(res: Response): void {
  // The path must match the one it was set with or this is a no-op.
  res.clearCookie(OIDC_STATE_COOKIE, { path: OIDC_COOKIE_PATH });
}

/**
 * Reads the session cookie if present and attaches req.user. Never rejects —
 * downstream middleware decides whether a session is required.
 */
export function attachSession(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const session = verifySession(readCookie(req, SESSION_COOKIE));
  if (session) {
    req.user = session;
  }
  next();
}

/**
 * When the config-write gate is active, a valid login session authorises
 * creating/updating/previewing configs: the server injects the current
 * access key into the config so it passes the data-layer check
 * (`assertConfigAccessKey`). Callers without a session cannot obtain the
 * key and are rejected. No-op when the gate is disabled (key is null).
 *
 * Requires `attachSession` to have run first so `req.user` is populated.
 */
export function injectAccessKey(
  req: { user?: unknown },
  config: unknown
): void {
  const key = getConfigAccessKey();
  if (key && req.user && config && typeof config === 'object') {
    (config as { accessKey?: string }).accessKey = key;
  }
}

/**
 * Requires a valid session. For HTML navigations, redirects to
 * /login?next=<original>. For API/XHR requests, responds 401.
 */
export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    const session = verifySession(readCookie(req, SESSION_COOKIE));
    if (session) {
      req.user = session;
    }
  }
  if (req.user) {
    next();
    return;
  }
  if (req.accepts(['html', 'json']) === 'html') {
    const nextUrl = encodeURIComponent(req.originalUrl);
    res.redirect(302, `/login?next=${nextUrl}`);
    return;
  }
  next(new APIError(constants.ErrorCode.UNAUTHORIZED));
}

/**
 * Requires a valid session whose user holds the given permission. Chains
 * requireSession, then rejects users lacking the permission (403 / redirect to
 * /). `admin` implies every permission.
 */
export function requirePermission(permission: Permission) {
  return function (req: Request, res: Response, next: NextFunction): void {
    requireSession(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (!res.headersSent && req.user) {
        if (sessionHasPermission(req.user, permission)) {
          next();
          return;
        }
        if (req.accepts(['html', 'json']) === 'html') {
          res.redirect(302, '/');
          return;
        }
        next(new APIError(constants.ErrorCode.FORBIDDEN));
      }
    });
  };
}

/**
 * Requires a valid admin session. Rejects non-admins (403 / redirect to /).
 */
export const requireAdmin = requirePermission(Permission.Admin);

/**
 * Applies requireSession only when the config page is auth-gated
 * (AIOSTREAMS_AUTH_REQUIRED=true). Otherwise passes through.
 */
export function requireSessionIfAuthRequired(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!appConfig.api.authRequired) {
    next();
    return;
  }
  requireSession(req, res, next);
}
