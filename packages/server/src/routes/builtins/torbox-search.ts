import { Router, Request, Response, NextFunction } from 'express';
import {
  createLogger,
  TorBoxSearchAddon,
  TorBoxSearchAddonError,
  fromUrlSafeBase64,
  APIError,
  constants,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';
const router: Router = Router();

const logger = createLogger('builtins:torbox-search');

interface TorboxManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '{/:encodedConfig}/manifest.json',
  async (req: Request<TorboxManifestParams>, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;
    try {
      const manifest = encodedConfig
        ? new TorBoxSearchAddon(
            encodedConfig
              ? JSON.parse(fromUrlSafeBase64(encodedConfig))
              : undefined,
            req.userIp
          ).getManifest()
        : TorBoxSearchAddon.getManifest();
      res.json(manifest);
    } catch (error) {
      if (error instanceof TorBoxSearchAddonError) {
        res.status(error.statusCode).json(
          createResponse({
            success: false,
            error: {
              code: error.errorCode,
              message: error.message,
            },
          })
        );
      } else {
        next(error);
      }
    }
  }
);

interface TorboxStreamParams {
  encodedConfig?: string; // optional
  type?: string;
  id?: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<TorboxStreamParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    if (!type || !id) {
      throw new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'Type and id are required'
      );
    }

    try {
      const addon = new TorBoxSearchAddon(
        encodedConfig
          ? JSON.parse(fromUrlSafeBase64(encodedConfig))
          : undefined,
        req.userIp
      );
      const streams = await addon.getStreams(type as any, id);
      res.json({
        streams: streams,
      });
    } catch (error) {
      if (error instanceof TorBoxSearchAddonError) {
        res.status(error.statusCode).json(
          createResponse({
            success: false,
            error: {
              code: error.errorCode,
              message: error.message,
            },
          })
        );
      } else {
        logger.error(
          `Unexpected error: ${error instanceof Error ? error.message : error}`
        );
        next(error);
      }
    }
  }
);

export default router;
