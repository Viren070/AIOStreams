import { Router, Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  createLogger,
  formatZodError,
  DebridError,
  PlaybackInfoSchema,
  getDebridService,
  ServiceAuthSchema,
} from '@aiostreams/core';
import { ZodError } from 'zod';
import { StaticFiles } from '../../app.js';
const router: Router = Router();
const logger = createLogger('server');

// block HEAD requests
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'HEAD') {
    res.status(405).send('Method not allowed');
  } else {
    next();
  }
});

router.get(
  '/playback/:encodedStoreAuth/:encodedPlaybackInfo/:filename',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { encodedStoreAuth, encodedPlaybackInfo, filename } = req.params;
      if (!encodedStoreAuth || !encodedPlaybackInfo || !filename) {
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Store auth, playback info and filename are required'
        );
      }
      const playbackInfo = PlaybackInfoSchema.parse(
        JSON.parse(Buffer.from(encodedPlaybackInfo, 'base64').toString('utf-8'))
      );

      const storeAuth = ServiceAuthSchema.parse(
        JSON.parse(Buffer.from(encodedStoreAuth, 'base64').toString('utf-8'))
      );

      const debridInterface = getDebridService(
        storeAuth.id,
        storeAuth.credential,
        req.userIp
      );

      let streamUrl: string | undefined;
      try {
        streamUrl = await debridInterface.resolve(playbackInfo, filename);
      } catch (error: any) {
        let staticFile: string = StaticFiles.INTERNAL_SERVER_ERROR;
        if (error instanceof DebridError) {
          logger.error(
            `Got Debrid error during debrid resolve: ${error.code}: ${error.message}`
          );
          switch (error.code) {
            case 'UNAVAILABLE_FOR_LEGAL_REASONS':
              staticFile = StaticFiles.UNAVAILABLE_FOR_LEGAL_REASONS;
              break;
            case 'STORE_LIMIT_EXCEEDED':
              staticFile = StaticFiles.CONTENT_PROXY_LIMIT_REACHED;
              break;
            case 'FORBIDDEN':
              staticFile = StaticFiles.FORBIDDEN;
              break;
            case 'UNAUTHORIZED':
              staticFile = StaticFiles.UNAUTHORIZED;
              break;
            case 'UNPROCESSABLE_ENTITY':
            case 'UNSUPPORTED_MEDIA_TYPE':
            case 'STORE_MAGNET_INVALID':
              staticFile = StaticFiles.DOWNLOAD_FAILED;
              break;
            case 'NO_MATCHING_FILE':
              staticFile = StaticFiles.NO_MATCHING_FILE;
              break;
            default:
              break;
          }
        } else {
          logger.error(
            `Got unknown error during debrid resolve: ${error.message}`
          );
        }

        res.status(302).redirect(`/static/${staticFile}`);
        return;
      }

      if (!streamUrl) {
        res.status(302).redirect(`/static/${StaticFiles.DOWNLOADING}`);
        return;
      }

      res.status(307).redirect(streamUrl);
    } catch (error: any) {
      if (error instanceof APIError) {
        next(error);
      } else if (error instanceof ZodError) {
        next(
          new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            formatZodError(error)
          )
        );
      } else {
        logger.error(
          `Got unexpected error during debrid resolve: ${error.message}`
        );
        next(
          new APIError(
            constants.ErrorCode.INTERNAL_SERVER_ERROR,
            undefined,
            error.message
          )
        );
      }
    }
  }
);

export default router;
