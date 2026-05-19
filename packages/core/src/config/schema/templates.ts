import { z } from 'zod';
import { commaSeparatedList, seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/**
 * Accepts either a string array (DB-stored shape) or a JSON-encoded array of
 * strings (the legacy env shape used by `TEMPLATE_URLS`).
 */
const jsonStringList = z.union([
  z.array(z.string()),
  z.string().transform((value, ctx) => {
    if (!value.trim()) return [] as string[];
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Expected a JSON array of strings.',
      });
      return z.NEVER;
    }
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== 'string')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expected a JSON array of strings.',
      });
      return z.NEVER;
    }
    return parsed as string[];
  }),
]);

/**
 * Configuration templates that users see and import on the configure page.
 * (Previously misfiled under `branding`.)
 */
export const templatesSchema = {
  featuredIds: {
    schema: commaSeparatedList,
    default: [],
    label: 'Featured template IDs',
    description:
      'Up to 2 template IDs featured on the about page. Defaults to the first 2 available templates when unset.',
    env: 'FEATURED_TEMPLATE_IDS',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'list' },
  },
  urls: {
    schema: jsonStringList,
    default: [] as string[],
    label: 'Template URLs',
    description:
      'Remote template URLs to fetch and cache locally. Templates are downloaded once and refreshed on the schedule below.',
    env: 'TEMPLATE_URLS',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'list' },
  },
  refreshInterval: {
    schema: seconds,
    default: 86400,
    label: 'Template refresh interval',
    description:
      'How often remote templates are refreshed (accepts e.g. "12h", "1d"). Set to 0 to disable automatic refresh.',
    env: 'TEMPLATE_REFRESH_INTERVAL',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
} as const satisfies RuntimeConfigSection;
