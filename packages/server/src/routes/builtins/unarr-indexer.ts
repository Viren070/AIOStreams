import { Router, Request, Response, NextFunction } from 'express';
import { decryptString, UnarrIndexerAddon } from '@aiostreams/core';

const router: Router = Router();

function config(encodedConfig: string): unknown {
  const decrypted = decryptString(encodedConfig);
  if (!decrypted.success || !decrypted.data) {
    throw new Error('Invalid encrypted Unarr configuration');
  }
  return JSON.parse(decrypted.data);
}

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
