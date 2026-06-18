/**
 * Shared, human-readable formatting helpers used across the dashboard and the
 * config UI. Everything that turns a raw number (bytes, bits/s, seconds, …)
 * into display text lives here so the whole app formats consistently.
 *
 * Byte/bitrate sizes use SI units (k = 1000) — i.e. KB/MB/GB, not the binary
 * KiB/MiB. This matches how debrid/usenet providers and most consumer tools
 * report sizes and speeds.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
const BIT_UNITS = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'] as const;
const SI = 1000;

interface BytesOptions {
  /** Returned when the value is null/undefined/NaN. Defaults to `'—'`. */
  placeholder?: string;
}

/**
 * Format a byte count with an SI unit (k = 1000), e.g. `0 B`, `512 B`,
 * `1.5 MB`, `4.2 GB`. Whole bytes are shown without decimals; everything
 * larger uses a single decimal place. Nullish/NaN inputs render the
 * `placeholder` (default `'—'`).
 */
export function formatBytes(
  bytes: number | null | undefined,
  { placeholder = '—' }: BytesOptions = {}
): string {
  if (bytes == null || !Number.isFinite(bytes)) return placeholder;
  if (bytes === 0) return '0 B';
  const i = Math.min(
    BYTE_UNITS.length - 1,
    Math.max(0, Math.floor(Math.log(Math.abs(bytes)) / Math.log(SI)))
  );
  return `${(bytes / SI ** i).toFixed(i === 0 ? 0 : 1)} ${BYTE_UNITS[i]}`;
}

/**
 * Format a transfer rate in bytes/second, e.g. `0 B/s`, `12.3 MB/s`. Built on
 * {@link formatBytes}, so the same SI units and placeholder rules apply.
 */
export function formatSpeed(
  bytesPerSec: number | null | undefined,
  options?: BytesOptions
): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec)) {
    return formatBytes(bytesPerSec, options);
  }
  return `${formatBytes(bytesPerSec, options)}/s`;
}

/**
 * Format a bitrate in bits/second with an SI unit (k = 1000), e.g. `0 bps`,
 * `4.5 Mbps`. When `round` is set the scaled value is rounded to a whole
 * number instead of one decimal place.
 */
export function formatBitrate(bitrate: number, round = false): string {
  if (!Number.isFinite(bitrate) || bitrate <= 0) return '0 bps';
  const i = Math.min(
    BIT_UNITS.length - 1,
    Math.max(0, Math.floor(Math.log(bitrate) / Math.log(SI)))
  );
  const scaled = bitrate / SI ** i;
  const value = round ? Math.round(scaled) : parseFloat(scaled.toFixed(1));
  return `${value} ${BIT_UNITS[i]}`;
}

/**
 * Format a percentage from a 0–1 ratio, e.g. `0.5` → `50.0%`. Very small
 * non-zero ratios (< 0.1%) get a second decimal so they don't collapse to
 * `0.0%`.
 */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0%';
  return `${(ratio * 100).toFixed(ratio > 0 && ratio < 0.001 ? 2 : 1)}%`;
}

const DURATION_UNITS: Array<[string, number]> = [
  ['w', 604800],
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
];

/**
 * Format a duration given in seconds as up to two coarse units, e.g. `45s`,
 * `2m 30s`, `1h 5m`, `3d 2h`, `1w 4d`. Sub-second and negative inputs clamp to
 * `0s`.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0s';
  const s = Math.max(0, Math.round(seconds));
  if (s < 1) return '0s';
  if (s < 60) return `${s}s`;
  for (let i = 0; i < DURATION_UNITS.length; i++) {
    const [unit, size] = DURATION_UNITS[i];
    const n = Math.floor(s / size);
    if (n > 0) {
      const rem = s - n * size;
      const next = DURATION_UNITS[i + 1];
      if (next && rem > 0) {
        const m = Math.floor(rem / next[1]);
        if (m > 0) return `${n}${unit} ${m}${next[0]}`;
      }
      return `${n}${unit}`;
    }
  }
  return '0s';
}

const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse a human duration into **milliseconds**. Accepts decimals and a unit
 * (`ms`/`s`/`m`/`h`/`d`/`w`), single or compound (e.g. `"1.2s"` → 1200,
 * `"500ms"` → 500, `"1h30m"` → 5400000). A bare number is treated as
 * milliseconds. Returns `null` for anything unparseable so a field can surface
 * a validation error without committing a bad value.
 *
 * Mirror of core `parseTime` (duplicated here on purpose — importing core pulls
 * in env/server code the frontend bundle can't take). Round-trips with
 * {@link formatDurationMs}.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  // Bare number = milliseconds.
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }
  const compact = t.replace(/\s+/g, '').toLowerCase();
  // `ms` must precede `m`/`s` in the alternation so "500ms" isn't read as "m".
  const re = /(\d+(?:\.\d+)?)(ms|w|d|h|m|s)/g;
  let total = 0;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(compact)) !== null) {
    total += parseFloat(m[1]) * DURATION_UNIT_MS[m[2]];
    consumed += m[0].length;
  }
  if (consumed === 0 || consumed !== compact.length) return null;
  return Math.round(total);
}

/**
 * Format a millisecond duration as a friendly, round-trippable string:
 * `0ms`, `850ms`, `1.5s`, `30s`, `2m 30s`, `1h 5m`, `2w 3d`. Sub-second values
 * show `ms`; sub-minute values show seconds (with up to 2 decimals); larger
 * values use up to two coarse units. Pairs with {@link parseDuration}.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms === 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${parseFloat(s.toFixed(2))}s`;
  const units: Array<[string, number]> = [
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  let rem = Math.round(s);
  const parts: string[] = [];
  for (const [unit, size] of units) {
    if (rem >= size) {
      parts.push(`${Math.floor(rem / size)}${unit}`);
      rem %= size;
    }
  }
  return parts.slice(0, 2).join(' ');
}

/**
 * Format an elapsed/remaining duration given in milliseconds as a clock,
 * e.g. `0:45`, `12:05`, `1:02:30`. Hours are only shown when non-zero.
 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Format a short latency/duration given in milliseconds with adaptive units,
 * e.g. `850 ms`, `3.2 s`, `1m 30s`. Nullish inputs render `'—'`.
 */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/**
 * Compact number formatting for dashboard stats. Large values collapse to a
 * K / M / B suffix with smart precision: one decimal place while the scaled
 * value is below 100 (e.g. `1.2K`, `12.3M`), none above it (e.g. `123K`,
 * `500K`). Trailing `.0` is dropped, and anything under 1,000 is shown in full.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs < 1000) return value.toLocaleString();

  const units = [
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ];
  for (const u of units) {
    if (abs >= u.v) {
      const scaled = value / u.v;
      const decimals = Math.abs(scaled) < 100 ? 1 : 0;
      let str = scaled.toFixed(decimals);
      if (str.endsWith('.0')) str = str.slice(0, -2);
      return str + u.s;
    }
  }
  return value.toLocaleString();
}

/**
 * Format a timestamp (ISO 8601 string) as a date-time in the browser's locale
 * and timezone, e.g. `6/13/2026, 3:45:12 PM`. The single helper for every
 * absolute date shown in the dashboard. Empty or unparseable inputs are
 * returned unchanged.
 */
export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
