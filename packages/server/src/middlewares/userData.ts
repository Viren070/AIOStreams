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
  Env,
  isConfigUuid,
  resolveConfigAlias,
  activateVariants,
  recordClientAgent,
  resolveVariantSelector,
  logVariantNotes,
  VARIANT_QUERY_PARAM,
  VARIANT_PATH_PARAM,
} from '@aiostreams/core';
import { syncUserDataUrls } from '../utils/syncUserData.js';
import { buildVariantRequestContext } from '../utils/variant-context.js';

const logger = createLogger('server');

// Valid resources that require authentication
const VALID_RESOURCES = [
  ...constants.RESOURCES,
  'manifest.json',
  'configure',
  'manifest',
  'streams',
];

const RESOURCE_REGEX = new RegExp(`/(${VALID_RESOURCES.join('|')})`);

interface UserDataParams {
  uuid?: string;
  encryptedPassword?: string;
  // match Express.Request<ParamsDictionary> to keep middleware flexible
  [key: string]: string | string[] | undefined;
}

export const userDataMiddleware = async (
  req: Request<UserDataParams>,
  res: Response,
  next: NextFunction
) => {
  const { uuid: uuidOrAlias, encryptedPassword } = req.params;

  // Both uuid and encryptedPassword should be present since we mounted the router on this path
  if (!uuidOrAlias || !encryptedPassword) {
    next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
    return;
  }
  // First check - validate path has two components followed by valid resource
  const resourceMatch = req.path.match(RESOURCE_REGEX);
  if (!resourceMatch) {
    next();
    return;
  }

  // Second check - validate UUID format (simpler regex that just checks UUID format)
  let uuid: string | undefined;
  if (!isConfigUuid(uuidOrAlias)) {
    const alias = await resolveConfigAlias(uuidOrAlias);
    if (alias) {
      uuid = alias.uuid;
    } else {
      next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
      return;
    }
  } else {
    uuid = uuidOrAlias;
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
      decryptString(encryptedPassword);
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
      // Before syncUserDataUrls, since a variant may add a synced URL, and
      // before validateConfig, which is what makes the patch safe.
      try {
        const { ids: selected, location } = resolveVariantSelector(
          req.params[VARIANT_PATH_PARAM],
          req.query[VARIANT_QUERY_PARAM]
        );
        const context = buildVariantRequestContext(req, resource);
        void recordClientAgent(uuid, context.userAgent, resource);
        const result = await activateVariants(userData, selected, context);
        userData = result.userData;
        if (selected.length) {
          userData.variantSelectorLocation = location;
        }
        if (result.applied.length) {
          // Per request, so it is visible whether a client carries the
          // selector beyond the manifest.
          logger.info(
            {
              uuid,
              resource,
              variants: userData.activeVariants,
              auto: result.auto,
              location: selected.length ? location : undefined,
            },
            'serving request with config variants'
          );
          logVariantNotes(uuid, result);
        }
      } catch (error: any) {
        if (constants.RESOURCES.includes(resource as Resource)) {
          res.status(200).json(
            StremioTransformer.createDynamicError(resource as Resource, {
              errorDescription: error.message,
            })
          );
          return;
        }
        logger.warn(`Invalid variant selection for ${uuid}: ${error.message}`);
        next(
          new APIError(
            constants.ErrorCode.USER_INVALID_CONFIG,
            undefined,
            error.message
          )
        );
        return;
      }

      userData = await syncUserDataUrls(userData);

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
