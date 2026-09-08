import { Router } from 'express';
import {
  APIError,
  AnalyticsRepository,
  config as appConfig,
  ConfigSessionRepository,
  constants,
  createLogger,
  encryptString,
  getConfigAccessKey,
  hmac,
  Permission,
  sessionHasPermission,
  UserRepository,
  evaluateVariantConditions,
  formatZodError,
  getClientAgents,
  getHealth,
  HealthCheckSchema,
  resolveHealthDetails,
  validateConditionalActivation,
  validateHealthCheck,
  VariantSchema,
  type UserAnalyticsRange,
} from '@aiostreams/core';
import { z, ZodError } from 'zod';
import {
  loginRateLimiter,
  userApiRateLimiter,
  userCreateRateLimiter,
} from '../../middlewares/ratelimit.js';
import {
  attachSession,
  clearConfigSessionCookie,
  injectAccessKey,
  readConfigSessionToken,
  setConfigSessionCookie,
} from '../../middlewares/auth.js';
import { resolveUuidAliasForUserApi } from '../../middlewares/alias.js';
import { createResponse } from '../../utils/responses.js';
import {
  parseBasicAuthHeader,
  resolveConfigCredentials,
} from '../../utils/basic-auth.js';
const router: Router = Router();

const logger = createLogger('server');

const VariantEvaluateRequestSchema = z.object({
  variants: z.array(VariantSchema).optional(),
  healthChecks: z.array(HealthCheckSchema).optional(),
  userAgent: z.string().max(512).optional(),
  resource: z.string().max(32).optional(),
  type: z.string().max(64).optional(),
  id: z.string().max(256).optional(),
  query: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

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
    creds = await resolveConfigCredentials(req, res, { allowEncrypted: false });
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
router.post('/', userCreateRateLimiter, async (req, res, next) => {
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
  // Only meaningful while the config-write gate is active; with it off, config
  // creation is public and there is no session to check.
  if (
    getConfigAccessKey() &&
    req.user &&
    !sessionHasPermission(req.user, Permission.CreateConfig)
  ) {
    next(
      new APIError(
        constants.ErrorCode.FORBIDDEN,
        undefined,
        'Your account is not allowed to create configurations'
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
    creds = await resolveConfigCredentials(req, res, { allowEncrypted: false });
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

// Takes the password itself, never a session, so a stolen cookie cannot mint more.
router.post('/session', loginRateLimiter, async (req, res, next) => {
  if (!ConfigSessionRepository.enabled()) {
    next(
      new APIError(
        constants.ErrorCode.FORBIDDEN,
        undefined,
        'Remembered sign-ins are disabled on this instance'
      )
    );
    return;
  }

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
  const remember = req.body?.remember === true;

  try {
    await UserRepository.verifyUser(uuid, creds.password);

    const previous = readConfigSessionToken(req);
    if (previous) await ConfigSessionRepository.deleteByToken(previous);

    const session = await ConfigSessionRepository.create(
      uuid,
      creds.password,
      remember
    );
    setConfigSessionCookie(
      req,
      res,
      session.token,
      remember,
      session.expiresAt
    );

    res.status(200).json(
      createResponse({
        success: true,
        detail: 'Session created successfully',
        data: {
          uuid,
          remembered: session.remembered,
          expiresAt: session.expiresAt,
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

// end this browser's remembered sign-in
router.delete('/session', async (req, res, next) => {
  try {
    const token = readConfigSessionToken(req);
    if (token) await ConfigSessionRepository.deleteByToken(token);
    clearConfigSessionCookie(res);
    res.status(204).send();
  } catch (error) {
    logger.error(error);
    next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
  }
});

// end every remembered sign-in for this configuration
router.delete('/sessions', async (req, res, next) => {
  let creds;
  try {
    creds = await resolveConfigCredentials(req, res, { allowEncrypted: false });
  } catch (error) {
    next(error);
    return;
  }
  if (!creds) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'Authorization header (Basic) or a session is required'
      )
    );
    return;
  }

  try {
    const count = await ConfigSessionRepository.deleteAllForUuid(
      req.uuid || creds.uuid
    );
    clearConfigSessionCookie(res);
    res.status(200).json(
      createResponse({
        success: true,
        detail: 'Signed out on all devices',
        data: { count },
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
    creds = await resolveConfigCredentials(req, res, { allowEncrypted: false });
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

/** The user agents seen on this configuration's stream and catalogue requests. */
router.get('/client-agents', async (req, res, next) => {
  let creds;
  try {
    creds = await resolveConfigCredentials(req, res, { allowEncrypted: false });
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

  try {
    await UserRepository.verifyUser(uuid, creds.password);
    const agents = await getClientAgents(uuid);
    res.status(200).json(createResponse({ success: true, data: agents }));
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
      return;
    }
    logger.error(error);
    next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
  }
});

/**
 * Why a variant did or did not activate for a given request. Takes the draft
 * variants and health checks from the body so the editor can try unsaved edits.
 */
router.post('/variants/evaluate', async (req, res, next) => {
  let creds;
  try {
    creds = await resolveConfigCredentials(req, res, { allowEncrypted: false });
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

  try {
    const body = VariantEvaluateRequestSchema.parse(req.body ?? {});
    const userData = await UserRepository.getUser(uuid, creds.password);
    if (!userData) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }
    if (body.variants) userData.variants = body.variants;
    if (body.healthChecks) userData.healthChecks = body.healthChecks;

    try {
      await validateConditionalActivation(userData);
    } catch (error: any) {
      throw new APIError(
        constants.ErrorCode.USER_INVALID_CONFIG,
        400,
        error?.message ?? String(error)
      );
    }

    const health = await resolveHealthDetails(userData);
    userData.healthResults = Object.fromEntries(
      Object.entries(health).map(([id, result]) => [id, result.ok])
    );

    const userAgent = body.userAgent ?? '';
    const activation = await evaluateVariantConditions(userData, {
      resource: body.resource ?? 'stream',
      type: body.type,
      id: body.id,
      userAgent,
      query: body.query ?? {},
      headers: { ...(body.headers ?? {}), 'user-agent': userAgent },
    });

    res.status(200).json(
      createResponse({
        success: true,
        data: { variants: activation.outcomes, health },
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      next(
        new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          formatZodError(error)
        )
      );
      return;
    }
    if (error instanceof APIError) {
      next(error);
      return;
    }
    logger.error(error);
    next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
  }
});

/** Runs one health check now, ignoring the cache, so the editor can show it. */
router.post('/health-checks/test', async (req, res, next) => {
  let creds;
  try {
    creds = await resolveConfigCredentials(req, res, { allowEncrypted: false });
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

  try {
    const check = HealthCheckSchema.parse(req.body ?? {});
    const userData = await UserRepository.getUser(uuid, creds.password);
    if (!userData) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }

    // The same gate a save goes through, so a test cannot reach further than
    // the check would once stored.
    try {
      await validateHealthCheck(userData, check);
    } catch (error: any) {
      throw new APIError(
        constants.ErrorCode.USER_INVALID_CONFIG,
        400,
        error?.message ?? String(error)
      );
    }

    const result = await getHealth(check, { bypassCache: true });
    res.status(200).json(createResponse({ success: true, data: result }));
  } catch (error) {
    if (error instanceof ZodError) {
      next(
        new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          formatZodError(error)
        )
      );
      return;
    }
    if (error instanceof APIError) {
      next(error);
      return;
    }
    logger.error(error);
    next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
  }
});

export default router;
