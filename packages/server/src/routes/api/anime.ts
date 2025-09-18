import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses.js';
import {
  APIError,
  constants,
  createLogger,
  formatZodError,
  AnimeDatabase,
  IdType,
  ID_TYPES,
} from '@aiostreams/core';
import { z, ZodError } from 'zod';
import { animeApiRateLimiter } from '../../middlewares/ratelimit.js';

const router: Router = Router();
const logger = createLogger('server');

router.use(animeApiRateLimiter);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  let idType: IdType;
  let idValue: string | number;
  try {
    const { idType: idTypeParam, idValue: idValueParam } = z
      .object({
        idType: z.enum(ID_TYPES),
        idValue: z.union([z.string(), z.number()]),
      })
      .parse(req.query);
    idType = idTypeParam;
    idValue = idValueParam;
  } catch (error: any) {
    if (error instanceof ZodError) {
      next(
        new APIError(
          constants.ErrorCode.BAD_REQUEST,
          400,
          formatZodError(error)
        )
      );
      return;
    }
    next(new APIError(constants.ErrorCode.BAD_REQUEST, error.message));
    return;
  }
  try {
    const mappingEntry = AnimeDatabase.getInstance().getEntryById(
      idType,
      idValue
    );
    res
      .status(200)
      .json(
        createResponse({ success: true, detail: 'OK', data: mappingEntry })
      );
  } catch (error: any) {
    logger.error(`Mapping check failed: ${error.message}`);
    next(
      new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR, error.message)
    );
  }
});

export default router;
