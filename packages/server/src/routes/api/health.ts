import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses.js';
import { APIError, constants, createLogger, getDb } from '@aiostreams/core';
const router: Router = Router();
const logger = createLogger('server');

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getDb()
      .ping()
      .catch((error) => {
        logger.error(`Database ping failed: ${error}`);
        throw new APIError(constants.ErrorCode.DATABASE_ERROR);
      });
    res.status(200).json(createResponse({ success: true, detail: 'OK' }));
  } catch (error: any) {
    logger.error(`Health check failed: ${error.message}`);
    next(
      new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR, error.message)
    );
  }
});

export default router;
