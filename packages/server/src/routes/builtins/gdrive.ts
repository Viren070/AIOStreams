import { Router, Request, Response, NextFunction } from 'express';
import { createLogger, fromUrlSafeBase64, GDriveAddon, APIError, constants } from '@aiostreams/core';
const router: Router = Router();

const logger = createLogger('server');

interface GDriveManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '{/:encodedConfig}/manifest.json',
  async (req: Request<GDriveManifestParams>, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;
    const config = encodedConfig
      ? JSON.parse(fromUrlSafeBase64(encodedConfig))
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

interface GDriveMetaParams {
  encodedConfig: string;
  type: string;
  id: string;
}

router.get(
  '/:encodedConfig/meta/:type/:id.json',
  async (req: Request<GDriveMetaParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    const config = JSON.parse(fromUrlSafeBase64(encodedConfig));

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

interface GDriveCatalogParams {
  encodedConfig: string;
  type: string;
  id: string;
  extras?: string; // optional
}

router.get(
  '/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<GDriveCatalogParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id, extras } = req.params;
    const config = JSON.parse(fromUrlSafeBase64(encodedConfig));

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

interface GDriveStreamParams {
  encodedConfig: string;
  type: string;
  id: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<GDriveStreamParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    const config = JSON.parse(fromUrlSafeBase64(encodedConfig));

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
