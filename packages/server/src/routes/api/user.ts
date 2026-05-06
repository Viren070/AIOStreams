import { Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  encryptString,
  UserRepository,
} from '@aiostreams/core';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';
import { resolveUuidAliasForUserApi } from '../../middlewares/alias.js';
import { createResponse } from '../../utils/responses.js';
const router: Router = Router();

const logger = createLogger('server');

router.use(userApiRateLimiter);
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

// Shared handler used by both `GET /` (deprecated, query string) and
// `POST /load` (preferred, JSON body). The GET form leaks the password
// into HTTP access logs, browser history, Referer headers, etc. — see
// issue #926. POST /load lets the password ride in the request body so
// reverse proxies don't log it. The GET handler is kept for backward
// compatibility (the API is public; users may have automation hitting
// it) and emits a deprecation warning on each call.
async function handleGetUserDetails(
  uuid: unknown,
  password: unknown,
  raw: unknown,
  next: (err?: any) => void,
  res: any
) {
  if (typeof uuid !== 'string' || typeof password !== 'string') {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'uuid and password must be strings'
      )
    );
    return;
  }
  let userData = null;
  try {
    userData =
      raw === 'true' || raw === true
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
}

// getting user details (DEPRECATED form — password rides in the query
// string and ends up in HTTP access logs / browser history / Referer
// headers, see #926). Kept for backward compatibility with existing
// clients and documented automation; new callers should use
// `POST /api/v1/user/load`.
router.get('/', async (req, res, next) => {
  logger.warn(
    'Deprecated: GET /api/v1/user exposes the password in the request URL ' +
      '(visible in HTTP access logs, browser history, Referer headers). ' +
      'Use POST /api/v1/user/load instead. See https://github.com/Viren070/AIOStreams/issues/926'
  );
  await handleGetUserDetails(
    req.uuid || req.query.uuid,
    req.query.password,
    req.query.raw,
    next,
    res
  );
});

// getting user details — preferred form: password is in the JSON body
// so it never appears in URLs, access logs, or Referer headers.
router.post('/load', async (req, res, next) => {
  const body = (req.body ?? {}) as {
    uuid?: unknown;
    password?: unknown;
    raw?: unknown;
  };
  await handleGetUserDetails(
    req.uuid || body.uuid,
    body.password,
    body.raw,
    next,
    res
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
  //
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
  const { uuid, password, config } = {
    ...req.body,
    uuid: req.uuid || req.body.uuid,
  };
  if (!uuid || !password || !config) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'uuid, password and config are required'
      )
    );
    return;
  }

  try {
    config.uuid = uuid;
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
  const { uuid, password } = {
    ...req.body,
    uuid: req.uuid || req.body.uuid,
  };
  if (!uuid || !password) {
    next(new APIError(constants.ErrorCode.MISSING_REQUIRED_FIELDS));
    return;
  }
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
  const { uuid, currentPassword, newPassword } = {
    ...req.body,
    uuid: req.uuid || req.body.uuid,
  };

  if (!uuid || !currentPassword || !newPassword) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'uuid, currentPassword and newPassword are required'
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
  const { uuid, password } = req.body;
  if (typeof uuid !== 'string' || typeof password !== 'string') {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'uuid and password must be strings'
      )
    );
    return;
  }

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

export default router;
