import { z } from 'zod';
import { cacheTtlMap, positiveInt, seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const optionalPositiveInt = z.union([z.number().int().positive(), z.null()]);
const ttlField = cacheTtlMap;

/**
 * Stored stream URL mapping shape.
 */
const streamUrlMappings = z.union([
  z.record(z.string(), z.string()),
  z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (!trimmed) return {} as Record<string, string>;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Stream URL mappings must be a JSON object.',
      });
      return z.NEVER;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Stream URL mappings must be a JSON object.',
      });
      return z.NEVER;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        ctx.addIssue({
          code: 'custom',
          message: `Stream URL mapping values must be strings (key "${k}").`,
        });
        return z.NEVER;
      }
      try {
        const ku = new URL(k.replace(/\/$/, ''));
        const vu = new URL(v.replace(/\/$/, ''));
        out[ku.origin] = vu.origin;
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid URL in mapping: "${k}" → "${v}".`,
        });
        return z.NEVER;
      }
    }
    return out;
  }),
]);

/**
 * Stremio resource fetching: timeouts, background prefetch, per-resource
 * caches, and incoming stream-URL rewrites.
 */
export const resourcesSchema = {
  streamUrlMappings: {
    schema: streamUrlMappings,
    default: {} as Record<string, string>,
    label: 'Stream URL mappings',
    description:
      'Origin-level rewrites applied to stream URLs returned to clients. JSON object of `{origin: replacement}` URLs.',
    env: 'STREAM_URL_MAPPINGS',
    requiresRestart: false,
    secret: false,
  },
  timeouts: {
    manifest: {
      schema: positiveInt,
      default: 3000,
      label: 'Manifest timeout (ms)',
      description:
        'Timeout for `/manifest.json` fetches (milliseconds). Slower manifest operations use the increased timeout below.',
      env: 'MANIFEST_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
    manifestIncreased: {
      schema: positiveInt,
      default: 10000,
      label: 'Manifest increased timeout (ms)',
      description:
        'Extended timeout used during slower manifest operations (milliseconds).',
      env: 'MANIFEST_INCREASED_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
    meta: {
      schema: positiveInt,
      default: 30000,
      label: 'Meta timeout (ms)',
      description: 'Timeout for `/meta` requests (milliseconds).',
      env: 'META_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
    catalog: {
      schema: positiveInt,
      default: 30000,
      label: 'Catalog timeout (ms)',
      description: 'Timeout for `/catalog/*` fetches (milliseconds).',
      env: 'CATALOG_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
  },
  precache: {
    nextEpisodeMinInterval: {
      schema: seconds,
      default: 86400,
      label: 'Precache next-episode min interval',
      description:
        'Minimum interval before re-attempting to precache the same next episode (accepts e.g. "30m", "1h").',
      env: 'PRECACHE_NEXT_EPISODE_MIN_INTERVAL',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'duration' },
    },
  },
  preload: {
    minInterval: {
      schema: seconds,
      default: 3600,
      label: 'Preload min interval',
      description:
        'Minimum interval between preload operations for the same item per user (0 disables the cooldown).',
      env: 'PRELOAD_MIN_INTERVAL',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'duration' },
    },
    streamsConcurrency: {
      schema: positiveInt,
      default: 5,
      label: 'Preload streams concurrency',
      description: 'Maximum simultaneous stream preload requests.',
      env: 'PRELOAD_STREAMS_CONCURRENCY',
      requiresRestart: false,
      secret: false,
    },
  },
  background: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'Background resource requests enabled',
      description:
        'Issue resource requests in the background to keep caches warm.',
      env: 'BACKGROUND_RESOURCE_REQUESTS_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Background request timeout (ms)',
      description:
        'Timeout for background resource requests (milliseconds). When unset, the maximum HTTP timeout is used.',
      env: 'BACKGROUND_RESOURCE_REQUEST_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
  },
  cache: {
    defaultMaxSize: {
      schema: positiveInt,
      default: 100000,
      label: 'Default max cache size',
      description: 'Default maximum number of items per cache instance.',
      env: 'DEFAULT_MAX_CACHE_SIZE',
      requiresRestart: true,
      secret: false,
    },
    sqlMaxSize: {
      schema: positiveInt,
      default: 100000,
      label: 'SQL cache max size',
      description: 'Maximum number of items in the shared SQL cache.',
      env: 'SQL_CACHE_MAX_SIZE',
      requiresRestart: true,
      secret: false,
    },
    manifest: {
      ttl: {
        schema: ttlField,
        default: { '*': 21600 } as Record<string, number>,
        label: 'Manifest cache TTL (s)',
        description:
          'Per-key cache TTL for manifest responses (seconds; -1 disables). Env shape: integer or `key:value,...`.',
        env: 'MANIFEST_CACHE_TTL',
        requiresRestart: false,
        secret: false,
      },
      maxSize: {
        schema: optionalPositiveInt,
        default: null,
        label: 'Manifest cache max size',
        description: 'Maximum number of cached manifests.',
        env: 'MANIFEST_CACHE_MAX_SIZE',
        requiresRestart: true,
        secret: false,
      },
    },
    subtitle: {
      ttl: {
        schema: ttlField,
        default: { '*': 300 } as Record<string, number>,
        label: 'Subtitle cache TTL (s)',
        description:
          'Per-key cache TTL for subtitle responses (seconds; -1 disables).',
        env: 'SUBTITLE_CACHE_TTL',
        requiresRestart: false,
        secret: false,
      },
      maxSize: {
        schema: optionalPositiveInt,
        default: null,
        label: 'Subtitle cache max size',
        description: 'Maximum number of cached subtitle responses.',
        env: 'SUBTITLE_CACHE_MAX_SIZE',
        requiresRestart: true,
        secret: false,
      },
    },
    stream: {
      ttl: {
        schema: ttlField,
        default: { '*': -1 } as Record<string, number>,
        label: 'Stream cache TTL (s)',
        description:
          'Per-key cache TTL for stream responses (seconds; -1 disables, the default).',
        env: 'STREAM_CACHE_TTL',
        requiresRestart: false,
        secret: false,
      },
      maxSize: {
        schema: optionalPositiveInt,
        default: null,
        label: 'Stream cache max size',
        description: 'Maximum number of cached stream responses.',
        env: 'STREAM_CACHE_MAX_SIZE',
        requiresRestart: true,
        secret: false,
      },
    },
    catalog: {
      ttl: {
        schema: ttlField,
        default: { '*': 300 } as Record<string, number>,
        label: 'Catalog cache TTL (s)',
        description:
          'Per-key cache TTL for catalog responses (seconds; -1 disables).',
        env: 'CATALOG_CACHE_TTL',
        requiresRestart: false,
        secret: false,
      },
      maxSize: {
        schema: optionalPositiveInt,
        default: 1000,
        label: 'Catalog cache max size',
        description: 'Maximum number of cached catalog responses.',
        env: 'CATALOG_CACHE_MAX_SIZE',
        requiresRestart: true,
        secret: false,
      },
    },
    meta: {
      ttl: {
        schema: ttlField,
        default: { '*': 300 } as Record<string, number>,
        label: 'Meta cache TTL (s)',
        description:
          'Per-key cache TTL for meta responses (seconds; -1 disables).',
        env: 'META_CACHE_TTL',
        requiresRestart: false,
        secret: false,
      },
      maxSize: {
        schema: optionalPositiveInt,
        default: null,
        label: 'Meta cache max size',
        description: 'Maximum number of cached meta responses.',
        env: 'META_CACHE_MAX_SIZE',
        requiresRestart: true,
        secret: false,
      },
    },
    addonCatalog: {
      ttl: {
        schema: ttlField,
        default: { '*': 300 } as Record<string, number>,
        label: 'Addon catalog cache TTL (s)',
        description:
          'Per-key cache TTL for addon-catalog responses (seconds; -1 disables).',
        env: 'ADDON_CATALOG_CACHE_TTL',
        requiresRestart: false,
        secret: false,
      },
      maxSize: {
        schema: optionalPositiveInt,
        default: null,
        label: 'Addon catalog cache max size',
        description: 'Maximum number of cached addon-catalog responses.',
        env: 'ADDON_CATALOG_CACHE_MAX_SIZE',
        requiresRestart: true,
        secret: false,
      },
    },
  },
} as const satisfies RuntimeConfigSection;
