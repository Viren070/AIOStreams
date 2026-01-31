import { Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  encryptString,
  UserRepository,
  FeatureControl,
  Env,
  UserData,
} from '@aiostreams/core';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';
import { resolveUuidAliasForUserApi } from '../../middlewares/alias.js';
import { createResponse } from '../../utils/responses.js';
const router: Router = Router();

const logger = createLogger('server');

router.use(userApiRateLimiter);
router.use(resolveUuidAliasForUserApi);

const validateSyncedUrls = (config: UserData, uuid?: string) => {
  const isUnrestricted =
    (uuid && Env.TRUSTED_UUIDS?.split(',').includes(uuid)) ||
    Env.REGEX_FILTER_ACCESS === 'all';

  if (isUnrestricted) return;

  const allowedUrls = Env.ALLOWED_REGEX_PATTERNS_URLS || [];
  const urlsToCheck = [
    ...(config.syncedIncludedRegexUrls || []),
    ...(config.syncedExcludedRegexUrls || []),
    ...(config.syncedRequiredRegexUrls || []),
    ...(config.syncedPreferredRegexUrls || []),
  ];

  const invalidUrls = urlsToCheck.filter((url) => !allowedUrls.includes(url));

  if (invalidUrls.length > 0) {
    throw new APIError(
      constants.ErrorCode.USER_INVALID_CONFIG,
      undefined,
      `Forbidden URL(s) in regex configuration: ${invalidUrls.join(', ')}`
    );
  }
};

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
  const { uuid, password } = {
    uuid: req.uuid || req.query.uuid,
    password: req.query.password,
  };
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
    userData = await UserRepository.getUser(uuid, password);
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
    validateSyncedUrls(config);

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
    validateSyncedUrls(config, uuid);
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
export default router;
