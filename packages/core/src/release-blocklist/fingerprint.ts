import { createHash } from 'node:crypto';

const SECONDS_PER_DAY = 86400;

/** Numeric values above this are treated as epoch milliseconds. */
const EPOCH_MILLIS_THRESHOLD = 1e11;

/**
 * Usenet release fingerprint: `wd1:` plus the first 16 bytes of
 * SHA-256(`{size}|{poster lowercased+trimmed}|{floor(unixSeconds/86400)}`)
 * as lowercase hex.
 *
 * Returns null when the inputs cannot identify a release: size missing or
 * not a positive safe integer, or neither poster nor date present.
 */
export function computeUsenetFingerprint(
  size: number,
  poster: string | null | undefined,
  usenetDateUnixSeconds: number | null | undefined
): string | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;

  const trimmedPoster = typeof poster === 'string' ? poster.trim() : '';
  const hasDate =
    typeof usenetDateUnixSeconds === 'number' &&
    Number.isFinite(usenetDateUnixSeconds);
  if (!trimmedPoster && !hasDate) return null;

  const dayBucket = hasDate
    ? Math.floor(usenetDateUnixSeconds / SECONDS_PER_DAY)
    : 0;
  const canonical = `${size}|${trimmedPoster.toLowerCase()}|${dayBucket}`;
  const digest = createHash('sha256').update(canonical, 'utf8').digest();
  return `wd1:${digest.subarray(0, 16).toString('hex')}`;
}

/**
 * Coerce an indexer-supplied date (epoch seconds or millis, a Date, or a
 * date string) to unix seconds, or null when it cannot be trusted.
 *
 * Strings are only accepted when they resolve to the same instant on every
 * host: a bare ISO date (parsed as UTC) or a string with an explicit zone.
 * A timezone-less datetime would bucket the fingerprint differently per
 * host locale, so it is rejected.
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
    return Math.floor(value > EPOCH_MILLIS_THRESHOLD ? value / 1000 : value);
  }

  const text = value.trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return Math.floor(n > EPOCH_MILLIS_THRESHOLD ? n / 1000 : n);
  }

  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const hasTime = /\d{1,2}:\d{2}/.test(text);
  const zoned =
    hasTime && /(?:Z|\b(?:GMT|UTC|UT)\b|[+-]\d{2}:?\d{2})\s*$/i.test(text);
  if (!isoDateOnly && !zoned) return null;

  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
