import { z } from 'zod';
import {
  byteSize,
  cacheTtlMap,
  commaSeparatedList,
  nonNegativeInt,
  positiveInt,
  seconds,
} from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';
import { DEFAULT_REPOST_SUFFIXES } from '../../utils/constants.js';

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
  repostSuffixes: {
    schema: commaSeparatedList,
    default: DEFAULT_REPOST_SUFFIXES,
    label: 'Repost suffixes',
    description:
      'Tags that reposters and indexers add after the release group, such as `-FTP` or `-AsRequested`. They are ignored when parsing file and folder names, so the real release group is found. End an entry with `*` to match anything that starts with it, e.g. `Rakuv*`.',
    env: 'REPOST_SUFFIXES',
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
    maxConcurrent: {
      schema: positiveInt,
      default: 50,
      label: 'Max concurrent background requests',
      description:
        'Maximum resource requests allowed to keep running after the client has already timed out. Beyond this, an abandoned request is cancelled instead of being left to warm the cache, which bounds how many connections a client that retries without backoff can tie up.',
      env: 'MAX_BACKGROUND_RESOURCE_REQUESTS',
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
    maxValueBytes: {
      schema: byteSize,
      default: 2 * 1000 * 1000,
      label: 'Max cached value size',
      description:
        'Largest single value written to the Redis or SQL cache (`0` disables the limit). On Redis this is the stored size, so values large enough to be compressed are measured after compression. Oversized entries are skipped rather than stored. A skipped entry is recomputed on each request, so raising this trades memory for CPU. Accepts plain bytes or `2MB`-style strings.',
      env: 'MAX_CACHE_VALUE_BYTES',
      requiresRestart: false,
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
        ui: {
          min: -1,
        },
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
      failureTtl: {
        schema: nonNegativeInt,
        default: 60,
        label: 'Manifest failure cache TTL (s)',
        description:
          'How long a failed manifest fetch is remembered (seconds; 0 disables). Without this, an addon whose manifest has never succeeded is re-fetched on every request and costs a full manifest timeout each time. A successful fetch clears the entry immediately, and saving a configuration always re-checks.',
        env: 'MANIFEST_FAILURE_CACHE_TTL',
        requiresRestart: false,
        secret: false,
        ui: {
          min: 0,
        },
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
        ui: {
          min: -1,
        },
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
        ui: {
          min: -1,
        },
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
    pipeline: {
      ttl: {
        schema: nonNegativeInt,
        default: 0,
        label: 'Pipeline cache TTL (s)',
        description:
          'TTL for the full-pipeline result cache (seconds). Caches the final processed response (streams, statistics and errors) for a whole request, keyed per user. Unlike the per-addon stream cache, this returns the previous response verbatim, including any partial errors, and does not re-fetch or retry failed addons within the TTL. Set to 0 to disable.',
        env: 'PIPELINE_CACHE_TTL',
        requiresRestart: false,
        secret: false,
        ui: {
          min: 0,
        },
      },
      maxSize: {
        schema: positiveInt,
        default: 1000,
        label: 'Pipeline cache max size',
        description: 'Maximum number of cached pipeline results.',
        env: 'PIPELINE_CACHE_MAX_SIZE',
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
        ui: {
          min: -1,
        },
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
        ui: {
          min: -1,
        },
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
        ui: {
          min: -1,
        },
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
