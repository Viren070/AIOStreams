import { z } from 'zod';

const positiveTitleLimit = z.number().int().positive();

export const titleLimitMap = z.union([
  z
    .record(z.string(), positiveTitleLimit)
    .transform((rec, ctx) => {
      const out: Record<string, number> = {};
      for (const [rawKey, value] of Object.entries(rec)) {
        const key = rawKey.trim().toLowerCase();
        if (!key) {
          ctx.addIssue({
            code: 'custom',
            message: 'Title limit override keys must not be empty.',
          });
          return z.NEVER;
        }
        out[key] = value;
      }
      return out;
    }),
  z.string().transform((value, ctx) => {
    const out: Record<string, number> = {};
    if (!value.trim()) return out;

    for (const entry of value
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)) {
      const colon = entry.lastIndexOf(':');
      if (colon === -1) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid title-limit entry: "${entry}". Expected key:limit.`,
        });
        return z.NEVER;
      }

      const key = entry.slice(0, colon).trim().toLowerCase();
      const rawLimit = entry.slice(colon + 1).trim();
      const limit = Number(rawLimit);
      if (!key || !Number.isInteger(limit) || limit <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid title limit "${rawLimit}" for key "${key}". Must be a positive integer.`,
        });
        return z.NEVER;
      }
      out[key] = limit;
    }

    return out;
  }),
]);

export const titleLimitsField = {
  schema: titleLimitMap,
  default: {} as Record<string, number>,
  label: 'Title limit overrides',
  description: {
    ui:
      'Override the default title limit for text-based queries per indexer/addon. Keys use the same priority as Title languages: exact hostname, auto-extracted Jackett/NZBHydra2 indexer name, addon ID, then `*`. Unlisted indexers use the default title limit.',
    env:
      'Per-indexer alternative-title limit overrides. Format: `<key>:<limit>[,<key>:<limit>...]`. Keys use the same priority as BUILTIN_SCRAPE_TITLE_LANGUAGES: exact hostname, auto-extracted Jackett/NZBHydra2 indexer name, addon ID, then `*`. Unmatched indexers fall back to BUILTIN_SCRAPE_TITLE_LIMIT.',
  },
  env: 'BUILTIN_SCRAPE_TITLE_LIMITS',
  requiresRestart: false,
  secret: false,
  ui: { kind: 'map', mapValueKind: 'number', min: 1 },
} as const;