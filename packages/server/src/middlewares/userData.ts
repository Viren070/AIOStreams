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
  FeatureControl,
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
      try {
        // Sync regex patterns from URLs
        const syncPatterns = async (
          urls: string[] | undefined,
          existing: string[],
        ): Promise<string[]> => {
          if (!urls?.length) return existing;
          const result = [...existing];
          const existingSet = new Set(existing);

          const allowedUrls = Env.ALLOWED_REGEX_PATTERNS_URLS || [];
          const isUnrestricted =
            userData?.trusted ||
            Env.REGEX_FILTER_ACCESS === 'all';

          const validUrls = urls.filter(
            (url) => isUnrestricted || allowedUrls.includes(url)
          );

          const allPatterns = await Promise.all(
            validUrls.map((url) => FeatureControl.getPatternsForUrl(url))
          );

          for (const patterns of allPatterns) {
            for (const { pattern } of patterns) {
              if (!existingSet.has(pattern)) {
                result.push(pattern);
                existingSet.add(pattern);
              }
            }
          }
          return result;
        };

        const syncPatternsWithNames = async (
          urls: string[] | undefined,
          existing: { name: string; pattern: string }[]
        ): Promise<{ name: string; pattern: string }[]> => {
          if (!urls?.length) return existing;
          const result = [...existing];
          const existingSet = new Set(existing.map((p) => p.pattern));

          const allowedUrls = Env.ALLOWED_REGEX_PATTERNS_URLS || [];
          const isUnrestricted =
            userData?.trusted ||
            Env.REGEX_FILTER_ACCESS === 'all';

          const validUrls = urls.filter(
            (url) => isUnrestricted || allowedUrls.includes(url)
          );

          const allPatterns = await Promise.all(
            validUrls.map((url) => FeatureControl.getPatternsForUrl(url))
          );

          for (const patterns of allPatterns) {
            for (const { name, pattern } of patterns) {
              if (!existingSet.has(pattern)) {
                result.push({ name, pattern });
                existingSet.add(pattern);
              }
            }
          }
          return result;
        };

        userData.preferredRegexPatterns = await syncPatternsWithNames(
          userData.syncedPreferredRegexUrls,
          userData.preferredRegexPatterns || []
        );
        userData.excludedRegexPatterns = await syncPatterns(
          userData.syncedExcludedRegexUrls,
          userData.excludedRegexPatterns || []
        );
        userData.requiredRegexPatterns = await syncPatterns(
          userData.syncedRequiredRegexUrls,
          userData.requiredRegexPatterns || []
        );
        userData.includedRegexPatterns = await syncPatterns(
          userData.syncedIncludedRegexUrls,
          userData.includedRegexPatterns || []
        );

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
