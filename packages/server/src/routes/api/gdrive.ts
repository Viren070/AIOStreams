import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses.js';
import {
  APIError,
  constants,
  createLogger,
  GoogleOAuth,
} from '@aiostreams/core';

const router: Router = Router();
const logger = createLogger('server');

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body;
    if (!code) {
      throw new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'Code is required'
      );
    }
    const { access_token, refresh_token } =
      await GoogleOAuth.exchangeAuthorisationCode(code);
    res.status(200).json(
      createResponse({
        success: true,
        data: {
          accessToken: access_token,
          refreshToken: refresh_token,
        },
      })
    );
  } catch (error: any) {
    logger.error(`GDrive authorisation failed: ${error.message}`);
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
