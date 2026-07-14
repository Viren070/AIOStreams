/**
 * Best-effort extraction of a real filename from an NZB `subject` line.
 *
 * Usenet subjects are not standardised. Common forms:
 *   "[1/8] - \"My.File.mkv\" yEnc (1/120)"
 *   "My Release [01/42] - \"file.part01.rar\" yEnc (1/200) 524288000"
 *   "file.nfo (1/1)"
 *   "[PRiVATE]-[WtFnZb]-[real.name.r16]-[20/22] - \"\" yEnc 74688367 (1/105)"
 *   "[N3wZ] \\LQ1OaY347934\\::[PRiVATE]-[WtFnZb]-[real.name.r16]-[20/22] - ..."
 *
 * Strategy:
 *  1. Prefer a quoted token, which almost always holds the filename.
 *  2. Otherwise use SABnzbd's canonical filename regex.
 *  3. Fall back to a permissive extension-list match for the rare filename that
 *     contains characters outside SABnzbd's allowlist.
 */

const QUOTED = /"([^"]+)"/;
const YENC_MARKER = /\byenc\b/i;
// e.g. (1/120) or [1/8]
const COUNTER = /[([]\s*\d+\s*\/\s*\d+\s*[)\]]/g;
// trailing size in bytes
const TRAILING_SIZE = /\b\d{4,}\b\s*$/;

const SABNZBD_LIKE =
  /\b([\w\-+()' .,]+(?:\[[\w\-/+()' .,]*\][\w\-+()' .,]*)*\.[A-Za-z0-9]{2,4})\b/;

// a token ending in a known extension, admitting any non-space char
// (catches filenames with symbols outside SABnzbd's allowlist).
const FILENAME_LIKE =
  /([^\s"/\\]+\.(?:mkv|mp4|avi|wmv|mov|m4v|ts|m2ts|flv|webm|mpg|mpeg|iso|img|rar|r\d{2}|zip|7z|tar|gz|nfo|sfv|par2|nzb|srt|sub|idx|ass|mka|mp3|flac|ogg|wav|epub|pdf|cbz|cbr))\b/i;

export function parseSubjectFilename(subject: string): string | undefined {
  if (!subject) return undefined;

  const quoted = subject.match(QUOTED);
  if (quoted?.[1]) {
    const candidate = quoted[1].trim();
    if (candidate.length > 0) return candidate;
  }

  const like = subject.match(SABNZBD_LIKE);
  if (like?.[1]) return like[1].trim();

  // Strip yEnc marker, segment counters and trailing size, then look for a
  // filename-like token with the permissive fallback.
  const cleaned = subject
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
