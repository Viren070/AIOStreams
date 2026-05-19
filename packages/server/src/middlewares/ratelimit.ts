import rateLimit, { MemoryStore, ipKeyGenerator } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { RedisStore } from 'rate-limit-redis';
import {
  Env,
  appConfig,
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
  if (appConfig.rateLimits.disabled) {
    return (req: Request, res: Response, next: NextFunction) => next();
  }
  const redisClient = appConfig.bootstrap.redisUri
    ? Cache.getRedisClient()
    : undefined;
  const store =
    redisClient && appConfig.rateLimits.store === 'redis'
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
    validate: { creationStack: false },
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

/**
 * Each limiter reads `appConfig.rateLimits.*`, which is unavailable at
 * module-load time. Wrap the construction so the underlying express-rate-limit
 * instance is built on the first incoming request (after `initialiseConfig()`
 * has resolved) and reused thereafter.
 */
const lazyLimiter = (
  resolve: () => { window: number; maxRequests: number },
  prefix: string
) => {
  let limiter: ReturnType<typeof createRateLimiter> | null = null;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!limiter) {
      const { window, maxRequests } = resolve();
      limiter = createRateLimiter(window * 1000, maxRequests, prefix);
    }
    return limiter(req, res, next);
  };
};

const userApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.userApi,
  'user-api'
);

const streamApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.streamApi,
  'stream-api'
);

const formatApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.formatApi,
  'format-api'
);

const catalogApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.catalogApi,
  'catalog-api'
);

const animeApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.animeApi,
  'anime-api'
);

const stremioStreamRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.stremioStream,
  'stremio-stream'
);

const stremioCatalogRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.stremioCatalog,
  'stremio-catalog'
);

const stremioManifestRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.stremioManifest,
  'stremio-manifest'
);

const stremioSubtitleRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.stremioSubtitle,
  'stremio-subtitle'
);

const stremioMetaRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.stremioMeta,
  'stremio-meta'
);

const loginRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.login,
  'auth-login'
);

const staticRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.static,
  'static'
);

const easynewsNzbRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.easynewsNzb,
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
  loginRateLimiter,
};
