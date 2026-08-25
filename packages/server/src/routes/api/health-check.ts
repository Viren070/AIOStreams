import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createResponse } from '../../utils/responses.js';
import {
  APIError,
  constants,
  createLogger,
  probeVerdict,
  probeNntpVerdict,
} from '@aiostreams/core';
import { healthCheckApiRateLimiter } from '../../middlewares/ratelimit.js';

const router: Router = Router();
const logger = createLogger('server');

router.use(healthCheckApiRateLimiter);

const UrlTest = z.object({ url: z.string().url() });
const NntpTest = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  ssl: z.boolean(),
});

router.post(
  '/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const nntp = NntpTest.safeParse(req.body);
      if (nntp.success) {
        const verdict = await probeNntpVerdict(
          nntp.data.host,
          nntp.data.port,
          nntp.data.ssl
        );
        res.status(200).json(createResponse({ success: true, data: verdict }));
        return;
      }

      const url = UrlTest.safeParse(req.body);
      if (!url.success) {
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Provide either a health check URL, or a host, port and ssl flag.'
        );
      }

      // The same call the gate makes, so the answer here is the answer there. A
      // private or unresolvable address comes back as its own verdict rather than
      // an error, because it is a thing to tell the user rather than a fault.
      const verdict = await probeVerdict(url.data.url);
      res.status(200).json(createResponse({ success: true, data: verdict }));
    } catch (error: any) {
      if (error instanceof APIError) {
        next(error);
        return;
      }
      logger.error(`Health check test failed: ${error.message}`);
      next(
        new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR, error.message)
      );
    }
  }
);

export default router;
