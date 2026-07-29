import { Router, Request, Response, NextFunction } from 'express';
import {
  connectUnarr,
  decryptString,
  UnarrConnectInputSchema,
  UnarrIndexerAddon,
} from '@aiostreams/core';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();

function config(encodedConfig: string): unknown {
  const decrypted = decryptString(encodedConfig);
  if (!decrypted.success || !decrypted.data) {
    throw new Error('Invalid encrypted Unarr configuration');
  }
  return JSON.parse(decrypted.data);
}

router.post(
  '/auth',
  userApiRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = UnarrConnectInputSchema.parse(req.body);
      const result = await connectUnarr(input);
      res.set('Cache-Control', 'no-store');
      res.set('Pragma', 'no-cache');
      res.json(createResponse({ success: true, data: result }));
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json(
          createResponse({
            success: false,
            detail: error.message,
          })
        );
        return;
      }
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/manifest.json',
  async (
    req: Request<{ encodedConfig: string }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      res.json(
        new UnarrIndexerAddon(
          config(req.params.encodedConfig) as any,
          req.userIp
        ).getManifest()
      );
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (
    req: Request<{ encodedConfig: string; type: string; id: string }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const addon = new UnarrIndexerAddon(
        config(req.params.encodedConfig) as any,
        req.userIp
      );
      res.json({
        streams: await addon.getStreams(req.params.type, req.params.id),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
