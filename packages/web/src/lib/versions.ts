import type { SourceInfo } from './types';

/** The parts of a version a badge or quick filter can be limited to, named as the formatter names them. */
export const VERSION_FIELDS = [
  'name',
  'description',
  'filename',
  'folderName',
  'resolution',
  'quality',
  'encode',
  'visualTags',
  'audioTags',
  'audioChannels',
  'languages',
  'editions',
  'releaseGroup',
  'indexer',
  'addon',
  'service',
  'seMatched',
  'rseMatched',
  'regexMatched',
  'rankedRegexMatched',
  'seadex',
] as const;
export type VersionField = (typeof VERSION_FIELDS)[number];

export interface Text {
  lines: string[];
  /** The lines on one line, so a pattern can span them. */
  all: string;
  lower: string;
}

/** What a version's search, quick filters and badges read. */
export interface VersionText extends Text {
  fields: Partial<Record<VersionField, string[]>>;
  /** The text of a few fields, kept once built. */
  only: Map<string, Text>;
}

export type Matcher = (text: VersionText) => boolean;

export interface QuickFilter {
  name: string;
  query: string;
  fields?: VersionField[];
}

function toText(values: string[]): Text {
  const lines = values
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);
  const all = lines.join(' ');
  return { lines, all, lower: all.toLowerCase() };
}

const list = (value: string | string[] | undefined | null) =>
  Array.isArray(value) ? value : value ? [value] : [];

export function versionText(source: SourceInfo): VersionText {
  const a = source.aiostreams;
  const fields: VersionText['fields'] = {
    name: list(a?.name || source.Name),
    description: list(a?.description),
    filename: list(a?.filename),
    folderName: list(a?.folderName),
    resolution: list(a?.resolution),
    quality: list(a?.quality),
    encode: list(a?.encode),
    visualTags: list(a?.visualTags),
    audioTags: list(a?.audioTags),
    audioChannels: list(a?.audioChannels),
    languages: list(a?.languages),
    editions: list(a?.editions),
    releaseGroup: list(a?.releaseGroup),
    indexer: list(a?.indexer),
    addon: list(a?.addon),
    service: list(a?.service),
    seMatched: list(a?.seMatched),
    rseMatched: list(a?.rseMatched),
    regexMatched: list(a?.regexMatched),
    rankedRegexMatched: list(a?.rankedRegexMatched),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- matched text, not shown
    seadex: a?.seadex ? [a.seadex === 'best' ? 'SeaDex Best' : 'SeaDex'] : [],
  };
  return {
    ...toText(VERSION_FIELDS.flatMap((field) => fields[field] ?? [])),
    fields,
    only: new Map(),
  };
}

function textOf(text: VersionText, fields?: readonly VersionField[]): Text {
  if (!fields?.length) return text;
  const key = fields.join();
  let found = text.only.get(key);
  if (!found) {
    found = toText(fields.flatMap((field) => text.fields[field] ?? []));
    text.only.set(key, found);
  }
  return found;
}

const INLINE_FLAGS = /^\(\?([a-z]+)\)/i;

/**
 * A case-insensitive pattern. Leading inline flags such as `(?i)` or `(?s)`,
 * which other apps' patterns start with, become the pattern's own flags.
 */
export function toRegExp(source: string, flags = ''): RegExp | null {
  let rest = source;
  let all = flags.toLowerCase();
  for (let m = rest.match(INLINE_FLAGS); m; m = rest.match(INLINE_FLAGS)) {
    all += m[1].toLowerCase();
    rest = rest.slice(m[0].length);
  }
  const kept = [...new Set(`i${all}`)].filter((f) => 'imsu'.includes(f));
  try {
    return new RegExp(rest, kept.join(''));
  } catch {
    return null;
  }
}

/** Lines are tried one by one only for anchored patterns, which the joined text would miss. */
export function textMatcher(
  regex: RegExp,
  fields?: readonly VersionField[]
): Matcher {
  const perLine = /[$^]/.test(regex.source);
  return (version) => {
    const text = textOf(version, fields);
    return (
      regex.test(text.all) ||
      (perLine && text.lines.some((line) => regex.test(line)))
    );
  };
}

const SLASHED = /^\/(.+)\/([a-z]*)$/s;

/**
 * Words that must all appear, or a pattern between slashes. Null when the
 * pattern does not compile; an empty query matches everything.
 */
export function compileQuery(
  query: string,
  fields?: readonly VersionField[]
): Matcher | null {
  const trimmed = query.trim();
  const slashed = trimmed.match(SLASHED);
  if (slashed) {
    const regex = toRegExp(slashed[1], slashed[2]);
    return regex && textMatcher(regex, fields);
  }
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  return (version) => {
    const { lower } = textOf(version, fields);
    return words.every((word) => lower.includes(word));
  };
}

export const isField = (value: unknown): value is VersionField =>
  VERSION_FIELDS.includes(value as VersionField);

function quickFilter(entry: Partial<QuickFilter> | null): QuickFilter[] {
  const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
  const query = typeof entry?.query === 'string' ? entry.query.trim() : '';
  if (!name || !query) return [];
  const named = Array.isArray(entry?.fields) ? entry.fields : [];
  const fields = named.filter(isField);
  if (named.length && !fields.length) return [];
  return [{ name, query, ...(fields.length && { fields }) }];
}

/** A list of quick filters, an exported `{ quickFilters }`, or a single one. */
export function readQuickFilterData(data: unknown): QuickFilter[] {
  const exported = (data as { quickFilters?: unknown } | null)?.quickFilters;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(exported)
      ? exported
      : [data];
  return list.flatMap(quickFilter);
}

export function readQuickFilters(raw: string | undefined): QuickFilter[] {
  try {
    return raw ? readQuickFilterData(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}
