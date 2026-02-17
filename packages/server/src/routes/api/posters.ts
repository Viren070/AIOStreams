import { Router, Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  createLogger,
  formatZodError,
  createPosterServiceFromParams,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';
import { z } from 'zod';

const router: Router = Router();
const logger = createLogger('server');

const searchParams = z.object({
  id: z.string(),
  type: z.string(),
  fallback: z.string().optional(),
  apiKey: z.string(),
  profileId: z.string().optional(),
});

/**
 * Combined poster redirect handler.
 * Supports all poster services via /:service parameter.
 * e.g. /posters/rpdb, /posters/top-poster, /posters/aioratings
 */
router.get(
  '/:service',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { success, data, error } = searchParams.safeParse(req.query);
      if (!success) {
        res.status(400).json(
          createResponse({
            success: false,
            detail: 'Invalid request',
            error: {
              code: constants.ErrorCode.BAD_REQUEST,
              message: formatZodError(error),
            },
          })
        );
        return;
      }

      const { id, type, fallback, apiKey, profileId } = data;
      const service = req.params.service;

      const posterService = createPosterServiceFromParams(service, apiKey, {
        profileId: profileId || 'default',
      });

      if (!posterService) {
        res.status(400).json(
          createResponse({
            success: false,
            detail: `Unknown poster service: ${service}`,
            error: {
              code: constants.ErrorCode.BAD_REQUEST,
              message: `Unsupported poster service: ${service}`,
            },
          })
        );
        return;
      }

      let posterUrl: string | null = await posterService.getPosterUrl(type, id);
      posterUrl = posterUrl || fallback || null;

      if (!posterUrl) {
        res.status(404).json(
          createResponse({
            success: false,
            detail: 'Not found',
          })
        );
        return;
      }

      res.redirect(301, posterUrl);
    } catch (error: any) {
      next(
        new APIError(
          constants.ErrorCode.INTERNAL_SERVER_ERROR,
          undefined,
          error.message
        )
      );
    }
  }
);

export default router;
