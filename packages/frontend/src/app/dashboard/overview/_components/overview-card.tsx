import React from 'react';
import { Link } from '@tanstack/react-router';
import { BiChevronRight } from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';

/**
 * An overview widget that is entirely a link through to its full view.
 */
export function OverviewCard({
  to,
  icon: Icon,
  title,
  aside,
  className,
  children,
}: {
  to: string;
  icon: React.ElementType;
  title: string;
  /** Live summary shown at the right of the header, before the chevron. */
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--muted]"
    >
      <Card
        className={cn(
          'flex h-full min-w-0 flex-col gap-3 p-4 transition-colors',
          'group-hover:border-[--muted]/40 group-hover:bg-[--subtle]/50',
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className="shrink-0 text-[--muted] transition-colors group-hover:text-[--foreground]" />
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-[--muted]">
            {aside}
            <BiChevronRight className="text-base transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
        {children}
      </Card>
    </Link>
  );
}

/** Shared empty/error line so the three cards read the same when quiet. */
export function CardNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs italic text-[--muted]">{children}</p>;
}
