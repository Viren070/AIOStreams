import { cn } from '@/components/ui/core/styling';
import { formatBytes } from '@/lib/format';
import type { BandwidthOverview } from '../queries';

const DAY_MS = 86_400_000;

/** Guard against an unexpected bucket width turning the fill into a long loop. */
const MAX_BUCKETS = 400;

// Day buckets are floored against the epoch, so they are UTC days
const dayFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const fullDayFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const fullTimeFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Terse axis label; the tooltip carries the full date. */
function bucketLabel(ms: number, bucketMs: number): string {
  const d = new Date(ms);
  if (bucketMs < DAY_MS) return `${String(d.getHours()).padStart(2, '0')}:00`;
  return dayFmt.format(d);
}

function bucketTooltip(ms: number, bucketMs: number): string {
  return bucketMs < DAY_MS
    ? fullTimeFmt.format(new Date(ms))
    : fullDayFmt.format(new Date(ms));
}

/**
 * Every bucket boundary in the window, empty ones included. The rollups only
 * hold buckets that saw traffic, so charting them directly draws a quiet
 * stretch as one step.
 */
function windowBuckets(d: BandwidthOverview): number[] {
  const width = d.bucketMs > 0 ? d.bucketMs : DAY_MS;
  const first = Math.floor(d.sinceMs / width) * width;
  const last = Math.floor(d.generatedAt / width) * width;
  const out: number[] = [];
  for (let t = first; t <= last && out.length < MAX_BUCKETS; t += width) {
    out.push(t);
  }
  return out;
}

/** One chart row per bucket: a terse axis label, a fuller tooltip heading and
 *  the total served. Callers wanting per-user lines layer their own keys on. */
export interface BandwidthRow extends Record<string, string | number> {
  /** The bucket boundary itself, so callers can join other series onto it. */
  ms: number;
  t: string;
  at: string;
  bytes: number;
}

export function bandwidthRows(d: BandwidthOverview): BandwidthRow[] {
  const total = new Map(d.series.map((b) => [b.bucketMs, b.bytes]));
  return windowBuckets(d).map((t) => ({
    ms: t,
    t: bucketLabel(t, d.bucketMs),
    at: bucketTooltip(t, d.bucketMs),
    bytes: total.get(t) ?? 0,
  }));
}

/** Usage against a cap, or a plain total when the cap is disabled. */
export function UsageBar({ used, limit }: { used: number; limit: number }) {
  if (limit <= 0) {
    return <span className="tabular-nums">{formatBytes(used)}</span>;
  }
  const ratio = Math.min(1, used / limit);
  const tone =
    ratio >= 1 ? 'bg-red-400' : ratio >= 0.85 ? 'bg-amber-500' : 'bg-brand';
  return (
    <div className="flex min-w-[160px] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[--subtle]">
        <div
          className={cn('h-full', tone)}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-[--muted]">
        {formatBytes(used)} / {formatBytes(limit)}
      </span>
    </div>
  );
}
