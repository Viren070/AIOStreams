import { z } from 'zod';
import {
  byteSize,
  commaSeparatedList,
  positiveInt,
  seconds,
} from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/**
 * Operator-imposed limits and access controls applied to user configurations.
 *
 * Subsections group related concerns:
 * - top-level: numeric config-count limits applied during validation.
 * - `timeouts`: min/max bounds for user-configurable HTTP timeouts.
 * - `regex`: regex-filter access policy + whitelisted patterns.
 * - `sel`: SEL sync access + whitelisted URLs + stream-expression limits.
 * - `variants`: config-variant access policy + script/instruction limits.
 * - `healthChecks`: health-check access policy + fetch limits.
 * - `sync`: shared refresh interval for whitelisted regex/SEL syncs.
 * - `disabled`: hard-disabled addons/services/hosts/stream-types.
 * - `selfScraping`: prevents addons from scraping the same AIOStreams instance.
 * - `trusted`: list of trusted user UUIDs.
 */
const accessLevel = z.enum(['none', 'trusted', 'all']);
const selAccessLevel = z.enum(['all', 'trusted']);

const stringList = z.array(z.string());
const nullableString = z.string().nullable();

/**
 * A `Record<string, string>` of `target → reason`.
 *
 * Accepts either the record shape directly (DB-stored / settings-UI form) or
 * the env string format `target:reason,target:reason,...` (reason optional;
 * everything after the first colon is the reason so reasons may contain colons).
 */
const reasonMap = z.union([
  z.record(z.string(), z.string()),
  z.string().transform((value) => {
    const out: Record<string, string> = {};
    if (!value.trim()) return out;
    for (const entry of value.split(',')) {
      const [key, ...reasonParts] = entry.split(':');
      const trimmedKey = key?.trim();
      if (!trimmedKey) continue;
      out[trimmedKey] = reasonParts.join(':').trim();
    }
    return out;
  }),
]);
const emptyReasonMap = {} as Record<string, string>;

export const userLimitsSchema = {
  maxAddons: {
    schema: positiveInt,
    default: 15,
    label: 'Max addons',
    description: 'Maximum number of addons a user configuration can install.',
    env: 'MAX_ADDONS',
    requiresRestart: false,
    secret: false,
  },
  maxKeywordFilters: {
    schema: positiveInt,
    default: 30,
    label: 'Max keyword filters',
    description: 'Maximum number of keyword filters per keyword filter group.',
    env: 'MAX_KEYWORD_FILTERS',
    requiresRestart: false,
    secret: false,
  },
  maxFormatterTemplateLength: {
    schema: positiveInt,
    default: 5000,
    label: 'Max formatter template length',
    description:
      'Maximum length (characters) of a single formatter template string. Enforced during config validation.',
    env: 'MAX_FORMATTER_TEMPLATE_LENGTH',
    requiresRestart: false,
    secret: false,
  },
  maxFailoverAttempts: {
    schema: positiveInt,
    default: 5,
    label: 'Max failover attempts',
    description:
      'Maximum total failover attempts (after de-duplication) a user can configure.',
    env: ['MAX_FAILOVER_ATTEMPTS', 'MAX_NZB_FAILOVER_COUNT'],
    requiresRestart: false,
    secret: false,
  },
  maxParallelAttempts: {
    schema: positiveInt,
    default: 2,
    label: 'Max parallel failover attempts',
    description:
      'Maximum concurrent failover attempts a user can configure. Caps load on upstream providers.',
    env: 'MAX_PARALLEL_ATTEMPTS',
    requiresRestart: false,
    secret: false,
  },
  maxGroups: {
    schema: positiveInt,
    default: 20,
    label: 'Max groups',
    description: 'Maximum number of stream groups in a user configuration.',
    env: 'MAX_GROUPS',
    requiresRestart: false,
    secret: false,
  },
  maxMergedCatalogSources: {
    schema: positiveInt,
    default: 10,
    label: 'Max merged catalog sources',
    description: 'Maximum source catalogs in a single merged catalog.',
    env: 'MAX_MERGED_CATALOG_SOURCES',
    requiresRestart: false,
    secret: false,
  },
  maxBackgroundPings: {
    schema: positiveInt,
    default: 2,
    label: 'Max background pings',
    description:
      'Maximum streams pinged in a background preload/precache operation.',
    env: 'MAX_BACKGROUND_PINGS',
    requiresRestart: false,
    secret: false,
  },
  timeouts: {
    minTimeout: {
      schema: positiveInt,
      default: 1000,
      label: 'Minimum allowed timeout (ms)',
      description:
        'Lower bound (milliseconds) for any user-configurable HTTP timeout.',
      env: 'MIN_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
    maxTimeout: {
      schema: positiveInt,
      default: 50000,
      label: 'Maximum allowed timeout (ms)',
      description:
        'Upper bound (milliseconds) for any user-configurable HTTP timeout.',
      env: 'MAX_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
  },
  regex: {
    access: {
      schema: accessLevel,
      default: 'trusted',
      label: 'Regex filter access',
      description:
        'Who can use regex filters: "none", "trusted" (only trusted UUIDs), or "all".',
      env: 'REGEX_FILTER_ACCESS',
      requiresRestart: false,
      secret: false,
    },
    patterns: {
      schema: stringList,
      default: [],
      label: 'Whitelisted regex patterns',
      description: 'Regex patterns whitelisted for non-trusted users.',
      env: 'WHITELISTED_REGEX_PATTERNS',
      requiresRestart: false,
      secret: false,
    },
    patternsUrls: {
      schema: stringList,
      default: [],
      label: 'Whitelisted regex pattern sync URLs',
      description:
        'URLs from which to fetch additional whitelisted regex patterns periodically.',
      env: 'WHITELISTED_REGEX_PATTERNS_URLS',
      requiresRestart: false,
      secret: false,
    },
    patternsDescription: {
      schema: nullableString,
      default: null,
      label: 'Whitelisted regex patterns description',
      description:
        'Free-form description shown alongside the whitelisted regex patterns.',
      env: 'WHITELISTED_REGEX_PATTERNS_DESCRIPTION',
      requiresRestart: false,
      secret: false,
    },
  },
  sel: {
    access: {
      schema: selAccessLevel,
      default: 'trusted',
      label: 'SEL sync access',
      description:
        '"all" = anyone can sync from any URL; "trusted" = non-trusted users limited to whitelisted SEL URLs.',
      env: 'SEL_SYNC_ACCESS',
      requiresRestart: false,
      secret: false,
    },
    urls: {
      schema: stringList,
      default: [],
      label: 'Whitelisted SEL sync URLs',
      description:
        'Stream Expression Language sync URLs that non-trusted users may use.',
      env: 'WHITELISTED_SEL_URLS',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'list' },
    },
    maxExpressions: {
      schema: positiveInt,
      default: 200,
      label: 'Max stream expressions',
      description: 'Maximum total stream expressions across all filter types.',
      env: 'MAX_STREAM_EXPRESSIONS',
      requiresRestart: false,
      secret: false,
    },
    maxExpressionCharacters: {
      schema: positiveInt,
      default: 50000,
      label: 'Max stream expression characters',
      description:
        'Maximum total character count across all stream expressions.',
      env: 'MAX_STREAM_EXPRESSIONS_TOTAL_CHARACTERS',
      requiresRestart: false,
      secret: false,
    },
    maxExpressionLength: {
      schema: positiveInt,
      default: 3000,
      label: 'Max stream expression length',
      description:
        'Maximum length (characters) of a single stream expression. Enforced during config validation.',
      env: 'MAX_SEL_LENGTH',
      requiresRestart: false,
      secret: false,
    },
  },
  variants: {
    access: {
      schema: accessLevel,
      default: 'all',
      label: 'Config variant access',
      description:
        'Who may define config variants. "all" = everyone, "trusted" = trusted users only, "none" = the feature is disabled.',
      env: 'VARIANT_ACCESS',
      requiresRestart: false,
      secret: false,
    },
    max: {
      schema: positiveInt,
      default: 10,
      label: 'Max config variants',
      description: 'Maximum number of config variants a user may define.',
      env: 'MAX_VARIANTS',
      requiresRestart: false,
      secret: false,
    },
    maxScriptLength: {
      schema: positiveInt,
      default: 4000,
      label: 'Max variant script length',
      description:
        'Maximum length (characters) of a single variant script. Enforced during config validation.',
      env: 'MAX_VARIANT_SCRIPT_LENGTH',
      requiresRestart: false,
      secret: false,
    },
    maxTotalScriptCharacters: {
      schema: positiveInt,
      default: 20000,
      label: 'Max variant script characters',
      description:
        'Maximum total character count across every variant script in a configuration.',
      env: 'MAX_VARIANT_TOTAL_SCRIPT_CHARACTERS',
      requiresRestart: false,
      secret: false,
    },
    maxInstructions: {
      schema: positiveInt,
      default: 100,
      label: 'Max variant instructions',
      description: 'Maximum number of instructions in a single variant script.',
      env: 'MAX_VARIANT_INSTRUCTIONS',
      requiresRestart: false,
      secret: false,
    },
    maxActive: {
      schema: positiveInt,
      default: 4,
      label: 'Max active variants',
      description:
        'Maximum number of variants that may be combined on a single request.',
      env: 'MAX_ACTIVE_VARIANTS',
      requiresRestart: false,
      secret: false,
    },
    maxDepth: {
      schema: positiveInt,
      default: 5,
      label: 'Max variant nesting depth',
      description:
        'Maximum depth a variant may nest others through "use variant".',
      env: 'MAX_VARIANT_DEPTH',
      requiresRestart: false,
      secret: false,
    },
    maxPathMatches: {
      schema: positiveInt,
      default: 200,
      label: 'Max variant path matches',
      description:
        'Maximum number of places a single variant instruction may write to.',
      env: 'MAX_VARIANT_PATH_MATCHES',
      requiresRestart: false,
      secret: false,
    },
    maxValueDepth: {
      schema: positiveInt,
      default: 10,
      label: 'Max variant value depth',
      description:
        'Maximum nesting depth of an object or array literal in a variant script.',
      env: 'MAX_VARIANT_VALUE_DEPTH',
      requiresRestart: false,
      secret: false,
    },
    maxPathSegments: {
      schema: positiveInt,
      default: 12,
      label: 'Max variant path segments',
      description:
        'Maximum number of segments in a single variant instruction path.',
      env: 'MAX_VARIANT_PATH_SEGMENTS',
      requiresRestart: false,
      secret: false,
    },
  },
  healthChecks: {
    access: {
      schema: accessLevel,
      default: 'all',
      label: 'Health check access',
      description:
        'Who may define health checks, the URLs polled to decide whether a service is up. "all" = everyone, "trusted" = trusted users only, "none" = the feature is disabled.',
      env: 'HEALTH_CHECK_ACCESS',
      requiresRestart: false,
      secret: false,
    },
    max: {
      schema: positiveInt,
      default: 5,
      label: 'Max health checks',
      description: 'Maximum number of health checks a user may define.',
      env: 'MAX_HEALTH_CHECKS',
      requiresRestart: false,
      secret: false,
    },
    minTtl: {
      schema: seconds,
      default: 60,
      label: 'Min health check interval',
      description:
        'Shortest interval a health check result may be reused for. A user asking for less is raised to this (accepts e.g. "5m", "1h").',
      env: 'HEALTH_CHECK_MIN_TTL',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'duration' },
    },
    maxTimeout: {
      schema: positiveInt,
      default: 10000,
      label: 'Max health check timeout (ms)',
      description:
        'Longest a health check may wait for a response. The first request needing a fresh result waits this long at worst.',
      env: 'HEALTH_CHECK_MAX_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
    maxBytes: {
      schema: byteSize,
      default: 65536,
      label: 'Max health check response size',
      description:
        'How much of a health check response is read before giving up on it.',
      env: 'HEALTH_CHECK_MAX_BYTES',
      requiresRestart: false,
      secret: false,
    },
    allowPrivateUrls: {
      schema: z.boolean(),
      default: false,
      label: 'Allow private health check URLs',
      description:
        'Let health checks point at private addresses. Anyone who can save a configuration can then probe your internal network, so only enable this on an instance you trust the users of.',
      env: 'HEALTH_CHECK_ALLOW_PRIVATE_URLS',
      requiresRestart: false,
      secret: false,
    },
  },
  sync: {
    refreshInterval: {
      schema: seconds,
      default: 86400,
      label: 'Whitelist sync refresh interval',
      description:
        'How often whitelisted regex/SEL sync URLs are refreshed (accepts e.g. "5m", "1h").',
      env: 'WHITELISTED_SYNC_REFRESH_INTERVAL',
      requiresRestart: true,
      secret: false,
      ui: { kind: 'duration' },
    },
  },
  disabled: {
    addons: {
      schema: reasonMap,
      default: emptyReasonMap,
      label: 'Disabled addons',
      description:
        'Map of disabled addon IDs to a reason. Env-supplied form: comma-separated "addon:reason" entries.',
      env: 'DISABLED_ADDONS',
      requiresRestart: false,
      secret: false,
      ui: { mapWidth: 'wide-value' },
    },
    removedAddons: {
      schema: reasonMap,
      default: emptyReasonMap,
      label: 'Removed addons',
      description:
        'Map of removed addon IDs (hidden from marketplace; errors on save) to a reason. Env-supplied form: comma-separated "addon:reason" entries.',
      env: 'REMOVED_ADDONS',
      requiresRestart: false,
      secret: false,
      ui: { mapWidth: 'wide-value' },
    },
    services: {
      schema: reasonMap,
      default: emptyReasonMap,
      label: 'Disabled services',
      description:
        'Map of disabled service IDs to a reason. Env-supplied form: comma-separated "service:reason" entries.',
      env: 'DISABLED_SERVICES',
      requiresRestart: false,
      secret: false,
      ui: { mapWidth: 'wide-value' },
    },
    hosts: {
      schema: reasonMap,
      default: emptyReasonMap,
      label: 'Disabled hosts',
      description:
        'Map of disabled hostnames to a reason. Env-supplied form: comma-separated "host:reason" entries.',
      env: 'DISABLED_HOSTS',
      requiresRestart: false,
      secret: false,
      ui: { mapWidth: 'wide-value' },
    },
    streamTypes: {
      schema: commaSeparatedList,
      default: [],
      label: 'Disabled stream types',
      description:
        'Stream types that should never be returned to clients (e.g. p2p, http, live).',
      env: 'DISABLED_STREAM_TYPES',
      requiresRestart: false,
      secret: false,
    },
  },
  selfScraping: {
    disabled: {
      schema: z.boolean(),
      default: true,
      label: 'Disable self-scraping',
      description:
        'When true, addons cannot scrape the same AIOStreams instance.',
      env: 'DISABLE_SELF_SCRAPING',
      requiresRestart: false,
      secret: false,
    },
  },
  trusted: {
    uuids: {
      schema: nullableString,
      default: null,
      label: 'Trusted UUIDs',
      description:
        'Comma-separated list of trusted user UUIDs. Trusted users may use regex filters and bypass certain access policies.',
      env: 'TRUSTED_UUIDS',
      requiresRestart: false,
      secret: false,
    },
  },
} as const satisfies RuntimeConfigSection;
