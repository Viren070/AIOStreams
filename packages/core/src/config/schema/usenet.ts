import { z } from 'zod';
import { byteSize, nonNegativeInt, positiveInt, seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const MB = 1000 * 1000;
const GB = 1000 * MB;

/**
 * Bundled performance presets. A profile sets the handful of knobs that trade
 * speed for CPU/RAM/connection use together, so the engine works great out of
 * the box and power users can step up (or define a `custom` profile). Resolved
 * to `EngineOptions` in `getUsenetEngineConfig`. `custom` is intentionally absent
 * here: it means "use the individual fields".
 */
export const PERFORMANCE_PROFILES = {
  conservative: {
    prefetchSegments: 16,
    maxConcurrentDownloads: 30,
    segmentDiskCacheBytes: 1 * GB,
  },
  balanced: {
    prefetchSegments: 32,
    maxConcurrentDownloads: 0,
    segmentDiskCacheBytes: 2 * GB,
  },
  high: {
    prefetchSegments: 64,
    maxConcurrentDownloads: 0,
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
      'How hard the engine works. **balanced** (the default) is right for ' +
      'most setups. **high** downloads more aggressively — best with a fast ' +
      'connection and a powerful machine. **conservative** uses less memory ' +
      'and CPU — best for small servers and NAS boxes. **custom** lets you ' +
      'tune the individual values below yourself.',
    env: 'USENET_PERFORMANCE_PROFILE',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  maxConcurrentDownloads: {
    schema: nonNegativeInt,
    default: 0,
    label: 'Max concurrent downloads',
    description:
      'The most download requests the engine will run at the same time, ' +
      'across everything it does. **0** (the default) works this out ' +
      'automatically from your providers’ connection limits — leave it ' +
      'there unless AIOStreams is putting too much load on the machine it ' +
      'runs on, in which case set a lower number.',
    env: ['USENET_MAX_CONCURRENT_DOWNLOADS', 'USENET_MAX_DOWNLOAD_CONNECTIONS'],
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  maxConcurrentInspects: {
    schema: nonNegativeInt,
    default: 4,
    label: 'Max concurrent imports',
    description:
      'How many NZB imports may run at the same time. ' +
      'Extra imports wait in a queue, and playback-triggered imports are ' +
      'served before background adds. **0** removes the limit.',
    env: 'USENET_MAX_CONCURRENT_INSPECTS',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  prefetchSegments: {
    schema: positiveInt,
    default: 32,
    label: 'Read-ahead (segments)',
    description:
      'How many pieces of the file each stream downloads ahead of the ' +
      'current playback position. Higher values give faster, smoother ' +
      'streaming on a good connection, but use more memory per stream. ',
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
      'How strongly active playback is favoured over background work (like ' +
      'imports and health checks) when both want to download at once, from ' +
      '0 to 1. **0.8** (the default) keeps playback smooth while background ' +
      'work still makes progress; **1** means playback always goes first.',
    env: 'USENET_STREAMING_PRIORITY',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'number' as const, min: 0, hidden: true },
  },
  segmentDiskCacheBytes: {
    schema: byteSize,
    default: 2 * GB,
    label: 'Segment disk cache size',
    description:
      'How much disk space to use for keeping recently downloaded data. ' +
      'The cache survives restarts and makes seeking and re-watching ' +
      'faster. Set to **0** to disable it.',
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
      'How long to wait for one piece of a download before giving up on it and retrying elsewhere.',
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
      'How long to wait when opening a connection to a provider before giving up.',
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
      'How long to keep unused provider connections open. Keeping them ' +
      'around for a little while makes the next request start faster.',
    env: 'USENET_IDLE_CONNECTION',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const, hidden: true },
  },
  streamIdleTimeout: {
    schema: seconds,
    default: 3600,
    label: 'Stream idle timeout',
    description:
      'Close a playback stream that has sent no data for this long, so ' +
      'abandoned connections cannot hold provider connections and memory ' +
      'forever. A paused player simply reconnects when it resumes. Set to ' +
      '**0** to disable.',
    env: 'USENET_STREAM_IDLE_TIMEOUT',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const, hidden: true },
  },
  circuitBreakerThreshold: {
    schema: positiveInt,
    default: 5,
    label: 'Circuit breaker threshold',
    description:
      'How many times in a row a provider can fail before the engine ' +
      'temporarily stops using it.',
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
      'How long a failing provider is rested before the engine tries it again.',
    env: 'USENET_CIRCUIT_BREAKER_COOLDOWN',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const, hidden: true },
  },
  lazyRarResolution: {
    schema: z.boolean(),
    default: true,
    label: 'Lazy RAR resolution',
    description:
      'Makes importing large multi-part RAR releases (like season packs) ' +
      'much faster by reading some archive details on demand during ' +
      'playback instead of all up front. Leave this on unless you are ' +
      'troubleshooting a release that will not play.',
    env: 'USENET_LAZY_RAR_RESOLUTION',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  strictArchiveMembership: {
    schema: z.boolean(),
    default: false,
    label: 'Strict archive membership',
    description:
      'Some releases hide their real file names (“obfuscated” posts). ' +
      'Turning this on makes the engine identify every part of such split ' +
      'archives individually, which fixes rare cases of parts being ' +
      'matched up wrongly — at the cost of slower imports for those ' +
      'releases. Leave off unless an obfuscated release imports broken.',
    env: 'USENET_STRICT_ARCHIVE_MEMBERSHIP',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  verifyMode: {
    schema: z.enum(['none', 'census']),
    default: 'census',
    label: 'Verify mode',
    description:
      'Whether to check that a release is actually complete on your ' +
      'providers when it is imported. **census** (the default) checks every ' +
      'part of the download without slowing the import down — badly ' +
      'damaged releases are rejected straight away, and slightly damaged ' +
      'ones are handled by the damage policy below. **none** skips the ' +
      'check; broken releases will then only fail once you try to play them.',
    env: 'USENET_VERIFY_MODE',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  verifyBudgetMs: {
    schema: nonNegativeInt,
    default: 0,
    label: 'Verify budget',
    description:
      'Extra time (in milliseconds) an import may spend waiting on the ' +
      'completeness check before finishing. **0** (the default) never ' +
      'delays imports — the check simply carries on in the background. ' +
      'Raise it to catch more damage before a stream is offered, at the ' +
      'cost of slower imports.',
    env: 'USENET_VERIFY_BUDGET_MS',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  censusShadowConcurrency: {
    schema: positiveInt,
    default: 12,
    label: 'Census background concurrency',
    description:
      'How many checks run at the same time when a completeness check ' +
      'carries on in the background after an import. Lower is gentler on ' +
      'your provider connections while you are streaming; higher reaches ' +
      'the final verdict sooner.',
    env: 'USENET_CENSUS_SHADOW_CONCURRENCY',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  censusMaxLifetime: {
    schema: seconds,
    default: 1800,
    label: 'Census max lifetime',
    description:
      'The longest a completeness check may keep running before it is ' +
      'stopped. Raise this if checks on very large releases are being cut ' +
      'off before they finish.',
    env: 'USENET_CENSUS_MAX_LIFETIME',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const, hidden: true },
  },
  damagePolicy: {
    schema: z.enum(['tolerant', 'strict']),
    default: 'tolerant',
    label: 'Damage policy',
    description:
      'What to do when a release has a small amount of damage (a few ' +
      'missing pieces). **tolerant** (the default) imports it anyway, ' +
      'marked as “degraded” — playback skips over the gaps, which may show ' +
      'as a brief glitch. **strict** rejects it so a different release can ' +
      'be picked instead. Heavily damaged releases are always rejected.',
    env: 'USENET_DAMAGE_POLICY',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
  maxNzbSize: {
    schema: byteSize,
    default: 150 * MB,
    label: 'Max NZB size',
    description:
      'The largest NZB file the engine will accept — whether uploaded in ' +
      'the dashboard, grabbed from an indexer, or sent through the SABnzbd ' +
      'API. Raise it if large season packs are being rejected as too big.',
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
      'Lets apps like Sonarr, Radarr and Prowlarr send downloads to ' +
      'AIOStreams as if it were a SABnzbd download client. Point them at ' +
      '`/api/v1/sabnzbd`, with an `AIOSTREAMS_AUTH` credential in ' +
      '`username:password` form as the API key.',
    env: 'USENET_SABNZBD_API_ENABLED',
    requiresRestart: false,
    secret: false,
    ui: HIDDEN,
  },
} as const satisfies RuntimeConfigSection;
