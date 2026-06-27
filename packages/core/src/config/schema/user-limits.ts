import { z } from 'zod';
import { commaSeparatedList, positiveInt, seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/**
 * Operator-imposed limits and access controls applied to user configurations.
 *
 * Subsections group related concerns:
 * - top-level: numeric config-count limits applied during validation.
 * - `timeouts`: min/max bounds for user-configurable HTTP timeouts.
 * - `regex`: regex-filter access policy + whitelisted patterns.
 * - `sel`: SEL sync access + whitelisted URLs + stream-expression limits.
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
  maxNzbFailoverCount: {
    schema: positiveInt,
    default: 5,
    label: 'Max NZB failover count',
    description: 'Maximum NZB failover attempts a user can configure.',
    env: 'MAX_NZB_FAILOVER_COUNT',
    requiresRestart: false,
    secret: false,
  },
  maxSameReleaseFailoverCount: {
    schema: positiveInt,
    default: 5,
    label: 'Max same-release failover count',
    description:
      'Maximum same-release variant failover attempts a user can configure per release.',
    env: 'MAX_SAME_RELEASE_FAILOVER_COUNT',
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
