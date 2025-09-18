import { Router, Request, Response, NextFunction } from 'express';
import { createLogger, GDriveAddon } from '@aiostreams/core';
const router: Router = Router();

const logger = createLogger('server');

router.get(
  '{/:encodedConfig}/manifest.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;
    const config = encodedConfig
      ? JSON.parse(Buffer.from(encodedConfig, 'base64').toString('utf-8'))
      : undefined;

    try {
      const manifest = config
        ? new GDriveAddon(config).getManifest()
        : GDriveAddon.getManifest();
      res.json(manifest);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/meta/:type/:id.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    const config = JSON.parse(
      Buffer.from(encodedConfig, 'base64').toString('utf-8')
    );

    try {
      const addon = new GDriveAddon(config);
      const meta = await addon.getMeta(type, id);
      res.json({
        meta: meta,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id, extras } = req.params;
    const config = JSON.parse(
      Buffer.from(encodedConfig, 'base64').toString('utf-8')
    );

    try {
      const addon = new GDriveAddon(config);
      const catalog = await addon.getCatalog(type, id, extras);
      res.json({
        metas: catalog,
      });
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
      const addon = new GDriveAddon(config);
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
