import { Request, Response, NextFunction } from 'express';
import {
  createLogger,
  APIError,
  constants,
  StremioTransformer,
} from '@aiostreams/core';
import { createResponse } from '../utils/responses.js';

const logger = createLogger('server');

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!err) {
    next();
    return;
  }

  let error;
  if (!(err instanceof APIError)) {
    // log unexpected errors
    logger.error(err);
    logger.error(err.stack);
    error = new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR);
  } else {
    error = err;
  }

  if (error.code === constants.ErrorCode.RATE_LIMIT_EXCEEDED) {
    const stremioResourceRequestRegex =
      /^\/stremio\/[0-9a-fA-F-]{36}\/[A-Za-z0-9+/=]+\/(stream|meta|addon_catalog|subtitles|catalog)\/[^/]+\/[^/]+(?:\/[^/]+)?\.json\/?$/;
    const resource = stremioResourceRequestRegex.exec(req.originalUrl);
    if (resource) {
      res.json(
        StremioTransformer.createDynamicError(
          resource[1] as
            | 'stream'
            | 'meta'
            | 'addon_catalog'
            | 'subtitles'
            | 'catalog',
          {
            errorDescription: 'Rate Limit Exceeded',
          }
        )
      );
      return;
    }
  }

  res.status(error.statusCode).json(
    createResponse({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    })
  );
  return;
};
