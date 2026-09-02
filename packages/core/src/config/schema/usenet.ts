import { z } from 'zod';
import { byteSize, nonNegativeInt, positiveInt, seconds } from './helpers.js';
import { parseTime } from '../../utils/time.js';
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

/** Recheck cadence by NZB post age: max age -> interval, `*` for older. */
export const RECHECK_DEFAULT_SCHEDULE: Record<string, string> = {
  '1d': '1h',
  '7d': '6h',
  '30d': '1d',
  '*': '30d',
};

function isDuration(value: string): boolean {
  try {
    return parseTime(value) > 0;
  } catch {
    return false;
  }
}

/**
 * Accepts the stored record shape or the env form `1d:1h, 7d:6h, *:7d`.
 * Keys are maximum ages (or `*`); values are intervals or `never`.
 */
const recheckSchedule = z
  .union([
    z.record(z.string(), z.string()),
    z.string().transform((value, ctx) => {
      const trimmed = value.trim();
      if (!trimmed) return { ...RECHECK_DEFAULT_SCHEDULE };
      const out: Record<string, string> = {};
      for (const pair of trimmed.split(',')) {
        const [key, interval] = pair.split(':').map((s) => s.trim());
        if (!key || !interval) {
          ctx.addIssue({
            code: 'custom',
            message: `Invalid recheck schedule entry "${pair.trim()}". Expected age:interval, e.g. 7d:6h.`,
          });
          return z.NEVER;
        }
        out[key] = interval;
      }
      return out;
    }),
  ])
  .superRefine((schedule, ctx) => {
    for (const [key, interval] of Object.entries(schedule)) {
      if (key !== '*' && !isDuration(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid recheck age "${key}". Use a duration like 7d, or * for everything older.`,
        });
      }
      if (interval !== 'never' && !isDuration(interval)) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid recheck interval "${interval}" for "${key}". Use a duration like 6h, or never.`,
        });
      }
    }
  });

/** `HH:MM-HH:MM` in local time, or empty for "any hour". */
const recheckWindow = z.string().refine(
  (value) => {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (!match) return false;
    const [h1, m1, h2, m2] = match.slice(1).map(Number);
    return h1 < 24 && h2 < 24 && m1 < 60 && m2 < 60;
  },
  {
    message:
      'Invalid recheck window. Use `HH:MM-HH:MM` (e.g. 02:00-08:00), or leave it empty.',
  }
);

/**
 * Read-ahead ceiling: past ~2x the connection count it only buys buffer
 * depth, at ~3x prefetch x segment size of memory per stream and a full
 * re-fetch of it on every seek.
 */
const MAX_PREFETCH_SEGMENTS = 256;

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
  },
  prefetchSegments: {
    schema: positiveInt.refine((n) => n <= MAX_PREFETCH_SEGMENTS, {
      message: `Expected at most ${MAX_PREFETCH_SEGMENTS}.`,
    }),
    default: 32,
    label: 'Read-ahead (segments)',
    description:
      'How many pieces of the file each stream downloads ahead of the ' +
      'current playback position, up to ' +
      MAX_PREFETCH_SEGMENTS +
      '. Higher values ride out provider stalls better, but use more memory ' +
      'per stream and re-fetch the whole read-ahead on every seek.',
    env: 'USENET_PREFETCH_SEGMENTS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1, max: MAX_PREFETCH_SEGMENTS },
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
    ui: { kind: 'number' as const, min: 0.5, max: 1, step: 0.01 },
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
  },
  segmentTimeout: {
    schema: seconds,
    default: 30,
    label: 'Segment timeout',
    description:
      'How long to wait for one piece of a download before giving up on it ' +
      'and retrying elsewhere. Set to **0** to never give up on a piece that ' +
      'is still downloading.',
    env: 'USENET_SEGMENT_TIMEOUT',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const },
  },
  segmentStallTimeout: {
    schema: seconds,
    default: 30,
    label: 'Segment stall timeout',
    description:
      'How long to wait with no data arriving for a piece before dropping ' +
      'the connection and retrying. This catches connections that have hung ' +
      'or gone dead.',
    env: 'USENET_SEGMENT_STALL_TIMEOUT',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const },
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
    ui: { kind: 'duration' as const },
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
    ui: { kind: 'duration' as const },
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
    ui: { kind: 'duration' as const },
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
    ui: { kind: 'duration' as const },
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
    ui: { kind: 'duration' as const },
  },
  damagePolicy: {
    schema: z.enum(['tolerant', 'strict']),
    default: 'strict',
    label: 'Damage policy',
    description:
      'What to do with slightly damaged releases (a few missing pieces). ' +
      '**strict** (the default) rejects them when the damage is caught in ' +
      'time, so another release is picked instead; damage that only shows ' +
      'up during playback is glitched over, and the release is not ' +
      'offered again afterwards. **tolerant** keeps damaged releases on ' +
      'offer, glitching over the gaps on every play. Heavy damage is ' +
      'always rejected and will stop playback if it only turns up ' +
      'mid-play.',
    env: 'USENET_DAMAGE_POLICY',
    requiresRestart: false,
    secret: false,
  },
  matroskaHoleFill: {
    schema: z.boolean(),
    default: true,
    label: 'Matroska hole repair',
    description:
      'When part of an MKV release is missing on every provider, rewrite ' +
      'the gap into valid Matroska padding instead of raw zeros, so players ' +
      'skip the damaged seconds instead of stopping playback with an error.',
    env: 'USENET_MATROSKA_HOLE_FILL',
    requiresRestart: false,
    secret: false,
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
  },
  verifyContent: {
    schema: z.boolean(),
    default: false,
    label: 'Verify file contents',
    description:
      'After the article audit passes, read the first few kilobytes of each ' +
      'video file and check it really is the container its name claims. The ' +
      'audit only proves the articles exist — this catches a release that ' +
      'was posted or assembled wrong. Costs about one article per file, at ' +
      'import and on every recheck.',
    env: 'USENET_VERIFY_CONTENT',
    requiresRestart: false,
    secret: false,
  },
  arrWaitForCensus: {
    schema: z.boolean(),
    default: false,
    label: 'Hold SABnzbd hand-off for the census',
    description:
      'Report a download added through the SABnzbd API as still ' +
      'downloading until its background article census has finished, so ' +
      'the client never imports a release the audit is about to fail. Off ' +
      '(the default) hands the release over as soon as the quick inspect ' +
      'passes; a failure the census finds later is repaired through the ' +
      'linked Sonarr/Radarr instance. This covers everything that adds ' +
      'through the API — Sonarr, Radarr, NZBHydra, an interactive grab — ' +
      'not only linked instances.',
    env: 'USENET_ARR_WAIT_FOR_CENSUS',
    requiresRestart: false,
    secret: false,
  },
  arrCensusHoldTimeout: {
    schema: seconds,
    default: 60,
    label: 'Census hold timeout',
    description:
      'The longest the census hold keeps a SABnzbd-API download reported ' +
      'as downloading. Past this the release is handed over while the check ' +
      'finishes in the background; a failure found later is repaired through ' +
      'the linked Sonarr/Radarr instance instead. Only applies when an ' +
      'instance is linked — without one there is no repair path, so the ' +
      'hold lasts the whole census however the download was added.',
    env: 'USENET_ARR_CENSUS_HOLD_TIMEOUT',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' as const },
  },
  recheck: {
    scope: {
      schema: z.enum(['off', 'sabnzbd', 'all']),
      default: 'off',
      label: 'Library recheck',
      description:
        'Periodically re-verify library entries against your providers, so ' +
        'a release taken down after it was added is marked failed (and, when ' +
        'a linked Sonarr/Radarr grabbed it, replaced) instead of staying ' +
        'playable on paper. `sabnzbd` rechecks only entries added through ' +
        'the SABnzbd API, whatever added them; `all` also covers entries ' +
        'added by playback and from the dashboard.',
      env: 'USENET_RECHECK_SCOPE',
      requiresRestart: false,
      secret: false,
    },
    schedule: {
      schema: recheckSchedule,
      default: RECHECK_DEFAULT_SCHEDULE,
      label: 'Recheck schedule',
      description:
        'How often to recheck, by NZB post age. Each key is a maximum age ' +
        'and its value the interval for entries up to that age; `*` covers ' +
        'everything older. Use `never` to stop rechecking a band. New posts ' +
        'are the ones that get taken down, so they deserve the shortest ' +
        'intervals. Env form: `1d:1h, 7d:6h, 30d:1d, *:30d`.',
      env: 'USENET_RECHECK_SCHEDULE',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'map', mapValueKind: 'string' },
    },
    depth: {
      schema: z.enum(['sample', 'full']),
      default: 'sample',
      label: 'Recheck depth',
      description:
        '`sample` checks a spread of articles (see the sample size) and only ' +
        'audits the whole release when it finds something missing; `full` ' +
        'audits every article on every recheck.',
      env: 'USENET_RECHECK_DEPTH',
      requiresRestart: false,
      secret: false,
    },
    sampleSegments: {
      schema: positiveInt,
      default: 64,
      label: 'Recheck sample size',
      description:
        'Articles probed per entry in `sample` depth. A takedown removes the ' +
        'whole post, so a few dozen is plenty; raise it to catch partial ' +
        'damage sooner.',
      env: 'USENET_RECHECK_SAMPLE_SEGMENTS',
      requiresRestart: false,
      secret: false,
    },
    concurrency: {
      schema: positiveInt,
      default: 2,
      label: 'Recheck concurrency',
      description: 'Entries rechecked at the same time.',
      env: 'USENET_RECHECK_CONCURRENCY',
      requiresRestart: false,
      secret: false,
    },
    batchSize: {
      schema: positiveInt,
      default: 20,
      label: 'Recheck batch size',
      description:
        'Entries picked up per run of the recheck task (every 5 minutes).',
      env: 'USENET_RECHECK_BATCH_SIZE',
      requiresRestart: false,
      secret: false,
    },
    window: {
      schema: recheckWindow,
      default: '',
      label: 'Recheck hours',
      description:
        'Only recheck during these hours, as `HH:MM-HH:MM` in the server’s ' +
        'local time. A range that wraps past midnight (`22:00-06:00`) is ' +
        'fine. Leave empty to recheck at any hour.',
      env: 'USENET_RECHECK_WINDOW',
      requiresRestart: false,
      secret: false,
    },
  },
} as const satisfies RuntimeConfigSection;
