import { Cache } from './cache.js';
import { getSimpleTextHash } from './crypto.js';

const regexCache = Cache.getInstance<string, RegExp>(
  'regexCache',
  1_000,
  'memory'
);
// parses regex and flags, also checks for existence of a custom flag - n - for negate
export function parseRegex(pattern: string): {
  regex: string;
  flags: string;
} {
  const regexFormatMatch = /^\/(.+)\/([gimuyn]*)$/.exec(pattern);
  return regexFormatMatch
    ? { regex: regexFormatMatch[1], flags: regexFormatMatch[2] }
    : { regex: pattern, flags: '' };
}

export async function compileRegex(
  pattern: string,
  bypassCache: boolean = false
): Promise<RegExp> {
  let { regex, flags } = parseRegex(pattern);
  // the n flag is not to be used when compiling the regex
  if (flags.includes('n')) {
    flags = flags.replace('n', '');
  }
  if (bypassCache) {
    return new RegExp(regex, flags);
  }

  return await regexCache.wrap(
    (p: string, f: string) => new RegExp(p, f || undefined),
    getSimpleTextHash(`${regex}|${flags}`),
    30 * 24 * 60 * 60,
    regex,
    flags
  );
}

// Build the raw pattern string used to match a list of keywords against stream
// attributes. Exposed separately so synchronous callers (e.g. the SEL parser,
// which cannot await) can produce the exact same regex shape as the async
// `formRegexFromKeywords` helper used by the keyword UI filters.
export function buildKeywordRegexPattern(keywords: string[]): string {
  return `/(?:^|(?<![^ \\[(_\\-.]))(${keywords
    .map((filter) => filter.replace(/[-[\]{}()*+?.,\\^$]/g, '\\$&'))
    .map((filter) => filter.replace(/\s/g, '[\\s.\\-_]?'))
    .join('|')})(?=[ \\)\\]_.-]|$)/i`;
}

export async function formRegexFromKeywords(
  keywords: string[]
): Promise<RegExp> {
  return await compileRegex(buildKeywordRegexPattern(keywords));
}

// Synchronous variant of `formRegexFromKeywords`. Produces an identical regex
// to the async version (same pattern + flags) but bypasses the async regex
// cache so it can be called from synchronous contexts such as SEL function
// implementations.
export function formRegexFromKeywordsSync(keywords: string[]): RegExp {
  const { regex, flags } = parseRegex(buildKeywordRegexPattern(keywords));
  const cleanedFlags = flags.includes('n') ? flags.replace('n', '') : flags;
  return new RegExp(regex, cleanedFlags || undefined);
}
