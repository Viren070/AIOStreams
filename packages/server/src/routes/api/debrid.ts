import { Router, Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  createLogger,
  createProxy,
  DebridError,
  decodeFallbackKey,
  decodeFileInfo,
  describeChainItem,
  getPlayChain,
  parsePlaybackUrl,
  resolvePlaybackTarget,
  resolveExternalTarget,
  runPlayChain,
  getSimpleTextHash,
  DistributedLock,
  type FailoverAttempt,
  type FailoverContentType,
  type PlayChainItem,
  maskSensitiveInfo,
} from '@aiostreams/core';
import { ZodError } from 'zod';
import {
  StaticFiles,
  mapDebridErrorToStaticFile,
} from '../../utils/static-errors.js';
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
      const fallbacks = chain?.fallbacks ?? [];
      const hasFailover = fallbacks.length > 0;

      if (!hasFailover && !decodedFbk) {
        logger.debug(
          { clickedType, hasFallbackKey: !!fallbackKey },
          'clicked item has no failover chain reference'
        );
      }

      const clientIp = req.userIp;

      const arrivedViaOurProxy = !!req.query[constants.INTERNAL_PROXY_MARKER];
      const proxyConfig = chain?.proxyConfig;

      // Wrap a resolved (CDN) URL in a proxy URL when the source item should be
      // proxied and we didn't arrive via our proxy. Fail-open to the raw URL.
      const maybeProxy = async (
        resolvedUrl: string | undefined,
        itemProxied: boolean | undefined
      ): Promise<string | undefined> => {
        if (!resolvedUrl) return resolvedUrl; // still downloading
        if (arrivedViaOurProxy || !itemProxied || !proxyConfig?.enabled) {
          return resolvedUrl;
        }
        if (resolvedUrl.includes(constants.BUILTIN_PROXY_PATH_PREFIX)) {
          return resolvedUrl;
        }
        try {
          const out = await createProxy(proxyConfig).generateUrls([
            { url: resolvedUrl, filename, type: 'stream' },
          ]);
          if (Array.isArray(out) && out[0]) return out[0];
          logger.warn(
            { err: out && 'error' in out ? out.error : 'no url returned' },
            'failed to proxy failover-resolved url; serving raw url'
          );
        } catch (err: any) {
          logger.warn(
            { err: err?.message ?? String(err) },
            'error proxying failover-resolved url; serving raw url'
          );
        }
        return resolvedUrl; // fail-open
      };

      // Resolve a chain item (or variant), branching on owned vs external, then
      // proxying the result when configured.
      const resolveTarget =
        (item: PlayChainItem) =>
        async (signal?: AbortSignal): Promise<string | undefined> => {
          if (item.kind === 'external') {
            return resolveExternalTarget(item.url, { clientIp }, signal).then(
              (url) => maybeProxy(url, item.proxied)
            );
          }
          const target = parsePlaybackUrl(item.url);
          return target
            ? resolvePlaybackTarget(target, { clientIp }, signal).then((url) =>
                maybeProxy(url, item.proxied)
              )
            : Promise.reject(new Error('unparseable fallback url'));
        };

      const attempts: FailoverAttempt[] = [
        {
          label: chain?.clicked
            ? describeChainItem(chain.clicked, 'clicked')
            : describeChainItem({ type: clickedType, filename }, 'clicked'),
          rank: 0,
          resolve: (signal) =>
            resolvePlaybackTarget(
              { encryptedStoreAuth, fileInfoRaw, metadataId, filename },
              { clientIp },
              signal
            ).then((url) => maybeProxy(url, chain?.clickedProxied)),
        },
        ...fallbacks.map(
          (f): FailoverAttempt => ({
            label: describeChainItem(f),
            rank: f.rank,
            resolve: resolveTarget(f),
          })
        ),
      ];

      const runCfg = {
        parallel: chain?.parallel ?? 1,
        staggerMs: chain?.staggerMs ?? 0,
        preferredGraceMs: chain?.preferredGraceMs ?? 0,
        maxWaitMs: chain?.maxWaitMs ?? 60_000,
        duplicateStaggerMs: chain?.duplicateStaggerMs ?? 0,
      };

      if (hasFailover) {
        logger.info(
          {
            attempts: attempts.length,
            parallel: runCfg.parallel,
            clickedType,
            chain: attempts.map((a, i) => {
              const label = a.label ?? 'unknown';
              // Index 0 is the clicked item, the fallbacks follow in order.
              // Variants are indented under the release they belong to.
              return i > 0 && fallbacks[i - 1]?.isVariant
                ? `  ↳ ${label}`
                : label;
            }),
          },
          'resolving failover chain'
        );
      } else {
        logger.debug(
          { clickedType, attempt: attempts[0].label },
          'no failover targets; resolving the clicked item only'
        );
      }

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
        {
          url: maskSensitiveInfo(result.url),
          label: result.label,
          failedOver: result.failedOver,
        },
        'Debrid resolve succeeded, redirecting'
      );

      res.setHeader('Cache-Control', 'no-store');
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
