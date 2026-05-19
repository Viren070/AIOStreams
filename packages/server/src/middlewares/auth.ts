import { Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  config as appConfig,
  verifySession,
  issueSession,
  getConfigAccessKey,
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
  username: string
): void {
  const token = issueSession(username);
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
    req.user = { username: session.username, isAdmin: session.isAdmin };
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
    (config as { accessToken?: string }).accessToken = key;
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
      req.user = { username: session.username, isAdmin: session.isAdmin };
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
 * Requires a valid admin session. Chains requireSession, then rejects
 * non-admins (403 / redirect to /).
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  requireSession(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (!res.headersSent && req.user) {
      if (req.user.isAdmin) {
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
}

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
