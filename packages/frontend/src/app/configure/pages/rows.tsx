import React from 'react';
import type { IconType } from 'react-icons';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';

export interface Row {
  id: string;
  label: string;
  icon?: IconType;
  onOpen: () => void;
}

export function RowList({ title, rows }: { title?: string; rows: Row[] }) {
  return (
    <section className="space-y-2">
      {title && (
        <h3 className="px-1 text-sm font-semibold text-gray-200">{title}</h3>
      )}
      <ul className="divide-y divide-[--border] overflow-hidden rounded-xl border border-[--border] bg-gray-950/50">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={row.onOpen}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[--subtle] focus-visible:bg-[--subtle] focus-visible:outline-none"
            >
              {row.icon && (
                <row.icon className="h-4 w-4 shrink-0 text-[--muted]" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-white">
                {row.label}
              </span>
              <LuChevronRight className="h-4 w-4 shrink-0 text-[--muted]" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DrillIn({
  id,
  back,
  title,
  onBack,
  children,
}: {
  id?: string;
  back: string;
  title?: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="space-y-4">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 hidden items-center gap-1 rounded-full px-1 text-sm text-[--muted] hover:text-white md:flex"
        >
          <LuChevronLeft className="h-4 w-4" />
          {back}
        </button>
        {title && (
          <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
        )}
      </div>
      {children}
    </div>
  );
}
