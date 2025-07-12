import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses';
import {
  APIError,
  constants,
  createLogger,
  UserRepository,
} from '@aiostreams/core';
const router = Router();
const logger = createLogger('server');

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await UserRepository.getUserCount();
    res.status(200).json(createResponse({ success: true, detail: 'OK' }));
  } catch (error: any) {
    logger.error(`Health check failed: ${error.message}`);
    next(
      new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR, error.message)
    );
  }
});

export default router;
