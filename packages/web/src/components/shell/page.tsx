import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';

/** The padded column a page renders into. */
export function PageBody({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-ui="page-body"
      className="relative z-[1] space-y-8 px-4 pb-16 pt-[calc(1.5rem+env(safe-area-inset-top))] lg:ps-0 lg:pe-10 lg:pt-[calc(2.5rem+env(safe-area-inset-top))]"
    >
      {children}
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
