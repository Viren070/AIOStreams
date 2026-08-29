import { Request, Response, NextFunction } from 'express';
import {
  createLogger,
  APIError,
  constants,
  StremioTransformer,
} from '@aiostreams/core';
import { createResponse } from '../utils/responses.js';
import { ZodError } from 'zod';

const logger = createLogger('server');

function asClientError(err: Error): APIError | undefined {
  const { status, expose, type, limit } = err as Error & {
    status?: unknown;
    expose?: unknown;
    type?: unknown;
    limit?: unknown;
  };
  if (
    expose !== true ||
    typeof status !== 'number' ||
    status < 400 ||
    status >= 500
  ) {
    return undefined;
  }
  const message =
    type === 'entity.too.large' && typeof limit === 'number'
      ? `Request body too large (limit ${limit} bytes)`
      : err.message;
  return new APIError(constants.ErrorCode.BAD_REQUEST, status, message);
}

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
  if (err instanceof APIError || err instanceof ZodError) {
    error = err;
  } else {
    const clientError = asClientError(err);
    if (clientError) {
      error = clientError;
    } else {
      // log unexpected errors
      logger.error(err);
      logger.error(err.stack);
      error = new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR);
    }
  }
  if (error instanceof ZodError) {
    res.status(400).json(
      createResponse({
        success: false,
        error: {
          code: constants.ErrorCode.BAD_REQUEST,
          message: 'Invalid Request',
          issues: JSON.parse(error.message),
        },
      })
    );
    return;
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
