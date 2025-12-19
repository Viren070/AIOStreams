import rateLimit, { MemoryStore, ipKeyGenerator } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { RedisStore } from 'rate-limit-redis';
import {
  Env,
  createLogger,
  constants,
  APIError,
  Cache,
  REDIS_PREFIX,
} from '@aiostreams/core';

const logger = createLogger('server');

const createRateLimiter = (
  windowMs: number,
  maxRequests: number,
  prefix: string = ''
) => {
  if (Env.DISABLE_RATE_LIMITS) {
    return (req: Request, res: Response, next: NextFunction) => next();
  }
  const redisClient = Env.REDIS_URI ? Cache.getRedisClient() : undefined;
  const store =
    redisClient && Env.RATE_LIMIT_STORE === 'redis'
      ? new RedisStore({
          prefix: `${REDIS_PREFIX}rate-limit:`,
          sendCommand: (...args: string[]) => redisClient.sendCommand(args),
        })
      : new MemoryStore();
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: (req: Request) => {
      const ip = req.requestIp || req.userIp || req.ip;
      const ipKey = ip ? ipKeyGenerator(ip) : '';
      return prefix + ':' + ipKey;
    },
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
        `${prefix} rate limit exceeded for IP: ${req.requestIp || req.userIp || req.ip} - ${
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

const animeApiRateLimiter = createRateLimiter(
  Env.ANIME_API_RATE_LIMIT_WINDOW * 1000,
  Env.ANIME_API_RATE_LIMIT_MAX_REQUESTS,
  'anime-api'
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

const easynewsNzbRateLimiter = createRateLimiter(
  Env.EASYNEWS_NZB_RATE_LIMIT_WINDOW * 1000,
  Env.EASYNEWS_NZB_RATE_LIMIT_MAX_REQUESTS,
  'easynews-nzb'
);

export {
  userApiRateLimiter,
  streamApiRateLimiter,
  formatApiRateLimiter,
  catalogApiRateLimiter,
  animeApiRateLimiter,
  stremioStreamRateLimiter,
  stremioCatalogRateLimiter,
  stremioManifestRateLimiter,
  stremioSubtitleRateLimiter,
  stremioMetaRateLimiter,
  staticRateLimiter,
  easynewsNzbRateLimiter,
};
