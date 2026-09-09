import { Router } from 'express';
import { z } from 'zod';
import {
  APIError,
  config as appConfig,
  constants,
  createLogger,
  encryptString,
  PlaybackHandoffRepository,
  quickConnectAuthorize,
  quickConnectByCode,
  UserRepository,
} from '@aiostreams/core';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';
import { attachSession } from '../../middlewares/auth.js';
import { resolveConfigCredentials } from '../../utils/basic-auth.js';
import { createResponse } from '../../utils/responses.js';

const logger = createLogger('jellyfin');
const router: Router = Router();

router.use(userApiRateLimiter);
router.use(attachSession);

const codeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Quick Connect codes are six digits');

const approveBody = z.object({
  code: codeField,
  /** Which of the configuration's personas the device signs in as. */
  persona: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)
    .optional(),
});

router.get('/info', (req, res) => {
  const origin =
    appConfig.bootstrap.baseUrl?.replace(/\/$/, '') ||
    `${req.protocol}://${req.get('host')}`;
  res.json(
    createResponse({
      success: true,
      data: {
        enabled: appConfig.jellyfin.enabled === true,
        serverUrl: `${origin}/jellyfin`,
        version: appConfig.jellyfin.version,
        maxVersions: appConfig.jellyfin.maxVersions,
        resolveOnOpen: appConfig.jellyfin.resolveOnOpen,
      },
    })
  );
});

/* Binds a code shown on a TV to the configuration the caller is signed in to. */
router.post('/quickconnect/approve', async (req, res, next) => {
  try {
    if (!appConfig.jellyfin.enabled) {
      next(
        new APIError(
          constants.ErrorCode.FORBIDDEN,
          undefined,
          'Jellyfin API is disabled'
        )
      );
      return;
    }
    const parsed = approveBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      next(
        new APIError(
          constants.ErrorCode.MISSING_REQUIRED_FIELDS,
          undefined,
          parsed.error.issues[0]?.message ?? 'code is required'
        )
      );
      return;
    }
    const creds = await resolveConfigCredentials(req, res, {
      allowEncrypted: true,
    });
    if (!creds) {
      next(new APIError(constants.ErrorCode.UNAUTHORIZED));
      return;
    }
    await UserRepository.verifyUser(creds.uuid, creds.password);
    if (parsed.data.persona) {
      const config = await UserRepository.getUser(creds.uuid, creds.password);
      const known = config?.jellyfin?.personas?.some(
        (p) => p.id === parsed.data.persona
      );
      if (!known) {
        next(
          new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            'Unknown persona'
          )
        );
        return;
      }
    }
    const enc = encryptString(creds.password);
    if (!enc.success || !enc.data) {
      next(new APIError(constants.ErrorCode.ENCRYPTION_ERROR));
      return;
    }
    const entry = await quickConnectAuthorize(parsed.data.code, {
      uuid: creds.uuid,
      encryptedPassword: enc.data,
      persona: parsed.data.persona,
    });
    if (!entry) {
      res.status(404).json(
        createResponse({
          success: false,
          detail: 'Unknown, expired or already approved code',
        })
      );
      return;
    }
    logger.info(
      {
        uuid: creds.uuid,
        persona: parsed.data.persona,
        device: entry.deviceName,
        app: entry.appName,
      },
      'quick connect code approved'
    );
    res.json(
      createResponse({
        success: true,
        data: {
          approved: true,
          device: {
            name: entry.deviceName,
            app: entry.appName,
            version: entry.appVersion,
          },
        },
      })
    );
  } catch (error) {
    next(
      error instanceof APIError
        ? error
        : new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR)
    );
  }
});

const pendingQuery = z.object({ code: codeField });

/*
 * Codes are one six-digit space across every configuration, so a lookup is a
 * probe: repeated misses lock the caller out for a minute, and every kind of
 * miss answers the same.
 */
const PENDING_MISS_LIMIT = 5;
const PENDING_LOCKOUT_MS = 60_000;
const pendingMisses = new Map<string, { count: number; lockedUntil: number }>();

function pendingMiss(uuid: string): void {
  const entry = pendingMisses.get(uuid) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= PENDING_MISS_LIMIT) {
    entry.count = 0;
    entry.lockedUntil = Date.now() + PENDING_LOCKOUT_MS;
  }
  pendingMisses.set(uuid, entry);
}

/* What a code belongs to, so the approver can see it before binding it. */
router.get('/quickconnect/pending', async (req, res, next) => {
  try {
    if (!appConfig.jellyfin.enabled) {
      next(
        new APIError(
          constants.ErrorCode.FORBIDDEN,
          undefined,
          'Jellyfin API is disabled'
        )
      );
      return;
    }
    const parsed = pendingQuery.safeParse(req.query ?? {});
    if (!parsed.success) {
      next(
        new APIError(
          constants.ErrorCode.MISSING_REQUIRED_FIELDS,
          undefined,
          parsed.error.issues[0]?.message ?? 'code is required'
        )
      );
      return;
    }
    const creds = await resolveConfigCredentials(req, res, {
      allowEncrypted: true,
    });
    if (!creds) {
      next(new APIError(constants.ErrorCode.UNAUTHORIZED));
      return;
    }
    await UserRepository.verifyUser(creds.uuid, creds.password);
    const lockedUntil = pendingMisses.get(creds.uuid)?.lockedUntil ?? 0;
    if (lockedUntil > Date.now()) {
      next(new APIError(constants.ErrorCode.RATE_LIMIT_EXCEEDED));
      return;
    }
    const entry = await quickConnectByCode(parsed.data.code);
    if (!entry || entry.uuid) {
      pendingMiss(creds.uuid);
      res.status(404).json(
        createResponse({
          success: false,
          detail: 'Unknown, expired or already approved code',
        })
      );
      return;
    }
    pendingMisses.delete(creds.uuid);
    res.json(
      createResponse({
        success: true,
        data: {
          device: {
            name: entry.deviceName,
            app: entry.appName,
            version: entry.appVersion,
          },
          requestedAt: entry.dateAdded,
        },
      })
    );
  } catch (error) {
    next(
      error instanceof APIError
        ? error
        : new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR)
    );
  }
});

/* Health of the addons this configuration reports playback to. */
router.get('/playback-sinks', async (req, res, next) => {
  try {
    if (!appConfig.watchState.reportEnabled) {
      res.json(createResponse({ success: true, data: { sinks: [] } }));
      return;
    }
    const creds = await resolveConfigCredentials(req, res, {
      allowEncrypted: true,
    });
    if (!creds) {
      next(new APIError(constants.ErrorCode.UNAUTHORIZED));
      return;
    }
    await UserRepository.verifyUser(creds.uuid, creds.password);
    const sinks = await PlaybackHandoffRepository.listAllSinks(creds.uuid);
    res.json(
      createResponse({
        success: true,
        data: {
          sinks: sinks.map((sink) => ({
            addon: sink.addonName ?? sink.addonInstanceId,
            persona: sink.persona || undefined,
            status: sink.status,
            lastPushAt: sink.lastPushAt,
            lastError: sink.lastError,
          })),
        },
      })
    );
  } catch (error) {
    next(
      error instanceof APIError
        ? error
        : new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR)
    );
  }
});

export default router;
