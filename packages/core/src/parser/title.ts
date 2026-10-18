import {
  parseTorrentTitle,
  Parser,
  handlers,
  type ParsedResult,
} from '@viren070/parse-torrent-title';
import { DEFAULT_REPOST_SUFFIXES } from '../utils/constants.js';

const explicitEpisode =
  /(?<![\p{L}\p{N}])(?:S\d{1,2}[ ._-]*E\d{1,4}|E\d{1,4}|\d{1,2}x\d{1,4})(?![\p{L}\p{N}])/iu;
let seriesTitleParser: Parser | undefined;

/** Keep an embedded SD title component when real title words precede an episode. */
function preserveEmbeddedSdTitle(
  name: string,
  parsed: ParsedResult
): ParsedResult {
  if (parsed.quality !== 'SDTV' || parsed.episodes?.length !== 1) return parsed;
  const sd = /(?<![\p{L}\p{N}])SD(?=[ ._-])/iu.exec(name);
  const episode = sd && explicitEpisode.exec(name);
  if (!sd || !episode || sd.index >= episode.index) return parsed;

  // Parse the intervening words normally: audio/language/edition/source tags
  // do not turn a genuine SD release into a longer series title.
  const tail = parseTorrentTitle(
    `${name.slice(sd.index + sd[0].length, episode.index)}${episode[0]}`
  ).title;
  if ((tail?.match(/\p{L}+/gu)?.length ?? 0) < 2) return parsed;

  seriesTitleParser ??= new Parser().addHandlers(
    handlers.map((handler) =>
      handler.field === 'quality' && handler.pattern?.test('SD')
        ? {
            ...handler,
            // Only bare SD before an episode can belong to the title. Keep
            // SDTV (including SD-TV/SD TV), later SD quality tags, and all
            // other default handlers.
            pattern: new RegExp(
              `(?!SD\\b[ ._-](?!TV\\b)[\\s\\S]*${explicitEpisode.source})${handler.pattern.source}`,
              `${handler.pattern.flags.replace('u', '')}u`
            ),
          }
        : handler
    )
  );
  const recovered = seriesTitleParser.parse(name);
  if (!recovered.title || !/\bSD\b/i.test(recovered.title)) return parsed;
  // A real quality tag can precede language/audio labels. Restoring a title
  // must never absorb those labels or change any other parsed release facts.
  for (const key of new Set([
    ...Object.keys(parsed),
    ...Object.keys(recovered),
  ])) {
    if (key === 'title' || key === 'quality') continue;
    const before = parsed[key as keyof ParsedResult];
    const after = recovered[key as keyof ParsedResult];
    if (
      Array.isArray(before)
        ? !Array.isArray(after) ||
          before.length !== after.length ||
          before.some((value, index) => value !== after[index])
        : before !== after
    )
      return parsed;
  }
  return recovered;
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
 * Memoised {@link parseTorrentTitle}.
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

  const parsed = preserveEmbeddedSdTitle(name, parseTorrentTitle(name));

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
