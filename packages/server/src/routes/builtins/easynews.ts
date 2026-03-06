import { Router, Request, Response, NextFunction } from 'express';
import {
  EasynewsSearchAddon,
  EasynewsApi,
  EasynewsNzbParamsSchema,
  EasynewsAuthSchema,
  fromUrlSafeBase64,
  createLogger,
  formatZodError,
  NzbProxyManager,
  APIError,
  constants,
} from '@aiostreams/core';
import { ZodError } from 'zod';
import { easynewsNzbRateLimiter } from '../../middlewares/index.js';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('server');

interface EasynewsManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request<EasynewsManifestParams>, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;

    try {
      const manifest = new EasynewsSearchAddon(
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

interface EasynewsStreamParams {
  encodedConfig?: string; // optional
  type: string;
  id: string;
}

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<EasynewsStreamParams>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;

    try {
      const addon = new EasynewsSearchAddon(
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

/**
 * NZB endpoint - fetches NZB from Easynews and serves it
 * This endpoint is needed because Easynews requires a POST request to fetch NZBs
 */
interface EasynewsNzbParams {
  encodedAuth: string;
  encodedParams: string;
  aiostreamsAuth?: string; // optional
  filename: string;
  // match Express.Request<ParamsDictionary> to allow chaining of easynewsNzbRateLimiter middleware
  [key: string]: string | string[] | undefined;
}

router.get(
  '/nzb/:encodedAuth/:encodedParams{/:aiostreamsAuth}/:filename.nzb',
  easynewsNzbRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      encodedAuth,
      encodedParams,
      aiostreamsAuth: encodedAiostreamsAuth,
      filename,
    } = req.params as EasynewsNzbParams;

    try {
      // Decode and validate auth credentials
      let auth;
      try {
        const decodedAuth = fromUrlSafeBase64(encodedAuth);
        auth = EasynewsAuthSchema.parse(JSON.parse(decodedAuth));
      } catch (e) {
        logger.warn('Failed to decode/parse Easynews auth');
        next(
          new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            'Invalid authentication'
          )
        );
        return;
      }

      // Decode and validate NZB params
      let nzbParams;
      try {
        nzbParams = EasynewsNzbParamsSchema.parse(
          JSON.parse(fromUrlSafeBase64(encodedParams))
        );
      } catch (e) {
        logger.warn('Failed to decode/parse NZB params');
        next(
          new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            'Invalid NZB parameters'
          )
        );
        return;
      }

      // Parse optional AIOStreams auth for bypass
      let aiostreamsAuth: { username: string; password: string } | undefined;
      if (encodedAiostreamsAuth) {
        try {
          const decoded = fromUrlSafeBase64(encodedAiostreamsAuth);
          const [username, password] = decoded.split(':');
          if (username && password) {
            aiostreamsAuth = { username, password };
          }
        } catch (e) {
          // continue without auth
          logger.debug(
            'Invalid AIOStreams auth in URL, continuing without bypass'
          );
        }
      }

      // Check if Easynews NZB proxy is enabled
      if (!NzbProxyManager.isEasynewsProxyEnabled(aiostreamsAuth)) {
        res.status(503).json(
          createResponse({
            error: {
              code: 'NZB_PROXY_DISABLED',
              message: 'Easynews NZB proxying is disabled',
            },
            success: false,
          })
        );
        return;
      }

      // Check rate limits
      const userKey = NzbProxyManager.getUserKey(auth.username);
      const rateLimitCheck = NzbProxyManager.checkRateLimit(
        userKey,
        aiostreamsAuth
      );
      if (!rateLimitCheck.allowed) {
        logger.warn('Rate limit exceeded for Easynews NZB fetch', {
          userKey,
          reason: rateLimitCheck.reason,
        });
        next(
          new APIError(
            constants.ErrorCode.RATE_LIMIT_EXCEEDED,
            undefined,
            rateLimitCheck.reason || 'Rate limit exceeded'
          )
        );
        return;
      }

      const api = new EasynewsApi(auth.username, auth.password);
      const { content, filename } = await api.fetchNzb(nzbParams);

      const sizeCheck = NzbProxyManager.checkSizeLimit(
        content.length,
        aiostreamsAuth
      );
      if (!sizeCheck.allowed) {
        logger.warn('NZB size limit exceeded', {
          size: content.length,
          reason: sizeCheck.reason,
        });
        res.status(413).json(
          createResponse({
            error: {
              code: 'NZB_SIZE_LIMIT_EXCEEDED',
              message: sizeCheck.reason || 'NZB size limit exceeded',
            },
            success: false,
          })
        );
        return;
      }

      if (!rateLimitCheck.authorised) {
        NzbProxyManager.incrementRateLimit(userKey);
      }

      // Set headers for NZB download
      res.setHeader('Content-Type', 'application/x-nzb');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`
      );
      res.setHeader('Content-Length', content.length);

      // Send the NZB content
      res.send(content);
    } catch (error) {
      logger.error(
        `Failed to fetch NZB: ${error instanceof Error ? error.message : String(error)}`
      );
      next(error);
    }
  }
);

export default router;
