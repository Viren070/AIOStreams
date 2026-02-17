import { Router, Request, Response, NextFunction } from 'express';
import { EztvAddon, fromUrlSafeBase64, APIError, constants } from '@aiostreams/core';

const router: Router = Router();

interface EztvManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request<EztvManifestParams>, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;
    try {
      const manifest = new EztvAddon(
        encodedConfig
          ? JSON.parse(fromUrlSafeBase64(encodedConfig))
          : undefined,
        req.userIp
      ).getManifest();
      res.json(manifest);
    } catch (error) {
      next(error);
    }
  }
);

interface EztvStreamParams {
  encodedConfig?: string; // optional
  type: string;
  id: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<EztvStreamParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;

    try {
      const addon = new EztvAddon(
        encodedConfig
          ? JSON.parse(fromUrlSafeBase64(encodedConfig))
          : undefined,
        req.userIp
      );
      const streams = await addon.getStreams(type, id);
      res.json({
        streams: streams,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
