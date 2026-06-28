import { Router, Request, Response, NextFunction } from 'express';
import {
  EasynewsSearchAddon,
  EasynewsApi,
  EasynewsNzbParamsSchema,
  EasynewsAuthSchema,
  fromUrlSafeBase64,
  createLogger,
  formatZodError,
  validateCredentials,
  APIError,
  constants,
} from '@aiostreams/core';
import { ZodError } from 'zod';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('server');

interface EasynewsManifestParams {
  encodedConfig?: string; // optional
}

router.get(
  '/:encodedConfig/manifest.json',
  async (
    req: Request<EasynewsManifestParams>,
    res: Response,
    next: NextFunction
  ) => {
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
  async (
    req: Request<EasynewsStreamParams>,
    res: Response,
    next: NextFunction
  ) => {
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
  // match Express.Request<ParamsDictionary>
  [key: string]: string | string[] | undefined;
}

router.get(
  '/nzb/:encodedAuth/:encodedParams{/:aiostreamsAuth}/:filename.nzb',
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

      if (
        !aiostreamsAuth ||
        !validateCredentials(aiostreamsAuth.username, aiostreamsAuth.password)
      ) {
        logger.warn('Easynews NZB fetch denied: missing or invalid auth');
        res.status(403).json(
          createResponse({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Valid AIOStreams auth is required to fetch NZBs',
            },
            success: false,
          })
        );
        return;
      }

      const api = new EasynewsApi(auth.username, auth.password);
      const { content, filename } = await api.fetchNzb(nzbParams);

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
