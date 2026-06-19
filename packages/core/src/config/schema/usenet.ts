import { z } from 'zod';
import { byteSize, nonNegativeInt, positiveInt, seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const MB = 1000 * 1000;
const GB = 1000 * MB;

/**
 * Bundled performance presets. A profile sets the handful of knobs that trade
 * speed for CPU/RAM/connection use together, so the engine works great out of
 * the box and power users can step up (or define a `custom` profile). Tuned from
 * the benchmark sweep; resolved to `EngineOptions` in `getUsenetEngineConfig`.
 * `custom` is intentionally absent here — it means "use the individual fields".
 */
export const PERFORMANCE_PROFILES = {
  conservative: {
    maxConnectionsPerStream: 4,
    prefetchSegments: 16,
    segmentCacheBytes: 128 * MB,
    segmentDiskCacheBytes: 1 * GB,
  },
  balanced: {
    maxConnectionsPerStream: 10,
    prefetchSegments: 32,
    segmentCacheBytes: 256 * MB,
    segmentDiskCacheBytes: 2 * GB,
  },
  high: {
    maxConnectionsPerStream: 20,
    prefetchSegments: 64,
    segmentCacheBytes: 512 * MB,
    segmentDiskCacheBytes: 8 * GB,
  },
} as const;

export const PERFORMANCE_PROFILE_NAMES = [
  'conservative',
  'balanced',
  'high',
  'custom',
] as const;

export type PerformanceProfile = (typeof PERFORMANCE_PROFILE_NAMES)[number];

/** Hide a usenet field from the generic settings page (managed in the usenet tab). */
const HIDDEN = { hidden: true } as const;

/**
 * A single NNTP provider/account. Mirrors the engine's `ProviderConfig`
 * (packages/core/src/usenet/types.ts). Stored encrypted at rest because the
 * `providers` field is marked `secret` (passwords live here).
 */
const providerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  tls: z.boolean(),
  tlsSkipVerify: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  maxConnections: z.number().int().positive(),
  priority: z.number().int(),
  isBackup: z.boolean().optional(),
  enabled: z.boolean().optional(),
  pipelineDepth: z.number().int().min(1).max(20).optional(),
});

/** A fraction in the closed interval [0, 1]; accepts numeric env strings. */
const unitInterval = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const n = typeof value === 'string' ? Number(value.trim()) : value;
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      ctx.addIssue({
        code: 'custom',
        message: `Expected a number between 0 and 1, got ${JSON.stringify(value)}.`,
      });
      return z.NEVER;
    }
    return n;
  });

/**
 * Global, admin-only configuration for the built-in native usenet engine.
 * The service layer maps this section onto the engine's `ProviderConfig[]` and
 * `EngineOptions`; the engine itself never reads this or any UserData.
 */
export const usenetSchema = {
  providers: {
    schema: z.array(providerConfigSchema),
    default: [],
    label: 'NNTP providers',
    description: {
      ui:
        'NNTP provider accounts used by the built-in usenet engine. Passwords ' +
        'are encrypted at rest. Lower `priority` = preferred; mark metered ' +
        'block accounts as backups so they are only used when primaries miss a ' +
        'segment.',
      env:
        'JSON array of NNTP provider objects: ' +
        '{ id, name?, host, port, tls, tlsSkipVerify?, username?, password?, ' +
        'maxConnections, priority, isBackup?, enabled? }.',
    },
    env: 'USENET_PROVIDERS',
    requiresRestart: false,
    secret: true,
    // The bespoke multi-provider editor lives in the usenet dashboard, so this
    // field is hidden from the generic settings page (managed only there).
    ui: { kind: 'json' as const, hidden: true },
  },
  performanceProfile: {
    schema: z.enum(PERFORMANCE_PROFILE_NAMES),
    default: 'balanced',
    label: 'Performance profile',
    description:
      'Bundled speed/resource preset. `balanced` (default) suits a typical ' +
      'box; `high` saturates a fast link on a beefy machine; `conservative` ' +
      'is gentle on low-RAM/CPU hosts; `custom` uses the individual fields ' +
      'below. A profile sets max connections per stream, prefetch depth, and ' +
      'cache sizes together.',
    env: 'USENET_PERFORMANCE_PROFILE',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  maxDownloadConnections: {
    schema: nonNegativeInt,
    default: 0,
    label: 'Max download connections',
    description:
      'Global ceiling on concurrent article/body downloads across every ' +
      'stream. `0` (default) means auto: the sum of every enabled provider’s ' +
      'connection limit, so a single provider’s account cap is never ' +
      'artificially throttled.',
    env: 'USENET_MAX_DOWNLOAD_CONNECTIONS',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  maxConnectionsPerStream: {
    schema: positiveInt,
    default: 8,
    label: 'Max connections per stream',
    description:
      'Max parallel segment fetches for a single playback/stream (used when ' +
      'the performance profile is `custom`).',
    env: 'USENET_MAX_CONNECTIONS_PER_STREAM',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  prefetchSegments: {
    schema: positiveInt,
    default: 32,
    label: 'Prefetch depth (segments)',
    description:
      'How far ahead of the read cursor a stream prefetches, in segments ' +
      '(buffer = this × ~segment size). Higher rides out latency jitter at the ' +
      'cost of memory. Used when the performance profile is `custom`.',
    env: 'USENET_PREFETCH_SEGMENTS',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  streamingPriority: {
    schema: unitInterval,
    default: 0.8,
    label: 'Streaming priority share',
    description:
      'When playback and background work (inspect/health/import) compete for the ' +
      'same connections, the share (0–1) of grants given to playback; the rest go ' +
      'to background so it keeps progressing instead of being starved. `0.8` ' +
      '(default) strongly favours playback while letting imports advance; `1` = ' +
      'strict — playback always wins. Only applies under contention.',
    env: 'USENET_STREAMING_PRIORITY',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'number' as const, min: 0, hidden: true },
  },
  segmentCacheBytes: {
    schema: byteSize,
    default: 256 * MB,
    label: 'Segment cache size',
    description:
      'In-memory decoded-segment cache size. Accepts plain bytes or `256MB`-style strings.',
    env: 'USENET_SEGMENT_CACHE_BYTES',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  segmentDiskCacheBytes: {
    schema: byteSize,
    default: 2 * GB,
    label: 'Segment disk cache size',
    description:
      'On-disk decoded-segment overflow cache size (survives restarts). Set to ' +
      '`0` to disable the disk tier. Accepts plain bytes or `2GB`-style strings.',
    env: 'USENET_SEGMENT_DISK_CACHE_BYTES',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  segmentTimeout: {
    schema: seconds,
    default: 30,
    label: 'Segment timeout',
    description:
      'Per-command/segment hard timeout. Accepts seconds or a duration string (e.g. 30s, 1m).',
    env: 'USENET_SEGMENT_TIMEOUT',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const, hidden: true },
  },
  dialTimeout: {
    schema: seconds,
    default: 15,
    label: 'Dial timeout',
    description:
      'TCP/TLS connection dial timeout. Accepts seconds or a duration string (e.g. 15s).',
    env: 'USENET_DIAL_TIMEOUT',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const, hidden: true },
  },
  idleConnection: {
    schema: seconds,
    default: 60,
    label: 'Idle connection TTL',
    description:
      'How long an idle connection is kept before it is purged. Accepts seconds or a duration string (e.g. 1m).',
    env: 'USENET_IDLE_CONNECTION',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const, hidden: true },
  },
  circuitBreakerThreshold: {
    schema: positiveInt,
    default: 5,
    label: 'Circuit breaker threshold',
    description:
      'Consecutive failures before a provider circuit-breaker trips and the ' +
      'provider is briefly taken out of rotation.',
    env: 'USENET_CIRCUIT_BREAKER_THRESHOLD',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  circuitBreakerCooldown: {
    schema: seconds,
    default: 30,
    label: 'Circuit breaker cooldown',
    description:
      'Cooldown before a tripped provider is probed again. Accepts seconds or a duration string (e.g. 30s).',
    env: 'USENET_CIRCUIT_BREAKER_COOLDOWN',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const, hidden: true },
  },
  failArchivedResults: {
    schema: z.boolean(),
    default: false,
    label: 'Fail archived results',
    description:
      'Treat any archived (RAR/7z) result as non-streamable and skip it ' +
      'entirely, rather than attempting stored-archive streaming.',
    env: 'USENET_FAIL_ARCHIVED_RESULTS',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  failNestedArchives: {
    schema: z.boolean(),
    default: false,
    label: 'Fail nested archives',
    description:
      'When a streamable file is itself nested inside another archive, fail ' +
      'instantly instead of opening the nested archive (which adds first-byte ' +
      'latency). Enabled by default: best-effort nested playback (one level, ' +
      'RAR/7z either direction). Set true to prefer fast failover instead.',
    env: 'USENET_FAIL_NESTED_ARCHIVES',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  lazyRarResolution: {
    schema: z.boolean(),
    default: true,
    label: 'Lazy RAR resolution',
    description:
      'For multi-volume RAR sets whose exact volume sizes are recoverable ' +
      'from PAR2 descriptors, skip the middle-volume probes at import and ' +
      'read each volume header on first touch during playback instead — ' +
      'season-pack imports drop from one fetch per volume to roughly one per ' +
      'inner file. Disable to restore exhaustive per-volume probing.',
    env: 'USENET_LAZY_RAR_RESOLUTION',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  maxNzbSize: {
    schema: byteSize,
    default: 150 * MB,
    label: 'Max NZB size',
    description:
      'Largest accepted .nzb file, applied to dashboard uploads, the SABnzbd ' +
      'API and indexer grabs alike. Season packs of split archives can reach ' +
      'tens of MB; raise this if imports are rejected as too large. Accepts ' +
      'plain bytes or `150MB`-style strings.',
    env: 'USENET_MAX_NZB_SIZE',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  sabnzbdApiEnabled: {
    schema: z.boolean(),
    default: true,
    label: 'SABnzbd-compatible API',
    description:
      'Serve a SABnzbd-compatible API at `/api/v1/sabnzbd/api` so tools like ' +
      'Sonarr, Radarr and Prowlarr can send NZBs to the built-in usenet ' +
      'engine as if it were a SABnzbd download client (use `/api/v1/sabnzbd` ' +
      'as the client’s URL base). The `apikey` is an `AIOSTREAMS_AUTH` ' +
      'credential in `username:password` form.',
    env: 'USENET_SABNZBD_API_ENABLED',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
} as const satisfies RuntimeConfigSection;
