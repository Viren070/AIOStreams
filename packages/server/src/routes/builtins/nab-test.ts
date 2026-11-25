import { Router, Request, Response, NextFunction } from 'express';
import {
  testNabEndpoint,
  appConfig,
  createLogger,
  type NabNamespaceId,
} from '@aiostreams/core';
import { z } from 'zod';
import { createResponse } from '../../utils/responses.js';
import { requireSessionIfAuthRequired } from '../../middlewares/auth.js';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';

const logger = createLogger('server');

const NabTestRequestSchema = z.object({
  url: z.string().optional(),
  apiKey: z.string().optional(),
  preset: z.string().optional(),
});

/**
 * Presets that take a base url instead of a complete endpoint, because their
 * api path never varies. Everything else supplies the full endpoint itself.
 */
const PRESET_API_PATHS: Record<string, string> = {
  nzbhydra: '/api',
};

/**
 * Resolve the endpoint to probe.
 */
function resolveTarget(
  body: z.infer<typeof NabTestRequestSchema>
): { url: string; apiKey?: string } | undefined {
  const apiPath = PRESET_API_PATHS[body.preset ?? ''] ?? '';
  const withApiPath = (url: string) => url.trim().replace(/\/+$/, '') + apiPath;

  if (body.url?.trim()) {
    return { url: withApiPath(body.url), apiKey: body.apiKey };
  }
  if (body.preset === 'nzbhydra' && appConfig.builtins.nzbhydra.url) {
    return {
      url: withApiPath(appConfig.builtins.nzbhydra.url),
      apiKey: appConfig.builtins.nzbhydra.apiKey ?? undefined,
    };
  }
  return undefined;
}

/**
 * `POST <builtin>/test` for the config UI's test button. Browser reachable, so
 * it is whitelisted out of `internalMiddleware` and gated on its own instead.
 */
export function attachNabTestRoute(
  router: Router,
  namespace: NabNamespaceId
): void {
  router.post(
    '/test',
    requireSessionIfAuthRequired,
    userApiRateLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = NabTestRequestSchema.parse(req.body ?? {});
        const target = resolveTarget(body);
        if (!target) {
          res.status(400).json(
            createResponse({
              success: false,
              detail: 'A URL is required to test this endpoint',
            })
          );
          return;
        }

        const result = await testNabEndpoint({ namespace, ...target });
        logger.debug(
          { namespace, ok: result.ok },
          'completed nab endpoint test'
        );
        res.json(createResponse({ success: true, data: result }));
      } catch (error) {
        next(error);
      }
    }
  );
}
