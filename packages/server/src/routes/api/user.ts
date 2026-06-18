import { Router } from 'express';
import {
  APIError,
  AnalyticsRepository,
  config as appConfig,
  constants,
  createLogger,
  encryptString,
  hmac,
  UserRepository,
  type UserAnalyticsRange,
} from '@aiostreams/core';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';
import { attachSession, injectAccessKey } from '../../middlewares/auth.js';
import { resolveUuidAliasForUserApi } from '../../middlewares/alias.js';
import { createResponse } from '../../utils/responses.js';
import { parseBasicAuthHeader } from '../../utils/basic-auth.js';
const router: Router = Router();

const logger = createLogger('server');

router.use(userApiRateLimiter);
router.use(attachSession);
router.use(resolveUuidAliasForUserApi);

// checking existence of a user
router.head('/', async (req, res, next) => {
  const uuid = req.uuid || req.query.uuid;
  if (typeof uuid !== 'string') {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'uuid must be a string'
      )
    );
    return;
  }

  try {
    const userExists = await UserRepository.checkUserExists(uuid);

    if (userExists) {
      res.status(200).json(
        createResponse({
          success: true,
          detail: 'User exists',
          data: {
            uuid,
          },
        })
      );
    } else {
      next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
    }
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
});

// getting user details
router.get('/', async (req, res, next) => {
  let creds;
  try {
    creds = parseBasicAuthHeader(req, { allowEncrypted: false });
  } catch (error) {
    next(error);
    return;
  }
  if (!creds) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'Authorization header (Basic) is required'
      )
    );
    return;
  }
  const uuid = req.uuid || creds.uuid;
  const password = creds.password;
  const raw = req.query.raw;
  let userData = null;
  try {
    userData =
      raw === 'true'
        ? await UserRepository.getRawUser(uuid, password)
        : await UserRepository.getUser(uuid, password);
  } catch (error: any) {
    if (error instanceof APIError) {
      next(error);
    } else {
      next(
        new APIError(
          constants.ErrorCode.INTERNAL_SERVER_ERROR,
          undefined,
          error.message
        )
      );
    }
    return;
  }

  const { success: successfulEncryption, data: encryptedPassword } =
    encryptString(password);

  if (!successfulEncryption) {
    next(new APIError(constants.ErrorCode.ENCRYPTION_ERROR));
    return;
  }

  // dont send accessKey to clients
  if (userData) {
    userData.accessKey = undefined;
  }

  res.status(200).json(
    createResponse({
      success: true,
      detail: 'User details retrieved successfully',
      data: {
        userData: userData,
        encryptedPassword: encryptedPassword,
      },
    })
  );
});

// new user creation
router.post('/', async (req, res, next) => {
  const { config, password } = req.body;
  if (!config || !password) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'config and password are required'
      )
    );
    return;
  }
  injectAccessKey(req, config);
  try {
    const { uuid, encryptedPassword } = await UserRepository.createUser(
      config,
      password
    );
    res.status(201).json(
      createResponse({
        success: true,
        detail: 'User was successfully created',
        data: {
          uuid,
          encryptedPassword,
        },
      })
    );
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
});

// updating user details
router.put('/', async (req, res, next) => {
  let creds;
  try {
    creds = parseBasicAuthHeader(req, { allowEncrypted: false });
  } catch (error) {
    next(error);
    return;
  }
  if (!creds) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'Authorization header (Basic) is required'
      )
    );
    return;
  }
  const uuid = req.uuid || creds.uuid;
  const password = creds.password;
  const { config } = req.body;
  if (!config) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'config is required'
      )
    );
    return;
  }

  try {
    config.uuid = uuid;
    injectAccessKey(req, config);
    const updatedUser = await UserRepository.updateUser(uuid, password, config);
    res.status(200).json(
      createResponse({
        success: true,
        detail: 'User updated successfully',
        data: {
          uuid,
          userData: updatedUser,
        },
      })
    );
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      logger.error(error);
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
});

router.delete('/', async (req, res, next) => {
  let creds;
  try {
    creds = parseBasicAuthHeader(req, { allowEncrypted: false });
  } catch (error) {
    next(error);
    return;
  }
  if (!creds) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'Authorization header (Basic) is required'
      )
    );
    return;
  }
  const uuid = req.uuid || creds.uuid;
  const password = creds.password;
  try {
    await UserRepository.deleteUser(uuid, password);
    res.status(200).json(
      createResponse({
        success: true,
        detail: 'User deleted successfully',
      })
    );
  } catch (error) {
    logger.error(error);
    if (error instanceof APIError) {
      next(error);
    } else {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
});

// change password
router.post('/password', async (req, res, next) => {
  let creds;
  try {
    creds = parseBasicAuthHeader(req, { allowEncrypted: false });
  } catch (error) {
    next(error);
    return;
  }
  if (!creds) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'Authorization header (Basic) with the current password is required'
      )
    );
    return;
  }
  const uuid = req.uuid || creds.uuid;
  const currentPassword = creds.password;
  const { newPassword } = req.body;

  if (!newPassword) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'newPassword is required'
      )
    );
    return;
  }

  try {
    const { encryptedPassword } = await UserRepository.changePassword(
      uuid,
      currentPassword,
      newPassword
    );

    res.status(200).json(
      createResponse({
        success: true,
        detail: 'Password changed successfully',
        data: {
          encryptedPassword,
        },
      })
    );
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      logger.error(error);
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
});

// verify a UUID + password pair (used when linking a parent config)
router.post('/verify', async (req, res, next) => {
  let creds;
  try {
    creds = parseBasicAuthHeader(req, { allowEncrypted: false });
  } catch (error) {
    next(error);
    return;
  }
  if (!creds) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'Authorization header (Basic) is required'
      )
    );
    return;
  }
  const uuid = req.uuid || creds.uuid;
  const password = creds.password;

  try {
    const { createdAt } = await UserRepository.verifyUser(uuid, password);
    res.status(200).json(
      createResponse({
        success: true,
        detail: 'Credentials verified successfully',
        data: { uuid, createdAt },
      })
    );
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
});

/**
 * Per-user analytics breakdown for the configure-page "Stats" tab. Auth uses
 * uuid + password (matching the existing GET /); the server hashes the uuid
 * itself, so clients can never request another user's data. Returns 403 when
 * the instance owner has disabled analytics globally or per-user.
 */
router.get('/analytics', async (req, res, next) => {
  let creds;
  try {
    creds = parseBasicAuthHeader(req, { allowEncrypted: false });
  } catch (error) {
    next(error);
    return;
  }
  if (!creds) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'Authorization header (Basic) is required'
      )
    );
    return;
  }
  const uuid = req.uuid || creds.uuid;
  const password = creds.password;

  if (
    appConfig.analytics.enabled === false ||
    appConfig.analytics.userAnalyticsEnabled !== true
  ) {
    next(
      new APIError(
        constants.ErrorCode.FORBIDDEN,
        undefined,
        'Per-user analytics is disabled by the instance owner.'
      )
    );
    return;
  }

  try {
    // Throws with the standard credential error if invalid — never reveals
    // whether the uuid exists.
    await UserRepository.verifyUser(uuid, password);
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      logger.error(error);
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
    return;
  }

  const rawRange = (req.query.range as string | undefined) ?? '7d';
  const range: UserAnalyticsRange = rawRange === '24h' ? '24h' : '7d';

  try {
    const uuidHash = hmac(uuid);
    const data = await AnalyticsRepository.userBreakdown(uuidHash, range);
    res.status(200).json(
      createResponse({
        success: true,
        data,
      })
    );
  } catch (error) {
    logger.error(error);
    next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
  }
});

export default router;
