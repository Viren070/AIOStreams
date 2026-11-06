import { Router, Request, Response, NextFunction } from 'express';
import {
  createLogger,
  fetchJackettIndexers,
  resolveJackettCredentials,
} from '@aiostreams/core';
import { z } from 'zod';
import { createResponse } from '../../utils/responses.js';
import { requireSessionIfAuthRequired } from '../../middlewares/auth.js';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';

const router: Router = Router();

const logger = createLogger('server');

const IndexersRequestSchema = z.object({
  url: z.string().optional(),
  apiKey: z.string().optional(),
});

/**
 * Lists a Jackett instance's indexers for the config UI. Without a url, the
 * preconfigured instance, whose credentials stay on the server. Browser
 * reachable, so whitelisted out of `internalMiddleware` and gated here.
 */
router.post(
  '/indexers',
  requireSessionIfAuthRequired,
  userApiRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = IndexersRequestSchema.parse(req.body ?? {});
      const credentials = resolveJackettCredentials(body);
      if (!credentials) {
        res.status(400).json(
          createResponse({
            success: false,
            detail: 'A Jackett URL and API key are required',
          })
        );
        return;
      }

      try {
        const indexers = await fetchJackettIndexers(credentials);
        res.json(createResponse({ success: true, data: { indexers } }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not reach Jackett';
        logger.debug({ error: message }, 'listing jackett indexers failed');
        res.status(502).json(
          createResponse({
            success: false,
            detail: `Could not list Jackett indexers: ${message}`,
          })
        );
      }
    } catch (error) {
      next(error);
    }
  }
);

export default router;
