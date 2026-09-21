import { Router } from 'express';
import type { Response } from 'express';
import {
  config as appConfig,
  constants,
  createLogger,
  isOidcAvailable,
  buildOidcAuthorisationRequest,
  completeOidcLogin,
  getEffectivePermissions,
  Permission,
  resolveOidcPermissions,
  sanitiseNextPath,
  OidcClaimsError,
} from '@aiostreams/core';
import { oidcRateLimiter } from '../../../middlewares/ratelimit.js';
import {
  setSessionCookie,
  setOidcStateCookie,
  readOidcStateCookie,
  clearOidcStateCookie,
} from '../../../middlewares/auth.js';

const router: Router = Router();
const logger = createLogger('server');

/**
 * These routes are browser navigations, so failures redirect rather than
 * returning a JSON body that would render in the address bar.
 */
function failToLogin(res: Response, code: constants.ErrorCode): void {
  res.redirect(302, `/login?error=${code.toLowerCase()}`);
}

router.get('/oidc/start', oidcRateLimiter, async (req, res) => {
  if (!appConfig.oidc.enabled) {
    failToLogin(res, constants.ErrorCode.OIDC_DISABLED);
    return;
  }
  if (!isOidcAvailable()) {
    logger.error('SSO login attempted but the issuer or client ID is unset');
    failToLogin(res, constants.ErrorCode.OIDC_NOT_CONFIGURED);
    return;
  }

  try {
    const { url, state, nonce, codeVerifier } =
      await buildOidcAuthorisationRequest();
    setOidcStateCookie(req, res, {
      st: state,
      n: nonce,
      v: codeVerifier,
      nx: sanitiseNextPath(req.query.next),
    });
    res.redirect(302, url);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'failed to build the SSO authorisation request'
    );
    failToLogin(res, constants.ErrorCode.OIDC_DISCOVERY_FAILED);
  }
});

router.get('/oidc/callback', oidcRateLimiter, async (req, res) => {
  if (!isOidcAvailable()) {
    failToLogin(res, constants.ErrorCode.OIDC_DISABLED);
    return;
  }

  const blob = readOidcStateCookie(req);
  clearOidcStateCookie(res);
  if (!blob) {
    logger.warn('SSO callback carried no valid state cookie');
    failToLogin(res, constants.ErrorCode.OIDC_STATE_INVALID);
    return;
  }

  if (typeof req.query.error === 'string') {
    // error_description is provider-controlled, so it stays out of the redirect.
    logger.warn(
      {
        error: req.query.error,
        description:
          typeof req.query.error_description === 'string'
            ? req.query.error_description
            : undefined,
      },
      'SSO provider returned an error'
    );
    failToLogin(res, constants.ErrorCode.OIDC_DENIED);
    return;
  }

  let identity;
  try {
    const query = req.originalUrl.slice(req.originalUrl.indexOf('?') + 1);
    identity = await completeOidcLogin(query, {
      state: blob.st,
      nonce: blob.n,
      codeVerifier: blob.v,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof OidcClaimsError) {
      logger.error({ err: message }, 'SSO login returned unusable claims');
      failToLogin(res, constants.ErrorCode.OIDC_CLAIMS_INVALID);
      return;
    }
    logger.warn({ err: message }, 'SSO code exchange failed');
    failToLogin(res, constants.ErrorCode.OIDC_EXCHANGE_FAILED);
    return;
  }

  const { username, groups } = identity;

  const isLocalUser = appConfig.bootstrap.auth?.has(username) ?? false;
  if (isLocalUser && !appConfig.oidc.linkByUsername) {
    logger.error(
      { username },
      'SSO login refused: the username collides with a local AIOSTREAMS_AUTH user. Enable linking by username, set an SSO username prefix, change the username claim, or rename the local user.'
    );
    failToLogin(res, constants.ErrorCode.OIDC_USERNAME_CONFLICT);
    return;
  }

  let permissions: Permission[];
  if (isLocalUser) {
    // The local entry is the whole configuration for this person; consulting
    // the group mapping too would mean maintaining them in two places.
    permissions = [...getEffectivePermissions(username)];
    logger.debug({ username }, 'SSO identity linked to a local user');
  } else {
    const resolved = resolveOidcPermissions(
      groups,
      appConfig.oidc.groupPermissions,
      appConfig.oidc.defaultPermissions
    );
    if (resolved === null) {
      logger.warn(
        { username, groups },
        'SSO login refused: the groups claim resolved to no permissions'
      );
      failToLogin(res, constants.ErrorCode.OIDC_NO_PERMISSIONS);
      return;
    }
    permissions = resolved;
  }

  setSessionCookie(req, res, { username, permissions, source: 'oidc' });
  logger.info({ username, permissions }, 'SSO login succeeded');
  res.redirect(302, sanitiseNextPath(blob.nx));
});

export default router;
