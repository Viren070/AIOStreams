import { Request, Response, NextFunction } from 'express';
import { testXtreamLogin, XtreamAddon, XtreamError } from '@aiostreams/core';
import { z } from 'zod';
import { createResponse } from '../../utils/responses.js';
import { requireSessionIfAuthRequired } from '../../middlewares/auth.js';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';
import { liveTvRouter } from './livetv.js';

const router = liveTvRouter((config) => new XtreamAddon(config), XtreamError);

const LoginSchema = z.object({
  server: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

/** `POST /test` for the configure page, which a browser reaches past `internalMiddleware`. */
router.post(
  '/test',
  requireSessionIfAuthRequired,
  userApiRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    const login = LoginSchema.safeParse(req.body ?? {});
    if (!login.success) {
      res.status(400).json(
        createResponse({
          success: false,
          detail: 'The server, username and password are all needed to test',
        })
      );
      return;
    }
    try {
      res.json(
        createResponse({
          success: true,
          data: await testXtreamLogin(login.data),
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

export default router;
