import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses';
import { createLogger, UserRepository } from '@aiostreams/core';
import {
  createFormatter,
  ParsedStreamSchema,
  APIError,
} from '@aiostreams/core';
import * as constants from '@aiostreams/core';
import { formatApiRateLimiter } from '../../middlewares/ratelimit';
const router = Router();

router.use(formatApiRateLimiter);

const logger = createLogger('server');

router.post('/', (req: Request, res: Response) => {
  const { success, error, data } = ParsedStreamSchema.safeParse(
    req.body.stream
  );
  if (!success) {
    logger.error('Invalid stream', { error });
    throw new APIError(constants.ErrorCode.FORMAT_INVALID_STREAM);
  }
  const { formatter, definition, addonName } = req.body;
  if (!formatter) {
    throw new APIError(constants.ErrorCode.FORMAT_INVALID_FORMATTER);
  } else if (!constants.FORMATTERS.includes(formatter)) {
    throw new APIError(constants.ErrorCode.FORMAT_INVALID_FORMATTER);
  }
  const formattedStream = createFormatter(
    formatter,
    definition,
    addonName
  ).format(data);
  res
    .status(200)
    .json(createResponse({ success: true, data: formattedStream }));
});

export default router;
