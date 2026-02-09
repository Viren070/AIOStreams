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
  RegexAccess,
  SelAccess,
} from '@aiostreams/core';

const logger = createLogger('server');

// Valid resources that require authentication
const VALID_RESOURCES = [
  ...constants.RESOURCES,
  'manifest.json',
  'configure',
  'manifest',
  'streams',
];

export const userDataMiddleware = async (
  req: Request,
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
  const resourceRegex = new RegExp(`/(${VALID_RESOURCES.join('|')})`);

  const resourceMatch = req.path.match(resourceRegex);
  if (!resourceMatch) {
    next();
    return;
  }

  // Second check - validate UUID format (simpler regex that just checks UUID format)
  let uuid: string | undefined;
  const uuidRegex =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!uuidRegex.test(uuidOrAlias)) {
    const alias = Env.ALIASED_CONFIGURATIONS.get(uuidOrAlias);
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
      // Sync regex patterns from URLs
      try {
        userData.preferredRegexPatterns = await RegexAccess.syncRegexPatterns(
          userData.syncedPreferredRegexUrls,
          userData.preferredRegexPatterns || [],
          userData,
          (regex) => regex,
          (regex) => regex.pattern
        );
      } catch (error: any) {
        logger.warn(
          `Failed to sync preferred regex patterns: ${error.message}`
        );
      }

      try {
        userData.excludedRegexPatterns = await RegexAccess.syncRegexPatterns(
          userData.syncedExcludedRegexUrls,
          userData.excludedRegexPatterns || [],
          userData,
          (regex) => regex.pattern,
          (pattern) => pattern
        );
      } catch (error: any) {
        logger.warn(`Failed to sync excluded regex patterns: ${error.message}`);
      }

      try {
        userData.requiredRegexPatterns = await RegexAccess.syncRegexPatterns(
          userData.syncedRequiredRegexUrls,
          userData.requiredRegexPatterns || [],
          userData,
          (regex) => regex.pattern,
          (pattern) => pattern
        );
      } catch (error: any) {
        logger.warn(`Failed to sync required regex patterns: ${error.message}`);
      }

      try {
        userData.includedRegexPatterns = await RegexAccess.syncRegexPatterns(
          userData.syncedIncludedRegexUrls,
          userData.includedRegexPatterns || [],
          userData,
          (regex) => regex.pattern,
          (pattern) => pattern
        );
      } catch (error: any) {
        logger.warn(`Failed to sync included regex patterns: ${error.message}`);
      }

      try {
        userData.rankedRegexPatterns = await RegexAccess.syncRegexPatterns(
          userData.syncedRankedRegexUrls,
          userData.rankedRegexPatterns || [],
          userData,
          (regex) => ({
            pattern: regex.pattern,
            name: regex.name,
            score: regex.score || 0,
          }),
          (item) => item.pattern
        );
      } catch (error: any) {
        logger.warn(`Failed to sync ranked regex patterns: ${error.message}`);
      }

      // Sync stream expressions from URLs (don't throw on failure)
      try {
        userData.preferredStreamExpressions =
          await SelAccess.syncStreamExpressions(
            userData.syncedPreferredStreamExpressionUrls,
            userData.preferredStreamExpressions || [],
            userData,
            (item) => item.expression,
            (expr) => expr
          );
      } catch (error: any) {
        logger.warn(
          `Failed to sync preferred stream expressions: ${error.message}`
        );
      }

      try {
        userData.excludedStreamExpressions =
          await SelAccess.syncStreamExpressions(
            userData.syncedExcludedStreamExpressionUrls,
            userData.excludedStreamExpressions || [],
            userData,
            (item) => item.expression,
            (expr) => expr
          );
      } catch (error: any) {
        logger.warn(
          `Failed to sync excluded stream expressions: ${error.message}`
        );
      }

      try {
        userData.requiredStreamExpressions =
          await SelAccess.syncStreamExpressions(
            userData.syncedRequiredStreamExpressionUrls,
            userData.requiredStreamExpressions || [],
            userData,
            (item) => item.expression,
            (expr) => expr
          );
      } catch (error: any) {
        logger.warn(
          `Failed to sync required stream expressions: ${error.message}`
        );
      }

      try {
        userData.includedStreamExpressions =
          await SelAccess.syncStreamExpressions(
            userData.syncedIncludedStreamExpressionUrls,
            userData.includedStreamExpressions || [],
            userData,
            (item) => item.expression,
            (expr) => expr
          );
      } catch (error: any) {
        logger.warn(
          `Failed to sync included stream expressions: ${error.message}`
        );
      }

      try {
        userData.rankedStreamExpressions =
          await SelAccess.syncStreamExpressions(
            userData.syncedRankedStreamExpressionUrls,
            userData.rankedStreamExpressions || [],
            userData,
            (item) => ({
              expression: item.expression,
              score: item.score || 0,
              enabled: item.enabled ?? true,
            }),
            (item) => item.expression
          );
      } catch (error: any) {
        logger.warn(
          `Failed to sync ranked stream expressions: ${error.message}`
        );
      }

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
