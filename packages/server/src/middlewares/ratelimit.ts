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

/**
 * A limiter, plus a way to spend one token outside the middleware.
 *
 * `tryConsume` charges the same bucket but writes no headers and throws
 * nothing, so a route can degrade instead of failing.
 */
export interface Limiter {
  (req: Request, res: Response, next: NextFunction): void;
  tryConsume(req: Request): Promise<boolean>;
}

const createRateLimiter = (
  windowMs: number,
  maxRequests: number,
  prefix: string = ''
) => {
  const keyOf = (req: Request) => {
    const ip = req.requestIp || req.userIp || req.ip;
    return prefix + ':' + (ip ? ipKeyGenerator(ip) : '');
  };
  if (appConfig.rateLimits.disabled) {
    return {
      middleware: (req: Request, res: Response, next: NextFunction) => next(),
      store: null,
      keyOf,
      max: maxRequests,
    };
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
  const middleware = rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    validate: { creationStack: false },
    keyGenerator: keyOf,
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
  // `rateLimit()` calls `store.init()` itself, so the store is usable here.
  return { middleware, store, keyOf, max: maxRequests };
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
): Limiter => {
  let limiter: ReturnType<typeof createRateLimiter> | null = null;
  const ensure = () => {
    if (!limiter) {
      const { window, maxRequests } = resolve();
      limiter = createRateLimiter(window * 1000, maxRequests, prefix);
    }
    return limiter;
  };
  const fn = ((req: Request, res: Response, next: NextFunction) =>
    ensure().middleware(req, res, next)) as Limiter;
  fn.tryConsume = async (req: Request) => {
    const built = ensure();
    if (!built.store) return true;
    try {
      const { totalHits } = await built.store.increment(built.keyOf(req));
      return totalHits <= built.max;
    } catch {
      // A limiter that cannot answer must not be the reason a request fails.
      return true;
    }
  };
  return fn;
};

const userApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.userApi,
  'user-api'
);

const userCreateRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.userCreate,
  'user-create'
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

const linkedAccountsRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.linkedAccountsApi,
  'linked-accounts-api'
);

const loginRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.login,
  'auth-login'
);

const oidcRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.oidc,
  'auth-oidc'
);

const staticRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.static,
  'static'
);

const communityApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.communityApi,
  'community-api'
);

const syncApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.syncApi,
  'sync-api'
);

const jellyfinLoginRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.jellyfinLogin,
  'jellyfin-login'
);

const jellyfinApiRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.jellyfinApi,
  'jellyfin-api'
);

const jellyfinImageRateLimiter = lazyLimiter(
  () => appConfig.rateLimits.jellyfinImage,
  'jellyfin-image'
);

export {
  jellyfinLoginRateLimiter,
  jellyfinApiRateLimiter,
  jellyfinImageRateLimiter,
  userApiRateLimiter,
  userCreateRateLimiter,
  linkedAccountsRateLimiter,
  communityApiRateLimiter,
  syncApiRateLimiter,
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
  loginRateLimiter,
  oidcRateLimiter,
};
