import { z } from 'zod';
import { config as appConfig } from '../../config/index.js';

/** Entries are trimmed and de-duplicated. */
const list = z
  .union([z.array(z.string()), z.string().transform((s) => s.split(','))])
  .transform((entries) => [
    ...new Set(entries.map((e) => e.trim()).filter(Boolean)),
  ]);

/**
 * What an Xtream login's lineup is narrowed to. Each list holds keywords; one
 * matches when the name contains it, ignoring case.
 *
 * Excluded entries are always hidden. When an include list is given, only
 * entries matching one of its keywords stay.
 */
export const XtreamFilterSchema = z.object({
  excludeGroups: list.optional(),
  includeGroups: list.optional(),
  excludeChannels: list.optional(),
  includeChannels: list.optional(),
  cleanNames: z.boolean().optional(),
});
export type XtreamFilterInput = z.input<typeof XtreamFilterSchema>;

export interface XtreamFilter {
  excludeGroups: string[];
  includeGroups: string[];
  excludeChannels: string[];
  includeChannels: string[];
  /** Channel names lose their leading tag, such as `UK | `. */
  cleanNames: boolean;
}

const FIELDS = [
  'excludeGroups',
  'includeGroups',
  'excludeChannels',
  'includeChannels',
] as const;

/**
 * A list the login's own config sets replaces the instance default from the
 * environment; a list it leaves out (or empty) takes the default.
 */
export function resolveFilter(
  input: XtreamFilterInput,
  defaults: XtreamFilterInput = appConfig.builtins.xtream
): XtreamFilter {
  const own = XtreamFilterSchema.parse(input);
  const out = {} as XtreamFilter;
  out.cleanNames = own.cleanNames || defaults.cleanNames === true;
  for (const field of FIELDS) {
    const mine = own[field];
    out[field] = mine?.length
      ? mine
      : (XtreamFilterSchema.shape[field].parse(defaults[field]) ?? []);
  }
  return out;
}

/** Identifies a filter in cache keys; equal filters give equal text. */
export function filterSignature(filter: XtreamFilter): string {
  return FIELDS.map((field) =>
    [...new Set(filter[field].map((k) => k.toLowerCase()))]
      .sort()
      .join('\u0001')
  )
    .concat(filter.cleanNames ? 'clean' : '')
    .join('\u0002');
}

export const isUnfiltered = (filter: XtreamFilter) =>
  !filter.cleanNames && FIELDS.every((field) => !filter[field].length);

export type NameTest = (name: string) => boolean;

/** Whether a name stays: matches no exclude keyword, and an include keyword if any are given. */
export function nameTest(exclude: string[], include: string[]): NameTest {
  const out = exclude.map((k) => k.toLowerCase());
  const inn = include.map((k) => k.toLowerCase());
  if (!out.length && !inn.length) return () => true;
  return (name) => {
    const lower = name.toLowerCase();
    if (out.some((k) => lower.includes(k))) return false;
    return !inn.length || inn.some((k) => lower.includes(k));
  };
}
