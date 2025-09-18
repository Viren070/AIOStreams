import { Router, Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  createLogger,
  formatZodError,
  RPDB,
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
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
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
    const { id, type, fallback, apiKey } = data;
    const rpdb = new RPDB(apiKey);
    const posterUrl = (await rpdb.getPosterUrl(type, id)) || fallback;
    if (!posterUrl) {
      res.status(404).json(
        createResponse({
          success: false,
          detail: 'Not found',
        })
      );
      return;
    }
    res.redirect(301, posterUrl!);
  } catch (error: any) {
    next(
      new APIError(
        constants.ErrorCode.INTERNAL_SERVER_ERROR,
        undefined,
        error.message
      )
    );
  }
});

export default router;
