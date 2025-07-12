import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

import { Env, createLogger, constants, APIError } from '@aiostreams/core';

const logger = createLogger('ratelimit');

const createRateLimiter = (
  windowMs: number,
  maxRequests: number,
  prefix: string = ''
) => {
  if (Env.DISABLE_RATE_LIMITS) {
    return (req: Request, res: Response, next: NextFunction) => next();
  }
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    // Use a unique store key for each rate limiter
    keyGenerator: (req: Request) => `${prefix}:${req.userIp || req.ip || ''}`,
    handler: (
      req: Request,
      res: Response,
      next: NextFunction,
      options: any
    ) => {
      const timeRemaining = req.rateLimit?.resetTime
        ? req.rateLimit.resetTime.getTime() - new Date().getTime()
        : 0;
      logger.warn(
        `Rate limit exceeded for IP: ${req.userIp || req.ip} - ${
          options.message
        } - Time remaining: ${timeRemaining}ms`
      );
      throw new APIError(constants.ErrorCode.RATE_LIMIT_EXCEEDED);
    },
  });
};

const userApiRateLimiter = createRateLimiter(
  Env.USER_API_RATE_LIMIT_WINDOW * 1000,
  Env.USER_API_RATE_LIMIT_MAX_REQUESTS,
  'user-api'
);

const streamApiRateLimiter = createRateLimiter(
  Env.STREAM_API_RATE_LIMIT_WINDOW * 1000,
  Env.STREAM_API_RATE_LIMIT_MAX_REQUESTS,
  'stream-api'
);

const formatApiRateLimiter = createRateLimiter(
  Env.FORMAT_API_RATE_LIMIT_WINDOW * 1000,
  Env.FORMAT_API_RATE_LIMIT_MAX_REQUESTS,
  'format-api'
);

const catalogApiRateLimiter = createRateLimiter(
  Env.CATALOG_API_RATE_LIMIT_WINDOW * 1000,
  Env.CATALOG_API_RATE_LIMIT_MAX_REQUESTS,
  'catalog-api'
);

const stremioStreamRateLimiter = createRateLimiter(
  Env.STREMIO_STREAM_RATE_LIMIT_WINDOW * 1000,
  Env.STREMIO_STREAM_RATE_LIMIT_MAX_REQUESTS,
  'stremio-stream'
);

const stremioCatalogRateLimiter = createRateLimiter(
  Env.STREMIO_CATALOG_RATE_LIMIT_WINDOW * 1000,
  Env.STREMIO_CATALOG_RATE_LIMIT_MAX_REQUESTS,
  'stremio-catalog'
);

const stremioManifestRateLimiter = createRateLimiter(
  Env.STREMIO_MANIFEST_RATE_LIMIT_WINDOW * 1000,
  Env.STREMIO_MANIFEST_RATE_LIMIT_MAX_REQUESTS,
  'stremio-manifest'
);

const stremioSubtitleRateLimiter = createRateLimiter(
  Env.STREMIO_SUBTITLE_RATE_LIMIT_WINDOW * 1000,
  Env.STREMIO_SUBTITLE_RATE_LIMIT_MAX_REQUESTS,
  'stremio-subtitle'
);

const stremioMetaRateLimiter = createRateLimiter(
  Env.STREMIO_META_RATE_LIMIT_WINDOW * 1000,
  Env.STREMIO_META_RATE_LIMIT_MAX_REQUESTS,
  'stremio-meta'
);

const staticRateLimiter = createRateLimiter(
  Env.STATIC_RATE_LIMIT_WINDOW * 1000,
  Env.STATIC_RATE_LIMIT_MAX_REQUESTS,
  'static'
);

export {
  userApiRateLimiter,
  streamApiRateLimiter,
  formatApiRateLimiter,
  catalogApiRateLimiter,
  stremioStreamRateLimiter,
  stremioCatalogRateLimiter,
  stremioManifestRateLimiter,
  stremioSubtitleRateLimiter,
  stremioMetaRateLimiter,
  staticRateLimiter,
};
