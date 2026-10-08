import { Router, Request, Response, NextFunction } from 'express';
import { CauldronAddon, createLogger, fromUrlSafeBase64 } from '@aiostreams/core';

const router: Router = Router();
const logger = createLogger('server');

interface CauldronManifestParams {
  encodedConfig?: string;
}

router.get(
  '/:encodedConfig/manifest.json',
  async (
    req: Request<CauldronManifestParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { encodedConfig } = req.params;

    try {
      const config = encodedConfig
        ? JSON.parse(fromUrlSafeBase64(encodedConfig))
        : undefined;
      const manifest = config
        ? new CauldronAddon(config, req.userIp).getManifest()
        : CauldronAddon.getManifest();
      res.json(manifest);
    } catch (error) {
      logger.error(`Failed to render Cauldron manifest: ${error}`);
      next(error);
    }
  }
);

interface CauldronStreamParams {
  encodedConfig?: string;
  type: string;
  id: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (
    req: Request<CauldronStreamParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { encodedConfig, type, id } = req.params;

    try {
      const config = encodedConfig
        ? JSON.parse(fromUrlSafeBase64(encodedConfig))
        : undefined;
      const addon = new CauldronAddon(config, req.userIp);
      const streams = await addon.getStreams(type, id);
      res.json({ streams });
    } catch (error) {
      logger.error(`Failed to resolve Cauldron streams for ${type}/${id}: ${error}`);
      next(error);
    }
  }
);

export default router;
