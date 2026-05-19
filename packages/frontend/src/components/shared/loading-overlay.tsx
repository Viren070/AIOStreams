import React from 'react';
import { cn } from '@/components/ui/core/styling';
import { Spinner } from '@/components/ui/loading-spinner';
import { TextGenerateEffect } from './text-generate-effect';

/**
 * The single, canonical full-screen loading state for the whole app
 * (configure, dashboard, route guards). Keeping one component here means
 * navigating between guard → page never swaps loaders, so there is no flash.
 *
 * It also waits a short beat before appearing and then fades in: loads that
 * resolve quickly (the common case) finish before the delay and the user sees
 * nothing at all, instead of a logo that blinks for ~200ms.
 */
export function LoadingOverlayWithLogo({ title }: { title?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[--background]">
      <div
        className={cn(
          'flex flex-col items-center gap-6 transition-opacity duration-300 ease-out',
          'opacity-100'
        )}
      >
        {/* <img
          src="/logo.png"
          alt="AIOStreams"
          className="h-16 w-16 object-contain select-none"
          draggable={false}
        /> */}
        <Spinner className="w-10 h-10 m-0" />
        {title && (
          <TextGenerateEffect
            words={title || 'Loading...'}
            className="text-2xl"
          />
        )}
      </div>
    </div>
  );
}
