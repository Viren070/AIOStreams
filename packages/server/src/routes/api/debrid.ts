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
  fromUrlSafeBase64,
  Cache,
  PlaybackInfo,
  ServiceAuth,
  decryptString,
  metadataStore,
  fileInfoStore,
  TitleMetadata,
  FileInfoSchema,
  getSimpleTextHash,
  FileInfo,
  maskSensitiveInfo,
} from '@aiostreams/core';
import { ZodError } from 'zod';
import { StaticFiles } from '../../app.js';
import { corsMiddleware } from '../../middlewares/cors.js';
const router: Router = Router();
const logger = createLogger('server');

router.use(corsMiddleware);

// block HEAD requests
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'HEAD') {
    res.status(405).send('Method not allowed');
  } else {
    next();
  }
});

router.get(
  '/playback/:encryptedStoreAuth/:fileInfo/:metadataId/:filename',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        encryptedStoreAuth,
        fileInfo: encodedFileInfo,
        metadataId,
        filename,
      } = req.params;
      if (!encodedFileInfo || !metadataId || !filename) {
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Encrypted store auth, file info, metadata id and filename are required'
        );
      }

      let fileInfo: FileInfo | undefined;

      try {
        fileInfo = FileInfoSchema.parse(
          JSON.parse(fromUrlSafeBase64(encodedFileInfo))
        );
      } catch (error: any) {
        fileInfo = await fileInfoStore()?.get(encodedFileInfo);
        if (!fileInfo) {
          logger.warn(`Could not get file info`, {
            fileInfo: encodedFileInfo,
            error,
            fileInfoStoreAvailable: fileInfoStore() ? true : false,
          });
          next(
            new APIError(
              constants.ErrorCode.BAD_REQUEST,
              undefined,
              'Failed to parse file info and not found in store.'
            )
          );
          return;
        }
      }

      const decryptedStoreAuth = decryptString(encryptedStoreAuth);
      if (!decryptedStoreAuth.success) {
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Failed to decrypt store auth'
        );
      }

      let storeAuth: ServiceAuth;
      try {
        storeAuth = ServiceAuthSchema.parse(
          JSON.parse(decryptedStoreAuth.data)
        );
      } catch (error: any) {
        logger.warn(`Could not parse decrypted store auth`, {
          decryptedStoreAuth: maskSensitiveInfo(decryptedStoreAuth.data),
          error,
        });
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Failed to parse store auth'
        );
      }

      const metadata: TitleMetadata | undefined =
        await metadataStore().get(metadataId);
      if (!metadata) {
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Metadata not found'
        );
      }

      logger.verbose(`Got metadata: ${JSON.stringify(metadata)}`);

      const playbackInfo: PlaybackInfo =
        fileInfo.type === 'torrent'
          ? {
              type: 'torrent',
              metadata: metadata,
              hash: fileInfo.hash,
              sources: fileInfo.sources,
              index: fileInfo.index,
              filename: filename,
            }
          : {
              type: 'usenet',
              metadata: metadata,
              hash: fileInfo.hash,
              nzb: fileInfo.nzb,
              easynewsUrl: fileInfo.easynewsUrl,
              index: fileInfo.index,
              filename: filename,
            };

      const debridInterface = getDebridService(
        storeAuth.id,
        storeAuth.credential,
        req.userIp
      );

      let streamUrl: string | undefined;
      try {
        streamUrl = await debridInterface.resolve(
          playbackInfo,
          filename,
          fileInfo.cacheAndPlay ?? false,
          fileInfo.autoRemoveDownloads
        );
      } catch (error: any) {
        let staticFile: string = StaticFiles.INTERNAL_SERVER_ERROR;
        if (error instanceof DebridError) {
          logger.error(
            `[${storeAuth.id}] Got Debrid error during debrid resolve: ${error.code}: ${error.message}`,
            { ...error, stack: undefined }
          );
          switch (error.code) {
            case 'UNAVAILABLE_FOR_LEGAL_REASONS':
              staticFile = StaticFiles.UNAVAILABLE_FOR_LEGAL_REASONS;
              break;
            case 'STORE_LIMIT_EXCEEDED':
              staticFile = StaticFiles.STORE_LIMIT_EXCEEDED;
              break;
            case 'PAYMENT_REQUIRED':
              staticFile = StaticFiles.PAYMENT_REQUIRED;
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
            `[${storeAuth.id}] Got unknown error during debrid resolve: ${error.message}`
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
