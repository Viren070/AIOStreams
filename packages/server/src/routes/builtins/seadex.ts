import { Router, Request, Response, NextFunction } from 'express';
import { SeaDexAddon, fromUrlSafeBase64, createLogger, APIError, constants } from '@aiostreams/core';
const router: Router = Router();

const logger = createLogger('server');

interface SeaDexManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request<SeaDexManifestParams>, res: Response, next: NextFunction) => {
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

interface SeaDexStreamParams {
  encodedConfig?: string; // optional
  type?: string;
  id?: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<SeaDexStreamParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    if (!type || !id) {
      throw new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'Type and id are required'
      );
    }
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
