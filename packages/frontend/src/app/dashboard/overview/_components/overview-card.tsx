import React from 'react';
import { Link } from '@tanstack/react-router';
import { BiChevronRight } from 'react-icons/bi';
import { Card } from '@aiostreams/ui/card';
import { cn } from '@aiostreams/ui/core/styling';

/** An overview widget; with `to`, the whole card links to its full view. */
export function OverviewCard({
  to,
  icon: Icon,
  title,
  aside,
  className,
  children,
}: {
  to?: string;
  icon: React.ElementType;
  title: string;
  /** Live summary shown at the right of the header, before the chevron. */
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const card = (
    <Card
      className={cn(
        'flex h-full min-w-0 flex-col gap-3 p-4',
        to &&
          'transition-colors group-hover:border-[--muted]/40 group-hover:bg-[--subtle]/50',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            'shrink-0 text-[--muted]',
            to && 'transition-colors group-hover:text-[--foreground]'
          )}
        />
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-[--muted]">
          {aside}
          {to && (
            <BiChevronRight className="text-base transition-transform group-hover:translate-x-0.5" />
          )}
        </div>
      </div>
      {children}
    </Card>
  );

  if (!to) return card;
  return (
    <Link
      to={to}
      className="group block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--muted]"
    >
      {card}
    </Link>
  );
}

/**
 * One reading. `ratio` only colours the figure once it is worth noticing; the
 * value itself carries the detail, so there is no track to read against.
 */
export function Reading({
  label,
  value,
  hint,
  ratio,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  ratio?: number;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs uppercase tracking-wide text-[--muted]">
        {label}
      </div>
      <div
        className={cn(
          'truncate text-lg font-semibold tabular-nums',
          ratio != null && ratio >= 0.95 && 'text-red-400',
          ratio != null && ratio >= 0.85 && ratio < 0.95 && 'text-amber-500'
        )}
      >
        {value}
      </div>
      {hint && <div className="truncate text-xs text-[--muted]">{hint}</div>}
    </div>
  );
}

/** Shared empty/error line so the three cards read the same when quiet. */
export function CardNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs italic text-[--muted]">{children}</p>;
}
