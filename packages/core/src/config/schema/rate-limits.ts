import { z } from 'zod';
import { positiveInt } from './helpers.js';
import type { RuntimeConfigField, RuntimeConfigSection } from '../types.js';

const store = z.enum(['memory', 'redis']);

interface RateLimitOptions {
  windowDefault: number;
  maxDefault: number;
  envPrefix: string;
  label: string;
}

function rateLimit({
  windowDefault,
  maxDefault,
  envPrefix,
  label,
}: RateLimitOptions): {
  window: RuntimeConfigField<number>;
  maxRequests: RuntimeConfigField<number>;
} {
  return {
    window: {
      schema: positiveInt,
      default: windowDefault,
      label: `${label} rate-limit window (s)`,
      description: `Sliding-window length (seconds) for the ${label} rate limiter.`,
      env: `${envPrefix}_RATE_LIMIT_WINDOW`,
      requiresRestart: true,
      secret: false,
    },
    maxRequests: {
      schema: positiveInt,
      default: maxDefault,
      label: `${label} rate-limit max requests`,
      description: `Maximum requests per IP within the window for the ${label} rate limiter.`,
      env: `${envPrefix}_RATE_LIMIT_MAX_REQUESTS`,
      requiresRestart: true,
      secret: false,
    },
  };
}

/**
 * Per-API rate limits. Each subsection has `window` (seconds) and `maxRequests`.
 */
export const rateLimitsSchema = {
  store: {
    schema: store,
    default: 'memory',
    label: 'Rate-limit store',
    description: 'Backend used to track rate-limit counters.',
    env: 'RATE_LIMIT_STORE',
    requiresRestart: true,
    secret: false,
  },
  disabled: {
    schema: z.boolean(),
    default: false,
    label: 'Disable rate limits',
    description: 'When true, all rate limiters are disabled.',
    env: 'DISABLE_RATE_LIMITS',
    requiresRestart: true,
    secret: false,
  },
  static: rateLimit({
    windowDefault: 5,
    maxDefault: 200,
    envPrefix: 'STATIC',
    label: 'static file',
  }),
  userApi: rateLimit({
    windowDefault: 5,
    maxDefault: 5,
    envPrefix: 'USER_API',
    label: 'user API',
  }),
  streamApi: rateLimit({
    windowDefault: 10,
    maxDefault: 5,
    envPrefix: 'STREAM_API',
    label: 'stream API',
  }),
  formatApi: rateLimit({
    windowDefault: 5,
    maxDefault: 30,
    envPrefix: 'FORMAT_API',
    label: 'format API',
  }),
  catalogApi: rateLimit({
    windowDefault: 5,
    maxDefault: 5,
    envPrefix: 'CATALOG_API',
    label: 'catalog API',
  }),
  animeApi: rateLimit({
    windowDefault: 60,
    maxDefault: 120,
    envPrefix: 'ANIME_API',
    label: 'anime API',
  }),
  stremioStream: rateLimit({
    windowDefault: 15,
    maxDefault: 10,
    envPrefix: 'STREMIO_STREAM',
    label: 'Stremio stream',
  }),
  stremioCatalog: rateLimit({
    windowDefault: 5,
    maxDefault: 30,
    envPrefix: 'STREMIO_CATALOG',
    label: 'Stremio catalog',
  }),
  stremioManifest: rateLimit({
    windowDefault: 5,
    maxDefault: 5,
    envPrefix: 'STREMIO_MANIFEST',
    label: 'Stremio manifest',
  }),
  stremioSubtitle: rateLimit({
    windowDefault: 5,
    maxDefault: 10,
    envPrefix: 'STREMIO_SUBTITLE',
    label: 'Stremio subtitle',
  }),
  stremioMeta: rateLimit({
    windowDefault: 5,
    maxDefault: 15,
    envPrefix: 'STREMIO_META',
    label: 'Stremio meta',
  }),
  easynewsNzb: rateLimit({
    windowDefault: 60,
    maxDefault: 15,
    envPrefix: 'EASYNEWS_NZB',
    label: 'Easynews NZB',
  }),
  login: rateLimit({
    windowDefault: 300,
    maxDefault: 5,
    envPrefix: 'LOGIN',
    label: 'login',
  }),
} as const satisfies RuntimeConfigSection;
