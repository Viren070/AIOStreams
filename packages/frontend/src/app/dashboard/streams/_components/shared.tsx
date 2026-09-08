import React from 'react';
import { BiCloudDownload, BiLayer, BiNetworkChart } from 'react-icons/bi';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/core/styling';
import type { LiveStreamSession, StreamTransport } from '../queries';

const TRANSPORTS: Record<
  StreamTransport,
  { label: string; icon: React.ElementType; className: string }
> = {
  usenet: {
    label: 'Usenet',
    icon: BiCloudDownload,
    className: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  },
  proxy: {
    label: 'Proxy',
    icon: BiNetworkChart,
    className: 'border-teal-500/40 bg-teal-500/10 text-teal-300',
  },
};

/** Which byte-serving path a row came from. */
export function TransportBadge({
  transport,
  className,
}: {
  transport: StreamTransport;
  className?: string;
}) {
  const t = TRANSPORTS[transport] ?? TRANSPORTS.proxy;
  const Icon = t.icon;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        t.className,
        className
      )}
    >
      <Icon className="text-xs" />
      {t.label}
    </span>
  );
}

const PILL_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-md border border-[--border] px-1.5 py-0.5 text-[10px] font-medium text-[--muted]';

/** Neutral pill for secondary row metadata. */
export function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn(PILL_CLASS, className)}>{children}</span>;
}

/**
 * Range reads open on a session right now. Reads fold into one row, so this is
 * the only place a pile-up shows.
 */
export function ActiveReadsPill({ reads }: { reads: number }) {
  return (
    <Tooltip
      trigger={
        <Pill className="border-amber-500/40 bg-amber-500/10 text-amber-300">
          <BiLayer />
          {reads}
        </Pill>
      }
    >
      {reads} range requests open at once — a player normally holds one.
    </Tooltip>
  );
}

/**
 * Hide the host portion, keeping enough shape that it still reads as an
 * address. Values already coarsened server-side come back unchanged.
 */
function maskIp(ip: string): string {
  if (ip.endsWith('.x') || ip.endsWith('::/48')) return ip;
  const bare = ip.replace(/^::ffff:/i, '');
  if (bare.includes('.')) {
    const parts = bare.split('.');
    return parts.length === 4 ? `${parts[0]}.•••.•.•` : '•••';
  }
  if (bare.includes(':')) {
    const head = bare.split(':').filter(Boolean)[0];
    return head ? `${head}:•••` : '•••';
  }
  return '•••';
}

/** A viewer's address, masked until the pill is clicked. */
export function ClientIpPill({ ip }: { ip: string }) {
  const [shown, setShown] = React.useState(false);
  const masked = maskIp(ip);
  if (masked === ip) return <Pill className="font-mono">{ip}</Pill>;
  const action = shown ? 'Hide client IP' : 'Reveal client IP';
  return (
    <button
      type="button"
      onClick={() => setShown((s) => !s)}
      aria-label={action}
      aria-pressed={shown}
      title={action}
      className={cn(
        PILL_CLASS,
        'font-mono transition-colors hover:border-[--muted] hover:text-[--foreground]'
      )}
    >
      {shown ? ip : masked}
    </button>
  );
}

/**
 * Segmented control whose selection reads from elevation rather than an accent
 * colour, so a row of filters doesn't compete with the data beside it.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ label: string; value: T }>;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-[--border] bg-[--subtle]/50 p-0.5',
        className
      )}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
              selected
                ? 'bg-[--paper] text-[--foreground] shadow-sm'
                : 'text-[--muted] hover:text-[--foreground]'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** What to call a session in a list. */
export function streamLabel(s: LiveStreamSession): string {
  return s.filename || s.displayUrl || s.targetKey;
}

/** Progress = (range start + bytes of the current read) / size, clamped. */
export function streamProgress(s: LiveStreamSession): number {
  if (!s.size) return 0;
  return Math.min(1, Math.max(0, (s.start + s.currentBytes) / s.size));
}

/** Streams with no resolvable user (tokens minted before owner tracking). */
export const UNKNOWN_USER = 'unidentified';

export function displayUser(username: string): string {
  return username || UNKNOWN_USER;
}

/** Short relative time, e.g. `12s ago`, `4m ago`. */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Human label for how long a block lasts. */
export const BAN_DURATIONS: Array<{ label: string; ms?: number }> = [
  { label: '15 minutes', ms: 15 * 60_000 },
  { label: '1 hour', ms: 60 * 60_000 },
  { label: '24 hours', ms: 24 * 60 * 60_000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60_000 },
  { label: 'Until lifted' },
];
