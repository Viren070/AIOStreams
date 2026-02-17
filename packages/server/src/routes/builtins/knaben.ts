import { Router, Request, Response, NextFunction } from 'express';
import { KnabenAddon, fromUrlSafeBase64, createLogger, APIError, constants } from '@aiostreams/core';
const router: Router = Router();

const logger = createLogger('server');

interface KnabenManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request<KnabenManifestParams>, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;
    try {
      const manifest = new KnabenAddon(
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

interface KnabenStreamParams {
  encodedConfig?: string; // optional
  type: string;
  id: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<KnabenStreamParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;

    try {
      const addon = new KnabenAddon(
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
