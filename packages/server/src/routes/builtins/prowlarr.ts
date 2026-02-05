import { Router, Request, Response, NextFunction } from 'express';
import { ProwlarrAddon, fromUrlSafeBase64, createLogger, APIError, constants } from '@aiostreams/core';
const router: Router = Router();

const logger = createLogger('server');

interface ProwlarrManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request<ProwlarrManifestParams>, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;

    try {
      const manifest = new ProwlarrAddon(
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

interface ProwlarrStreamParams {
  encodedConfig?: string; // optional
  type?: string;
  id?: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<ProwlarrStreamParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    if (!type || !id) {
      throw new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'Type and id are required'
      );
    }

    try {
      const addon = new ProwlarrAddon(
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
