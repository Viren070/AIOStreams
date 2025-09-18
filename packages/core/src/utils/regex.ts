import { isMatch } from 'super-regex';
import { Cache } from './cache.js';
import { getSimpleTextHash } from './crypto.js';
import { createLogger } from './logger.js';

const DEFAULT_TIMEOUT = 1000; // 1 second timeout
const regexCache = Cache.getInstance<string, RegExp>('regexCache', 1_000, true);
const resultCache = Cache.getInstance<string, boolean>(
  'regexResultCache',
  1_000_000
);

const logger = createLogger('regex');

/**
 * Safely tests a regex pattern against a string with ReDoS protection
 * @param pattern The regex pattern to test
 * @param str The string to test against
 * @param timeoutMs Optional timeout in milliseconds (default: 1000ms)
 * @returns boolean indicating if the pattern matches the string
 */
export async function safeRegexTest(
  pattern: string | RegExp,
  str: string,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<boolean> {
  const compiledPattern =
    typeof pattern === 'string' ? await compileRegex(pattern) : pattern;
  try {
    return await resultCache.wrap(
      (p: RegExp, s: string) => isMatch(p, s, { timeout: timeoutMs }),
      getSimpleTextHash(`${compiledPattern.source}|${str}`),
      100,
      compiledPattern,
      str
    );
  } catch (error) {
    logger.error(`Regex test timed out after ${timeoutMs}ms:`, error);
    return false;
  }
}
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
