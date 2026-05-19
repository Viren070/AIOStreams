/**
 * Utility functions for time parsing, formatting, and conversion.
 */

// Constants for time units in milliseconds
export enum Time {
  Second = 1000,
  Minute = 60 * 1000,
  Hour = 60 * 60 * 1000,
  Day = 24 * 60 * 60 * 1000,
}

const UNIT_MS: Record<string, number> = {
  s: Time.Second,
  m: Time.Minute,
  h: Time.Hour,
  d: Time.Day,
  w: 7 * Time.Day,
};

/**
 * Parses a duration string into milliseconds. Accepts a single unit
 * (e.g. "5s", "2m", "1h", "1d", "2w") or a compound expression with
 * optional whitespace between parts (e.g. "1h30m", "2w 3d").
 *
 * This round-trips with {@link formatDurationAsText} (which emits up to two
 * units, including weeks).
 * @param timeStr The time string to parse
 * @returns The time in milliseconds
 */
export function parseTime(timeStr: string): number {
  const compact = timeStr.replace(/\s+/g, '').toLowerCase();
  const partRegex = /(\d+)(w|d|h|m|s)/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = partRegex.exec(compact)) !== null) {
    total += parseInt(match[1], 10) * UNIT_MS[match[2]];
    consumed += match[0].length;
  }
  // Reject anything with leftover, non-duration characters (e.g. "abc",
  // "1x", "1h foo") so callers can fall back / surface a validation error.
  if (consumed === 0 || consumed !== compact.length) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }
  return total;
}

/**
 * Formats a duration in seconds to a human-readable text string.
 * Shows at most two units for readability (e.g. "2w 3d", "1h 30m", "45s").
 * @param seconds Duration in seconds
 * @returns Formatted string like "2m 30s", "1h 15m", "3d 2h"
 */
export function formatDurationAsText(seconds: number): string {
  if (seconds < 0) {
    return 'Invalid input';
  }
  if (seconds === 0) {
    return '0s';
  }
  if (seconds < 60) {
    return seconds % 1 === 0 ? `${seconds}s` : `${seconds.toFixed(2)}s`;
  }

  const timeUnits = [
    { unit: 'w', secondsInUnit: 604800 },
    { unit: 'd', secondsInUnit: 86400 },
    { unit: 'h', secondsInUnit: 3600 },
    { unit: 'm', secondsInUnit: 60 },
    { unit: 's', secondsInUnit: 1 },
  ];

  let remainingSeconds = seconds;
  const parts: string[] = [];

  for (const { unit, secondsInUnit } of timeUnits) {
    if (remainingSeconds >= secondsInUnit) {
      const value = Math.floor(remainingSeconds / secondsInUnit);
      parts.push(`${value}${unit}`);
      remainingSeconds %= secondsInUnit;
    }
  }

  return parts.slice(0, 2).join(' ');
}

/**
 * Returns a human-readable string of the time elapsed since a given point.
 * @param point The starting timestamp in milliseconds (e.g. from Date.now())
 * @returns Formatted elapsed time like "150.00ms", "2m 30s"
 */
export function getTimeTakenSincePoint(point: number): string {
  const timeNow = new Date().getTime();
  const duration = timeNow - point;
  if (duration < 1000) {
    return `${duration.toFixed(2)}ms`;
  }
  return formatDurationAsText(duration / 1000);
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 * For sub-second values shows milliseconds, otherwise delegates to formatDurationAsText.
 * @param ms Duration in milliseconds
 * @returns Formatted string like "150ms", "2m 30s"
 */
export function formatMilliseconds(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return formatDurationAsText(ms / 1000);
}
