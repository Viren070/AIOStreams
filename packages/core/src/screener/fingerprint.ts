import { createHash } from 'node:crypto';

/**
 * Screener release fingerprint, a credential-free, provider/indexer-agnostic
 * identity for a single Usenet release, derived only from its indexer-reported
 * size, poster, and posting day.
 *
 * Wire-compatible with nzbdavex's `WardenFingerprint.Compute`
 * (backend/Utils/WardenFingerprint.cs):
 *
 *   wd1: + lowercaseHex( SHA256(`{size}|{posterLower}|{dayBucket}`)[0..16] )
 *
 * The same dead release produces the same fingerprint on any server, indexer or
 * provider, so dead-release lists are interchangeable between aiostreams and
 * nzbdavex. The hash carries no credentials, titles or URLs, only a digest.
 */

const FP_PATTERN = /^wd1:[0-9a-f]{32}$/;
const SECONDS_PER_DAY = 86400;

/** True when `fp` is a syntactically valid `wd1:` fingerprint. */
export function isValidFingerprint(
  fp: string | null | undefined
): fp is string {
  return typeof fp === 'string' && FP_PATTERN.test(fp);
}

/**
 * Compute a release fingerprint. Returns `null` when the inputs are too weak to
 * identify a release (no size, or neither poster nor date), matching davex,
 * which never stores or filters on a weak fingerprint.
 *
 * `size` must be the indexer-reported byte size (the exact release size), NOT
 * the NZB's summed encoded segment size, that is what davex hashes, and using
 * anything else would break cross-tool matching.
 *
 * @param size indexer-reported release size in bytes
 * @param poster the release's poster / `from` header, if the indexer provided one
 * @param usenetDateUnixSeconds posting date in unix *seconds*, if known
 */
export function computeFingerprint(
  size: number,
  poster: string | null | undefined,
  usenetDateUnixSeconds: number | null | undefined
): string | null {
  // Byte sizes are exact integers; a fractional or above-2^53 (already-rounded)
  // value would mint a wd1 for a size no other implementation derives.
  if (!Number.isSafeInteger(size) || size <= 0) return null;

  const hasPoster = typeof poster === 'string' && poster.trim() !== '';
  const hasDate =
    typeof usenetDateUnixSeconds === 'number' &&
    Number.isFinite(usenetDateUnixSeconds);
  if (!hasPoster && !hasDate) return null;

  const posterNorm = hasPoster ? poster!.trim().toLowerCase() : '';
  const dayBucket = hasDate
    ? Math.floor(usenetDateUnixSeconds! / SECONDS_PER_DAY)
    : 0;
  const canonical = `${size}|${posterNorm}|${dayBucket}`;

  const hash = createHash('sha256').update(canonical, 'utf8').digest();
  return 'wd1:' + hash.subarray(0, 16).toString('hex');
}

/**
 * Coerce an indexer-supplied date (epoch seconds, epoch millis, a `Date`, or a
 * parseable date string such as RFC-822 `pubDate` / newznab `usenetdate`) to
 * unix *seconds*, or `null` if it can't be parsed. Values that already look
 * like epoch seconds are passed through so a feed reporting seconds and one
 * reporting an equivalent ISO string land on the same day bucket.
 */
export function toUnixSeconds(
  value: string | number | Date | null | undefined
): number | null {
  if (value == null) return null;

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Heuristic: >1e11 is almost certainly milliseconds (year ~5138 in seconds).
    return Math.floor(value > 1e11 ? value / 1000 : value);
  }

  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.floor(n > 1e11 ? n / 1000 : n) : null;
  }

  // Only an ISO date-only string (parsed as UTC) or an explicitly-zoned string
  // resolves to the same instant on every host. A tz-less time or a non-ISO date
  // is locale-dependent and would bucket the wd1 differently, so reject it.
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT)\b)/i.test(trimmed);
  if (!isoDateOnly && !hasZone) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
