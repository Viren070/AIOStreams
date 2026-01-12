import { Router, Request, Response, NextFunction } from 'express';
import { SeaDexAddon, fromUrlSafeBase64 } from '@aiostreams/core';
import { createLogger } from '@aiostreams/core';
const router: Router = Router();

const logger = createLogger('server');

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;
    try {
      const manifest = new SeaDexAddon(
        encodedConfig
          ? JSON.parse(fromUrlSafeBase64(encodedConfig))
          : undefined,
        req.userIp
      ).getManifest();
      res.json(manifest);
    } catch (error) {
      logger.error('Failed to get manifest:', error);
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    try {
      const streams = await new SeaDexAddon(
        encodedConfig
          ? JSON.parse(fromUrlSafeBase64(encodedConfig))
          : undefined,
        req.userIp
      ).getStreams(type, id);
      res.json({ streams });
    } catch (error) {
      logger.error('Failed to get streams:', error);
      next(error);
    }
  }
);

export default router;
