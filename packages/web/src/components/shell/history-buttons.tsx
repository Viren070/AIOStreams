import React from 'react';
import { t } from '@lingui/core/macro';
import { useRouterState } from '@tanstack/react-router';
import { LuCircleArrowLeft, LuCircleArrowRight } from 'react-icons/lu';
import { HoverCard } from '@aiostreams/ui/hover-card';
import type { IconType } from 'react-icons';
import { cn } from '@aiostreams/ui/core/styling';
import { currentHost } from '@/lib/hosts';
import { pageRtl } from '@/lib/direction';

interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Styled as the sidebar's items, whose icons lift on hover. */
function HistoryButton({
  label,
  icon: Icon,
  className,
  ...props
}: {
  label: string;
  icon: IconType;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'group/history flex size-10 items-center justify-center rounded-full text-[--muted] transition hover:text-[--foreground] disabled:pointer-events-none disabled:opacity-40',
        className
      )}
      {...props}
    >
      <Icon className="text-2xl transition group-hover/history:-rotate-2 group-hover/history:scale-[1.05] rtl:-scale-x-100 rtl:group-hover/history:rotate-2 rtl:group-hover/history:-scale-x-[1.05]" />
    </button>
  );
}

/** Back, and forward on hover, where no browser around the app has them. */
export function HistoryButtons({ top = false }: { top?: boolean }) {
  useRouterState({ select: (s) => s.location.href });
  if (
    currentHost().name === 'browser' &&
    !matchMedia('(display-mode: standalone)').matches
  )
    return null;
  // Engines without the Navigation API leave both on.
  const nav = (window as { navigation?: NavigationHistory }).navigation;
  const back = (
    <HistoryButton
      data-name="back"
      label={t`Back`}
      icon={LuCircleArrowLeft}
      disabled={nav?.canGoBack === false}
      onClick={() => window.history.back()}
    />
  );
  return (
    <div
      data-ui={top ? 'top-history' : 'sidebar-history'}
      className={
        top ? 'flex' : 'flex w-full flex-col items-center gap-3 px-4 pt-3'
      }
    >
      {!top && <span aria-hidden className="h-px w-8 bg-white/10" />}
      {nav?.canGoForward === false ? (
        back
      ) : (
        <HoverCard
          side={top ? 'bottom' : pageRtl() ? 'left' : 'right'}
          sideOffset={0}
          openDelay={150}
          closeDelay={150}
          className={cn(
            'w-auto border-none bg-transparent p-0 shadow-none',
            top ? 'pt-1.5' : 'ps-1.5'
          )}
          trigger={<span className="flex">{back}</span>}
        >
          <HistoryButton
            data-name="forward"
            label={t`Forward`}
            icon={LuCircleArrowRight}
            className="border border-white/10 bg-[--paper] shadow-lg shadow-black/50"
            onClick={() => window.history.forward()}
          />
        </HoverCard>
      )}
    </div>
  );
}
