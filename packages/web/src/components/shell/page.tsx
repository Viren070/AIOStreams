import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';

/** Every page's top, which keeps titles in one place between pages. */
export const PAGE_TOP =
  'pt-[calc(1.5rem+env(safe-area-inset-top))] lg:pt-[calc(2.5rem+env(safe-area-inset-top))]';

/** The padded column a page renders into; what follows its title sits as close on every page. */
export function PageBody({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-ui="page-body"
      className={cn(
        'relative z-[1] space-y-8 px-4 pb-16 lg:ps-0 lg:pe-10 [&>[data-ui=page-header]+*]:!mt-6 [&>[data-ui=page-title]+*]:!mt-6',
        PAGE_TOP
      )}
    >
      {children}
    </div>
  );
}

/**
 * A page's title, with its pickers and buttons to the right. Rows of pills go
 * under it, each on a line of its own, as a key crossing pills picks each.
 */
export function PageHeader({
  title,
  beside,
  actions,
}: {
  title: React.ReactNode;
  beside?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      data-ui="page-header"
      className="flex flex-wrap items-center gap-x-3 gap-y-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 data-ui="page-title" className="text-3xl font-bold">
          {title}
        </h1>
        {beside}
      </div>
      {actions && (
        // Taller than the title, so they overhang it rather than move it.
        <div
          data-ui="page-actions"
          className="-my-1 flex w-full flex-wrap items-center gap-3 sm:ms-auto sm:w-auto"
        >
          {actions}
        </div>
      )}
    </div>
  );
}

/** The window's height less the phone nav bar, which pages are padded for. */
export const FILL_WINDOW =
  'min-h-[calc(100dvh-var(--nav-bar)-var(--mini-bar,0px))]';

export function PageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-ui="page-message"
      className={cn(
        'relative z-[1] flex flex-col justify-center px-4 py-10 lg:ps-0 lg:pe-10',
        FILL_WINDOW
      )}
    >
      {children}
    </div>
  );
}
