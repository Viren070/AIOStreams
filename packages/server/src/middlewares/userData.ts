import { Request, Response, NextFunction } from 'express';
import {
  createLogger,
  APIError,
  constants,
  decryptString,
  validateConfig,
  Resource,
  StremioTransformer,
  UserRepository,
} from '@aiostreams/core';

const logger = createLogger('server');

// Valid resources that require authentication
// const VALID_RESOURCES = ['stream', 'configure'];
const VALID_RESOURCES = [...constants.RESOURCES, 'manifest.json', 'configure'];

export const userDataMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { uuid, encryptedPassword } = req.params;

  // Both uuid and encryptedPassword should be present since we mounted the router on this path
  if (!uuid || !encryptedPassword) {
    next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
    return;
  }
  // First check - validate path has two components followed by valid resource
  const resourceRegex = new RegExp(`/(${VALID_RESOURCES.join('|')})`);

  const resourceMatch = req.path.match(resourceRegex);
  if (!resourceMatch) {
    next();
    return;
  }

  // Second check - validate UUID format (simpler regex that just checks UUID format)
  const uuidRegex =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
    return;
  }

  const resource = resourceMatch[1];

  try {
    // Check if user exists
    const userExists = await UserRepository.checkUserExists(uuid);
    if (!userExists) {
      if (constants.RESOURCES.includes(resource as Resource)) {
        res.status(200).json(
          StremioTransformer.createDynamicError(resource as Resource, {
            errorDescription: 'User not found',
          })
        );
        return;
      }
      next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
      return;
    }

    let password = undefined;

    // decrypt the encrypted password
    const { success: successfulDecryption, data: decryptedPassword } =
      decryptString(encryptedPassword!);
    if (!successfulDecryption) {
      if (constants.RESOURCES.includes(resource as Resource)) {
        res.status(200).json(
          StremioTransformer.createDynamicError(resource as Resource, {
            errorDescription: 'Invalid password',
          })
        );
        return;
      }
      next(new APIError(constants.ErrorCode.ENCRYPTION_ERROR));
      return;
    }

    // Get and validate user data
    let userData = await UserRepository.getUser(uuid, decryptedPassword);

    if (!userData) {
      if (constants.RESOURCES.includes(resource as Resource)) {
        res.status(200).json(
          StremioTransformer.createDynamicError(resource as Resource, {
            errorDescription: 'Invalid password',
          })
        );
        return;
      }
      next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
      return;
    }

    userData.encryptedPassword = encryptedPassword;
    userData.uuid = uuid;
    userData.ip = req.userIp;

    if (resource !== 'configure') {
      try {
        userData = await validateConfig(userData, {
          skipErrorsFromAddonsOrProxies: true,
          decryptValues: true,
        });
      } catch (error: any) {
        if (constants.RESOURCES.includes(resource as Resource)) {
          res.status(200).json(
            StremioTransformer.createDynamicError(resource as Resource, {
              errorDescription: error.message,
            })
          );
          return;
        }
        logger.error(`Invalid config for ${uuid}: ${error.message}`);
        next(
          new APIError(
            constants.ErrorCode.USER_INVALID_CONFIG,
            undefined,
            error.message
          )
        );
        return;
      }
    }

    // Attach validated data to request
    req.userData = userData;
    req.uuid = uuid;
    next();
  } catch (error: any) {
    logger.error(error.message);
    if (error instanceof APIError) {
      next(error);
    } else {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
};
