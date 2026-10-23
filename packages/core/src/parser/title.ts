import { parseTorrentTitle, ParsedResult } from '@viren070/parse-torrent-title';
import { DEFAULT_REPOST_SUFFIXES } from '../utils/constants.js';

/** Decode one layer of XML entities found in indexer release names for parsing. */
export function decodeReleaseName(title: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    quot: '"',
    lt: '<',
    gt: '>',
  };
  return title.replace(
    /&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|amp|apos|quot|lt|gt);/g,
    (whole, entity: string) => {
      if (entity[0] !== '#') return named[entity];
      const hex = entity[1].toLowerCase() === 'x';
      const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        value <= 0 ||
        value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff)
      )
        return whole;
      return String.fromCodePoint(value);
    }
  );
}

// Sized to cover the working set of a busy request without retaining much:
// entries are small objects and the hit rate comes from repetition, not volume.
const MAX_ENTRIES = 10_000;

const cache = new Map<string, ParsedResult>();

let repostSuffixPattern = compileRepostSuffixes(DEFAULT_REPOST_SUFFIXES);

/** The SPA also loads this module, so the server pushes its config in here. */
export function setRepostSuffixes(suffixes: readonly string[]): void {
  repostSuffixPattern = compileRepostSuffixes(suffixes);
}

function compileRepostSuffixes(
  suffixes: readonly string[]
): RegExp | undefined {
  const alternatives = suffixes
    .map((suffix) => suffix.trim())
    .filter(Boolean)
    .map((suffix) =>
      suffix.endsWith('*')
        ? `${escapeRegex(suffix.slice(0, -1))}[a-z0-9]*`
        : escapeRegex(suffix)
    );
  if (!alternatives.length) return undefined;
  return new RegExp(
    `(?:-(?:${alternatives.join('|')}))+(?=(?:\\.[a-z0-9]{2,4})?$)`,
    'i'
  );
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripRepostSuffixes(name: string): string {
  return repostSuffixPattern ? name.replace(repostSuffixPattern, '') : name;
}

/**
 * Memoised torrent-title parsing.
 *
 * The same names are parsed repeatedly: builtins parse every file inside every
 * torrent and then the wrapper re-parses the names it kept, via a different
 * entry point into the same handlers. Release names also recur across requests.
 *
 * Returned objects are SHARED between callers and must be treated as read-only,
 * including their arrays (`seasons`, `episodes`, `volumes`, `editions`).
 */
export function parseTorrentTitleCached(title: string): ParsedResult {
  const name = stripRepostSuffixes(title);
  const cached = cache.get(name);
  if (cached !== undefined) {
    // Re-insert to refresh recency; Map iterates in insertion order.
    cache.delete(name);
    cache.set(name, cached);
    return cached;
  }

  const parsed = parseTorrentTitle(decodeReleaseName(name));

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(name, parsed);
  return parsed;
}

/** Entry count, for cache reporting. */
export function parsedTitleCacheSize(): number {
  return cache.size;
}
