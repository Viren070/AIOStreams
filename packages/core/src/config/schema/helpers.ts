import { z } from 'zod';
import { parseTime } from '../../utils/time.js';
import { Env } from '../../utils/env.js';
import UserAgent from 'user-agents';

/**
 * Replace `{version}` / `{random}` placeholders in user-agent strings.
 */
const applyUserAgentTemplate = (value: string): string => {
  const trimmed = value.toLowerCase().trim();
  if (['false', 'none', ''].includes(trimmed)) return 'false';
  const filters =
    typeof process.env.RANDOM_USER_AGENT_FILTERS === 'string'
      ? (() => {
          try {
            return JSON.parse(process.env.RANDOM_USER_AGENT_FILTERS as string);
          } catch {
            return undefined;
          }
        })()
      : undefined;
  return value
    .replace(/{version}/g, Env.VERSION || 'unknown')
    .replace(/{random}/g, new UserAgent(filters).toString());
};

/** A user-agent string with `{version}`/`{random}` templating applied. */
export const userAgentString = z.string().transform(applyUserAgentTemplate);

/** Nullable variant of {@link userAgentString}. */
export const nullableUserAgentString = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null ? null : applyUserAgentTemplate(v)));

const trimTrailingSlash = (value: string) =>
  value.endsWith('/') ? value.slice(0, -1) : value;

/**
 * A non-empty URL string. Strips trailing slashes for consistency.
 */
export const urlString = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      new URL(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid URL: "${value}"`,
      });
    }
  })
  .transform(trimTrailingSlash);

/**
 * Accepts a single URL string, an array of URL strings, or a JSON-encoded
 * array of URL strings (env shape). Produces a non-empty `string[]`.
 */
export const urlOrUrlList = z
  .union([
    z.array(urlString),
    z.string().transform((value, ctx) => {
      const trimmed = value.trim();
      if (!trimmed) return [] as string[];
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // single URL fallback
        try {
          new URL(trimmed);
          return [trimTrailingSlash(trimmed)];
        } catch {
          ctx.addIssue({ code: 'custom', message: `Invalid URL: "${value}"` });
          return z.NEVER;
        }
      }
      if (
        !Array.isArray(parsed) ||
        parsed.some((item) => typeof item !== 'string')
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Expected a JSON array of URL strings.',
        });
        return z.NEVER;
      }
      const out: string[] = [];
      for (const item of parsed as string[]) {
        try {
          new URL(item);
        } catch {
          ctx.addIssue({ code: 'custom', message: `Invalid URL: "${item}"` });
          return z.NEVER;
        }
        out.push(trimTrailingSlash(item));
      }
      return out;
    }),
  ])
  .transform((value) => (Array.isArray(value) ? value : value));

/**
 * Cache TTL specification: per-key TTL (seconds) with a `*` wildcard fallback.
 * Accepts:
 *   - a `Record<string, number>` (DB-stored shape),
 *   - a single integer (becomes `{ '*': n }`),
 *   - a comma-separated `key:value` env string.
 *
 * `-1` is the conventional "disabled" sentinel.
 */
export const cacheTtlMap = z.union([
  z.record(z.string(), z.number().int()),
  z
    .number()
    .int()
    .transform((n) => ({ '*': n }) as Record<string, number>),
  z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return { '*': n } as Record<string, number>;
    }
    const out: Record<string, number> = {};
    for (const entry of trimmed
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)) {
      const [k, v] = entry.split(':').map((s) => s.trim());
      if (!k || !v) {
        ctx.addIssue({
          code: 'custom',
          message:
            'Cache TTL must be a comma-separated list of key:value pairs.',
        });
        return z.NEVER;
      }
      const n = Number(v);
      if (!Number.isInteger(n) || (n !== -1 && n <= 0)) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid cache TTL value "${v}" for key "${k}". Must be -1 (disabled) or a positive integer.`,
        });
        return z.NEVER;
      }
      out[k] = n;
    }
    return out;
  }),
]);

/**
 * Service credentials map env format:
 *   `serviceId.credentialId=value` per line, separated by newlines.
 * Stored as a nested `Record<serviceId, Record<credentialId, string>>`.
 *
 * Empty / missing yields an empty record.
 */
export const serviceCredentialsMap = z.union([
  z.record(z.string(), z.record(z.string(), z.string())),
  z.string().transform((value, ctx) => {
    const out: Record<string, Record<string, string>> = {};
    if (!value.trim()) return out;
    for (const rawLine of value.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) {
        ctx.addIssue({
          code: 'custom',
          message: `Service credential line must be "serviceId.credentialId=value": "${line}"`,
        });
        return z.NEVER;
      }
      const lhs = line.slice(0, eq).trim();
      const val = line.slice(eq + 1);
      const dot = lhs.indexOf('.');
      if (dot === -1) {
        ctx.addIssue({
          code: 'custom',
          message: `Service credential key must be "serviceId.credentialId": "${lhs}"`,
        });
        return z.NEVER;
      }
      const sid = lhs.slice(0, dot).trim();
      const cid = lhs.slice(dot + 1).trim();
      if (!sid || !cid) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid service credential key: "${lhs}"`,
        });
        return z.NEVER;
      }
      (out[sid] ||= {})[cid] = val;
    }
    return out;
  }),
]);

/**
 * Forced port: `''` (unset) or an integer in 1..65535. Stored as the original
 * string for compatibility with envalid's `forcedPort` shape.
 */
export const forcedPort = z
  .union([z.string(), z.number().int()])
  .transform((value, ctx) => {
    if (value === '' || value === undefined) return '';
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      ctx.addIssue({ code: 'custom', message: `Invalid port: "${value}"` });
      return z.NEVER;
    }
    return String(n);
  });

/**
 * Comma-separated `serviceId:duration` map. Values may be plain integer
 * milliseconds or a duration string (e.g. `"30s"`). `*` is a wildcard.
 * Output is `Record<string, number>` (milliseconds).
 */
export const serviceTimeMap = z.union([
  z.record(z.string(), z.number().int()),
  z.string().transform((value, ctx) => {
    const out: Record<string, number> = {};
    if (!value.trim()) return out;
    for (const entry of value
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)) {
      const colon = entry.indexOf(':');
      if (colon === -1) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid service-time entry: "${entry}". Expected serviceId:<time>.`,
        });
        return z.NEVER;
      }
      const k = entry.slice(0, colon).trim();
      const t = entry.slice(colon + 1).trim();
      if (!k || !t) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid service-time entry: "${entry}"`,
        });
        return z.NEVER;
      }
      let ms: number;
      if (/^\d+$/.test(t)) {
        ms = Number(t);
      } else {
        try {
          ms = parseTime(t);
        } catch {
          ctx.addIssue({
            code: 'custom',
            message: `Invalid duration "${t}" for "${k}".`,
          });
          return z.NEVER;
        }
      }
      if (!Number.isInteger(ms) || ms < 0) {
        ctx.addIssue({
          code: 'custom',
          message: `Duration for "${k}" must be a non-negative integer.`,
        });
        return z.NEVER;
      }
      out[k] = ms;
    }
    return out;
  }),
]);

/**
 * Map of hostname → user-agent. Env shape: `host1:ua1,host2:ua2,...`.
 */
export const userAgentMap = z
  .union([
    z.record(z.string(), z.string()),
    z.string().transform((value, ctx) => {
      const out: Record<string, string> = {};
      if (!value.trim()) return out;
      const regex = /([a-zA-Z0-9.\-*]+):([^,]*(?:,[^a-zA-Z0-9.\-][^,]*)*)/g;
      let match;
      let any = false;
      while ((match = regex.exec(value)) !== null) {
        any = true;
        const host = match[1].trim();
        const ua = match[2].trim();
        if (!host || !ua) continue;
        out[host] = ua;
      }
      if (!any) {
        ctx.addIssue({
          code: 'custom',
          message: 'Expected hostname:user-agent pairs.',
        });
        return z.NEVER;
      }
      return out;
    }),
  ])
  .transform((record) => {
    const out: Record<string, string> = {};
    for (const [host, ua] of Object.entries(record)) {
      out[host] = applyUserAgentTemplate(ua);
    }
    return out;
  });

/**
 * `addonProxyConfig` env format: comma-separated `hostname:bool|number` pairs.
 * Stored as `Record<hostname, boolean|number>`.
 */
export const addonProxyConfigMap = z.union([
  z.record(z.string(), z.union([z.boolean(), z.number().int()])),
  z.string().transform((value, ctx) => {
    const out: Record<string, boolean | number> = {};
    if (!value.trim()) return out;
    for (const entry of value
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)) {
      const [host, raw] = entry.split(':').map((s) => s.trim());
      if (!host || raw === undefined) {
        ctx.addIssue({ code: 'custom', message: `Invalid entry: "${entry}"` });
        return z.NEVER;
      }
      if (raw === 'true' || raw === 'false') {
        out[host] = raw === 'true';
      } else if (/^\d+$/.test(raw)) {
        out[host] = Number(raw);
      } else {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid value for "${host}": "${raw}"`,
        });
        return z.NEVER;
      }
    }
    return out;
  }),
]);

/**
 * `bool | string[]` field. Env shape: `true|false|1|0` or comma-separated list.
 */
export const boolOrList = z.union([
  z.boolean(),
  z.array(z.string()),
  z.string().transform((value) => {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }),
]);

/**
 * A size value: integer bytes or a human-readable string like "20MB".
 */
export const byteSize = z.union([
  z.number().int().nonnegative(),
  z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kmg]?b)?$/i);
    if (!m) {
      ctx.addIssue({ code: 'custom', message: `Invalid size: "${value}"` });
      return z.NEVER;
    }
    const n = Number(m[1]);
    const unit = (m[2] || 'b').toLowerCase();
    const mult: Record<string, number> = {
      b: 1,
      kb: 1000,
      mb: 1_000_000,
      gb: 1_000_000_000,
    };
    return Math.floor(n * mult[unit]);
  }),
]);

/**
 * Strictly positive integer. Accepts a number or a numeric string (env-supplied).
 */
export const positiveInt = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const n = typeof value === 'string' ? Number(value.trim()) : value;
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Expected a positive integer, got ${JSON.stringify(value)}.`,
      });
      return z.NEVER;
    }
    return n;
  });

/**
 * Non-negative integer (0 allowed). Accepts a number or a numeric string (env-supplied).
 */
export const nonNegativeInt = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const n = typeof value === 'string' ? Number(value.trim()) : value;
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Expected a non-negative integer, got ${JSON.stringify(value)}.`,
      });
      return z.NEVER;
    }
    return n;
  });

/**
 * Positive integer or null. Accepts number, null, or a numeric string.
 */
export const optionalPositiveInt = z
  .union([z.number(), z.string(), z.null()])
  .transform((value, ctx) => {
    if (value === null || value === '' || value === 'null') return null;
    const n = typeof value === 'string' ? Number(value.trim()) : value;
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Expected a positive integer or null, got ${JSON.stringify(value)}.`,
      });
      return z.NEVER;
    }
    return n;
  });

/**
 * Accepts either:
 * - a non-negative integer (interpreted as seconds), or
 * - a string in the parseTime() format ("30s", "5m", "1h", "2d").
 *
 * Coerces to a non-negative integer number of seconds.
 *
 * Use for any user-editable interval/TTL where we want human-friendly input.
 */
export const seconds = z
  .union([z.number().int().nonnegative(), z.string()])
  .transform((value, ctx) => {
    if (typeof value === 'number') return value;
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (n < 0 || !Number.isInteger(n)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'Must be a non-negative integer or duration string (e.g. 30s, 5m, 1h).',
        });
        return z.NEVER;
      }
      return n;
    }
    try {
      const ms = parseTime(trimmed);
      return Math.floor(ms / 1000);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid duration: "${value}". Use seconds (e.g. 60) or a duration string (e.g. 30s, 5m, 1h).`,
      });
      return z.NEVER;
    }
  });

/**
 * Accepts either a string array (DB-stored shape) or a comma-separated string
 * (env-supplied shape) and produces a trimmed string array.
 */
export const commaSeparatedList = z.union([
  z.array(z.string()),
  z.string().transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  ),
]);

/**
 * Same as `seconds` but allows -1 as a sentinel (commonly used for "disabled").
 */
export const secondsAllowingDisabled = z
  .union([z.number().int(), z.string()])
  .transform((value, ctx) => {
    if (typeof value === 'number') {
      if (value !== -1 && (value < 0 || !Number.isInteger(value))) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must be -1 (disabled), 0, or a positive integer.',
        });
        return z.NEVER;
      }
      return value;
    }
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (n !== -1 && (n < 0 || !Number.isInteger(n))) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must be -1 (disabled), 0, or a positive integer.',
        });
        return z.NEVER;
      }
      return n;
    }
    try {
      const ms = parseTime(trimmed);
      return Math.floor(ms / 1000);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid duration: "${value}". Use seconds, -1 to disable, or a duration string (e.g. 30s, 5m, 1h).`,
      });
      return z.NEVER;
    }
  });
