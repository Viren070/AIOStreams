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

export async function formRegexFromKeywords(
  keywords: string[]
): Promise<RegExp> {
  const pattern = `/(?:^|(?<![^ \\[(_\\-.]))(${keywords
    .map((filter) => filter.replace(/[-[\]{}()*+?.,\\^$]/g, '\\$&'))
    .map((filter) => filter.replace(/\s/g, '[\\s.\\-_]?'))
    .join('|')})(?=[ \\)\\]_.-]|$)/i`;

  return await compileRegex(pattern);
}
