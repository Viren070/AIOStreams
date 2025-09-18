import { Router, Request, Response, NextFunction } from 'express';
import {
  createLogger,
  TorBoxSearchAddon,
  TorBoxSearchAddonError,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';
const router: Router = Router();

const logger = createLogger('builtins:torbox-search');

router.get(
  '{/:encodedConfig}/manifest.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;

    const config = encodedConfig
      ? JSON.parse(Buffer.from(encodedConfig, 'base64').toString('utf-8'))
      : undefined;

    try {
      const manifest = config
        ? new TorBoxSearchAddon(config, req.userIp).getManifest()
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

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    const config = JSON.parse(
      Buffer.from(encodedConfig, 'base64').toString('utf-8')
    );

    try {
      const addon = new TorBoxSearchAddon(config, req.userIp);
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
