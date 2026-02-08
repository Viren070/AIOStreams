import { Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  RegexAccess,
  SelAccess,
  UserRepository,
} from '@aiostreams/core';
import { z } from 'zod';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('server');

const ResolveSyncedSchema = z.object({
  regexUrls: z.array(z.string().url()).max(10).optional(),
  selUrls: z.array(z.string().url()).max(10).optional(),
  uuid: z.string().optional(),
  password: z.string().optional(),
});

router.post('/resolve', async (req, res, next) => {
  const parsed = ResolveSyncedSchema.safeParse(req.body);
  if (!parsed.success) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'regexUrls and selUrls must be arrays of valid URLs (max 10 each)'
      )
    );
    return;
  }

  const { regexUrls, selUrls, uuid, password } = parsed.data;

  if (!regexUrls?.length && !selUrls?.length) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'At least one of regexUrls or selUrls must be provided'
      )
    );
    return;
  }

  try {
    const userData =
      (uuid && password
        ? await UserRepository.getUser(uuid, password)
        : undefined) ?? undefined;

    const [regexResults, selResults] = await Promise.all([
      regexUrls?.length
        ? RegexAccess.resolvePatternsWithErrors(regexUrls, userData)
        : Promise.resolve(undefined),
      selUrls?.length
        ? SelAccess.resolveExpressionsWithErrors(selUrls, userData)
        : Promise.resolve(undefined),
    ]);

    // Flatten successful items
    const patterns = regexResults?.flatMap((r) => r.items);
    const expressions = selResults?.flatMap((r) => r.items);

    // Collect per-URL errors
    const errors: { url: string; error: string }[] = [];
    if (regexResults) {
      for (const r of regexResults) {
        if (r.error) errors.push({ url: r.url, error: r.error });
      }
    }
    if (selResults) {
      for (const r of selResults) {
        if (r.error) errors.push({ url: r.url, error: r.error });
      }
    }

    res.status(200).json(
      createResponse({
        success: true,
        detail:
          errors.length > 0
            ? `Resolved with ${errors.length} error(s)`
            : 'Synced items resolved successfully',
        data: {
          ...(patterns !== undefined && { patterns }),
          ...(expressions !== undefined && { expressions }),
          ...(errors.length > 0 && { errors }),
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

export default router;
