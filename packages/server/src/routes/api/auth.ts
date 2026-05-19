import { Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  validateCredentials,
  isAdminUser,
} from '@aiostreams/core';
import { loginRateLimiter } from '../../middlewares/ratelimit.js';
import {
  attachSession,
  setSessionCookie,
  clearSessionCookie,
} from '../../middlewares/auth.js';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('server');

// POST /auth/login — validate credentials, set the session cookie.
router.post('/login', loginRateLimiter, (req, res, next) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'username and password are required'
      )
    );
    return;
  }

  if (!validateCredentials(username, password)) {
    logger.warn(`Failed login attempt for user "${username}"`);
    next(
      new APIError(
        constants.ErrorCode.UNAUTHORIZED,
        undefined,
        'Invalid username or password'
      )
    );
    return;
  }

  setSessionCookie(req, res, username);
  res.status(200).json(
    createResponse({
      success: true,
      detail: 'Logged in successfully',
      data: { username, isAdmin: isAdminUser(username) },
    })
  );
});

// POST /auth/logout — clear the session cookie.
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(200).json(
    createResponse({
      success: true,
      detail: 'Logged out successfully',
    })
  );
});

// GET /auth/me — current session user, or 401.
router.get('/me', attachSession, (req, res, next) => {
  if (!req.user) {
    next(new APIError(constants.ErrorCode.UNAUTHORIZED));
    return;
  }
  res.status(200).json(
    createResponse({
      success: true,
      data: { username: req.user.username, isAdmin: req.user.isAdmin },
    })
  );
});

export default router;
