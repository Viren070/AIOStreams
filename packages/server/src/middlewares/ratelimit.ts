import rateLimit, {
  MemoryStore,
  ipKeyGenerator,
  type Options,
  type Store,
} from 'express-rate-limit';
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

/**
 * Attempts at a secret, counted per key and charged before the check, so
 * concurrent tries cannot all slip under the limit. Always on.
 */
export function attemptLimiter(
  windowSeconds: number,
  max: number,
  prefix: string
) {
  const windowMs = windowSeconds * 1000;
  let shared: Store | null | undefined;
  const sharedStore = (): Store | null => {
    if (shared === undefined) {
      const redisClient = appConfig.bootstrap.redisUri
        ? Cache.getRedisClient()
        : undefined;
      shared = redisClient
        ? new RedisStore({
            prefix: `${REDIS_PREFIX}attempts:${prefix}:`,
            sendCommand: (...args: string[]) => redisClient.sendCommand(args),
          })
        : null;
      void shared?.init?.({ windowMs } as Options);
    }
    return shared;
  };
  // Not MemoryStore: it hands back its live counter, which concurrent callers
  // would all read at its final value.
  const local = new Map<string, { hits: number; resetAt: number }>();
  return {
    /** Spends an attempt; false once the key is past its limit. */
    async take(key: string): Promise<boolean> {
      const store = sharedStore();
      if (store) return (await store.increment(key)).totalHits <= max;
      const now = Date.now();
      let entry = local.get(key);
      if (!entry || entry.resetAt <= now) {
        if (local.size >= 10_000)
          for (const [k, e] of local) if (e.resetAt <= now) local.delete(k);
        entry = { hits: 0, resetAt: now + windowMs };
        local.set(key, entry);
      }
      return ++entry.hits <= max;
    },
    async reset(key: string): Promise<void> {
      const store = sharedStore();
      if (store) await store.resetKey(key);
      else local.delete(key);
    },
  };
}

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
