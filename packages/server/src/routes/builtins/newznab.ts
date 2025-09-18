import { Router, Request, Response, NextFunction } from 'express';
import { NewznabAddon, createLogger } from '@aiostreams/core';
const router: Router = Router();

const logger = createLogger('server');

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;
    const config = encodedConfig
      ? JSON.parse(Buffer.from(encodedConfig, 'base64').toString('utf-8'))
      : undefined;

    try {
      const manifest = new NewznabAddon(config, req.userIp).getManifest();
      res.json(manifest);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    const config = JSON.parse(
      Buffer.from(encodedConfig, 'base64').toString('utf-8')
    );

    try {
      const addon = new NewznabAddon(config, req.userIp);
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
