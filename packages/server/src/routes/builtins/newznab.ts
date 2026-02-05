import { Router, Request, Response, NextFunction } from 'express';
import {
  NewznabAddon,
  createLogger,
  fromUrlSafeBase64,
  APIError,
  constants,
} from '@aiostreams/core';
const router: Router = Router();

const logger = createLogger('server');

interface NewznabManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request<NewznabManifestParams>, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;

    try {
      const manifest = new NewznabAddon(
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

interface NewznabStreamParams {
  encodedConfig?: string; // optional
  type?: string;
  id?: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<NewznabStreamParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    if (!type || !id) {
      throw new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'Type and id are required'
      );
    }

    try {
      const addon = new NewznabAddon(
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
