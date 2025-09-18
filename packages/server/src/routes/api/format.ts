import { Router, Request, Response } from 'express';
import { createResponse } from '../../utils/responses.js';
import {
  createLogger,
  UserDataSchema,
  formatZodError,
  createFormatter,
  ParsedStreamSchema,
  APIError,
  constants,
} from '@aiostreams/core';
import { formatApiRateLimiter } from '../../middlewares/ratelimit.js';

const router: Router = Router();

router.use(formatApiRateLimiter);

const logger = createLogger('server');

router.post('/', async (req: Request, res: Response) => {
  const { userData, stream } = req.body;

  const {
    success: userDataSuccess,
    error: userDataError,
    data: userDataData,
  } = UserDataSchema.safeParse(userData);
  if (!userDataSuccess) {
    logger.error('Invalid user data', { error: userDataError });
    throw new APIError(
      constants.ErrorCode.FORMAT_INVALID_FORMATTER,
      400,
      formatZodError(userDataError)
    );
  }
  const formatter = createFormatter(userDataData);
  const {
    success: streamSuccess,
    error: streamError,
    data: streamData,
  } = ParsedStreamSchema.safeParse(stream);
  if (!streamSuccess) {
    logger.error('Invalid stream', { error: streamError });
    throw new APIError(
      constants.ErrorCode.FORMAT_INVALID_STREAM,
      400,
      formatZodError(streamError)
    );
  }
  const formattedStream = await formatter.format(streamData);
  res
    .status(200)
    .json(createResponse({ success: true, data: formattedStream }));
});

export default router;
