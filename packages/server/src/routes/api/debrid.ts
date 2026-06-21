import { Router, Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  createLogger,
  DebridError,
  decodeFallbackKey,
  decodeFileInfo,
  getPlayChain,
  parsePlaybackUrl,
  resolvePlaybackTarget,
  runPlayChain,
  getSimpleTextHash,
  DistributedLock,
  PLAYBACK_PATH_PREFIX,
  type FailoverAttempt,
  type FailoverContentType,
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

interface PlaybackParams {
  encryptedStoreAuth: string;
  fallbackKey?: string;
  fileInfo: string;
  metadataId: string;
  filename: string;
}

/** Map a DebridError code to the static fallback video served to the player. */
function mapDebridErrorToStaticFile(code: string | undefined): string {
  switch (code) {
    case 'UNAVAILABLE_FOR_LEGAL_REASONS':
      return StaticFiles.UNAVAILABLE_FOR_LEGAL_REASONS;
    case 'STORE_LIMIT_EXCEEDED':
      return StaticFiles.STORE_LIMIT_EXCEEDED;
    case 'PAYMENT_REQUIRED':
      return StaticFiles.PAYMENT_REQUIRED;
    case 'TOO_MANY_REQUESTS':
      return StaticFiles.TOO_MANY_REQUESTS;
    case 'FORBIDDEN':
      return StaticFiles.FORBIDDEN;
    case 'UNAUTHORIZED':
      return StaticFiles.UNAUTHORIZED;
    case 'UNPROCESSABLE_ENTITY':
    case 'UNSUPPORTED_MEDIA_TYPE':
    case 'STORE_MAGNET_INVALID':
      return StaticFiles.DOWNLOAD_FAILED;
    case 'NO_MATCHING_FILE':
      return StaticFiles.NO_MATCHING_FILE;
    default:
      return StaticFiles.INTERNAL_SERVER_ERROR;
  }
}

router.get(
  [
    '/playback/:encryptedStoreAuth/:fallbackKey/:fileInfo/:metadataId/:filename',
    // Legacy
    '/playback/:encryptedStoreAuth/:fileInfo/:metadataId/:filename',
  ],
  async (req: Request<PlaybackParams>, res: Response, next: NextFunction) => {
    try {
      const {
        encryptedStoreAuth,
        fallbackKey,
        fileInfo: fileInfoRaw,
        metadataId,
        filename,
      } = req.params;

      // Validate the clicked item decodes (preserves the 400 contract) and tells
      // us which kind it is for cross-type filtering.
      const fileInfo = await decodeFileInfo(fileInfoRaw);
      if (!fileInfo) {
        next(
          new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            'Failed to parse file info and not found in store.'
          )
        );
        return;
      }
      const clickedType: FailoverContentType =
        fileInfo.type === 'usenet' ? 'usenet' : 'debrid';

      const decodedFbk = decodeFallbackKey(fallbackKey);
      const chain = decodedFbk
        ? await getPlayChain(decodedFbk, clickedType)
        : undefined;
      const fallbackItems = chain?.items ?? [];
      const hasFailover = fallbackItems.length > 0;

      const clientIp = req.userIp;
      const attempts: FailoverAttempt[] = [
        {
          label: 'clicked',
          resolve: (signal) =>
            resolvePlaybackTarget(
              { encryptedStoreAuth, fileInfoRaw, metadataId, filename },
              { clientIp },
              signal
            ),
        },
        ...fallbackItems.map((it): FailoverAttempt => {
          const label = it.addonName
            ? `${it.type} (${it.addonName})`
            : it.type;
          // Owned playback URL — parse and resolve
          if (it.url.includes(PLAYBACK_PATH_PREFIX)) {
            const target = parsePlaybackUrl(it.url);
            return {
              label,
              resolve: (signal) =>
                target
                  ? resolvePlaybackTarget(target, { clientIp }, signal)
                  : Promise.reject(new Error('unparseable fallback url')),
            };
          }
          // Raw URL (e.g. debrid direct download) — use directly without resolve
          return {
            label,
            resolve: () => Promise.resolve(it.url),
          };
        }),
      ];

      const runCfg = {
        parallel: chain?.parallel ?? 1,
        staggerMs: chain?.staggerMs ?? 0,
        preferredGraceMs: chain?.preferredGraceMs ?? 0,
        maxWaitMs: chain?.maxWaitMs ?? 60_000,
      };

      logger.debug('Attempting debrid resolve', {
        attempts: attempts.length,
        parallel: runCfg.parallel,
        clickedType,
      });

      const run = () => runPlayChain(attempts, runCfg);

      // Share one running chain across concurrent requests for the same click.
      const result = hasFailover
        ? (
            await DistributedLock.getInstance().withLock(
              `failover:${getSimpleTextHash(
                encryptedStoreAuth + metadataId + filename + fallbackKey
              )}:${clientIp ?? '-'}`,
              run,
              {
                timeout: Math.max(runCfg.maxWaitMs, 180_000),
                ttl: Math.max(runCfg.maxWaitMs, 185_000),
              }
            )
          ).result
        : await run();

      if (result.error) {
        const err = result.error;
        if (err instanceof DebridError) {
          // A malformed clicked item with no chain to fall back to is a 400,
          // not a static video.
          if (err.code === 'BAD_REQUEST' && !hasFailover) {
            next(
              new APIError(
                constants.ErrorCode.BAD_REQUEST,
                undefined,
                err.message
              )
            );
            return;
          }
          logger.error({ err }, `error during debrid resolve: ${err.message}`);
          res.redirect(307, `/static/${mapDebridErrorToStaticFile(err.code)}`);
          return;
        }
        logger.error(
          { err },
          `got unknown error during debrid resolve: ${err.message}`
        );
        res.redirect(307, `/static/${StaticFiles.INTERNAL_SERVER_ERROR}`);
        return;
      }

      if (!result.url) {
        res.redirect(307, `/static/${StaticFiles.DOWNLOADING}`);
        return;
      }

      logger.debug(
        { url: result.url, label: result.winningLabel },
        'Debrid resolve succeeded, redirecting'
      );

      res.redirect(307, result.url);
    } catch (error: any) {
      if (error instanceof APIError || error instanceof ZodError) {
        next(error);
      } else {
        logger.error(
          { err: error },
          `got unexpected error during debrid resolve: ${error.message}`
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
