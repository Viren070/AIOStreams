/**
 * Best-effort extraction of a real filename from an NZB `subject` line.
 *
 * Usenet subjects are not standardised. Common forms:
 *   "[1/8] - \"My.File.mkv\" yEnc (1/120)"
 *   "My Release [01/42] - \"file.part01.rar\" yEnc (1/200) 524288000"
 *   "file.nfo (1/1)"
 *
 * Strategy:
 *  1. Prefer a quoted token, which almost always holds the filename.
 *  2. Otherwise, pick the token that looks most like a filename (has a known
 *     extension), stripping segment counters and yEnc markers.
 */

const QUOTED = /"([^"]+)"/;
const YENC_MARKER = /\byenc\b/i;
// e.g. (1/120) or [1/8]
const COUNTER = /[([]\s*\d+\s*\/\s*\d+\s*[)\]]/g;
// trailing size in bytes
const TRAILING_SIZE = /\b\d{4,}\b\s*$/;

// A token that ends with a plausible file extension.
const FILENAME_LIKE =
  /([^\s"/\\]+\.(?:mkv|mp4|avi|wmv|mov|m4v|ts|m2ts|flv|webm|mpg|mpeg|iso|img|rar|r\d{2}|zip|7z|tar|gz|nfo|sfv|par2|nzb|srt|sub|idx|ass|mka|mp3|flac|ogg|wav|epub|pdf|cbz|cbr))\b/i;

export function parseSubjectFilename(subject: string): string | undefined {
  if (!subject) return undefined;

  const quoted = subject.match(QUOTED);
  if (quoted?.[1]) {
    const candidate = quoted[1].trim();
    if (candidate.length > 0) return candidate;
  }

  // Strip yEnc marker, segment counters and trailing size, then look for a
  // filename-like token.
  let cleaned = subject
    .replace(YENC_MARKER, ' ')
    .replace(COUNTER, ' ')
    .replace(TRAILING_SIZE, ' ')
    .trim();

  const match = cleaned.match(FILENAME_LIKE);
  if (match?.[1]) return match[1].trim();

  return undefined;
}

/**
 * Extract the part number from a subject's "(n/m)" counter, if present.
 * Used as a fallback when an NZB omits segment `number` attributes.
 */
export function parseSubjectPartNumber(subject: string): number | undefined {
  const m = subject.match(/[([]\s*(\d+)\s*\/\s*\d+\s*[)\]]/);
  if (m?.[1]) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
