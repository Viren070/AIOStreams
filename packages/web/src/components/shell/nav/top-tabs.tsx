import React from 'react';
import {
  BarWindowButtons,
  pageDrawsWindowButtons,
} from '@/components/shell/window-controls';
import { Tooltip } from '@aiostreams/ui/tooltip';
import type { SidebarItem } from '@aiostreams/ui/shared/sidebar';
import { cn } from '@aiostreams/ui/core/styling';
import type { TopBar } from '@/lib/settings';
import { BrandLogo } from '@/components/brand-logo';
import { GlassSurface } from '@/components/shell/glass-surface';
import { useScrollAway } from '@/components/shell/page-scroll';
import { HistoryButtons } from '@/components/shell/history-buttons';
import { ENTER_CURRENT, NavEntry, select } from './common';
import { YouIcon } from './account';

/**
 * How much of the page the top bar covers: pages start below it and their
 * heroes reach up under it.
 */
export const TOP_BAR_HEIGHT: Record<TopBar, string> = {
  pill: 'calc(5.75rem + 2px)',
  bar: 'calc(5rem + 1px)',
  fade: '5.5rem',
};

/** The navigation along the top, over the page. */
export function TopTabs({
  style,
  names,
  tv,
  items,
  footerItems,
  you,
}: {
  style: TopBar;
  names: boolean;
  tv: boolean;
  items: SidebarItem[];
  footerItems: SidebarItem[];
  you: SidebarItem;
}) {
  const entry = (
    item: Pick<SidebarItem, 'id' | 'name' | 'isCurrent'>,
    icon: React.ReactNode,
    onClick: React.MouseEventHandler<HTMLButtonElement>,
    named = false
  ) => {
    const button = (
      <NavEntry
        key={item.id}
        aria-label={named ? undefined : item.name}
        item={item}
        icon={icon}
        onClick={onClick}
        labelClassName={named ? undefined : 'hidden'}
        className={cn(named && 'pe-5', !tv && 'hover:text-white')}
      />
    );
    return tv || named ? (
      button
    ) : (
      <Tooltip key={item.id} side="bottom" trigger={button}>
        {item.name}
      </Tooltip>
    );
  };
  const tab = (item: SidebarItem) => {
    const Icon = item.iconType;
    return entry(item, Icon && <Icon />, select(item), names);
  };
  const logo = (
    <div className="flex flex-none items-center gap-3">
      <BrandLogo className="h-8 w-6 flex-none object-contain" />
      {!tv && <HistoryButtons top />}
    </div>
  );
  const tabs = items.map(tab);
  // Equal sides keep the tabs centred on the window, however wide each end is.
  const row = 'relative grid grid-cols-[1fr_auto_1fr] items-center gap-6 px-10';
  const endClass = 'flex items-center justify-self-end';
  const nav = React.useRef<HTMLElement>(null);
  const [away, show] = useScrollAway(nav, !tv);
  const windowButtons = !tv && pageDrawsWindowButtons();
  const holding = windowButtons && !away;
  React.useEffect(() => {
    if (!holding) return;
    const root = document.documentElement;
    root.dataset.windowButtons = 'bar';
    return () => {
      delete root.dataset.windowButtons;
    };
  }, [holding]);
  // Grouped so CSS can also split the window buttons into a pill of their own.
  const end = (
    <>
      <div data-ui="top-tabs-actions" className="flex items-center gap-1">
        {footerItems.map((item) => {
          const Icon = item.iconType;
          return entry(item, Icon && <Icon />, select(item));
        })}
        {entry({ id: 'account', name: you.name }, <YouIcon />, select(you))}
      </div>
      {windowButtons && (
        <>
          <span
            aria-hidden
            data-ui="top-tabs-divider"
            className="mx-1 h-6 w-px bg-white/15"
          />
          <div data-ui="top-window-buttons" className="flex items-center gap-1">
            <BarWindowButtons />
          </div>
        </>
      )}
    </>
  );
  return (
    <nav
      ref={nav}
      data-ui="top-tabs"
      data-style={style}
      data-away={away || undefined}
      data-nav-enter={ENTER_CURRENT}
      data-nav-back="up"
      onFocus={show}
      className={cn(
        'inset-x-0 top-0 z-40 transition-transform duration-200 ease-out will-change-transform',
        tv ? 'absolute' : 'fixed hidden lg:block',
        // Past its scrim too. A slide rather than a fade, as fading would stop
        // its glass blurring the page.
        '[[data-in-rows]_&]:-translate-y-[180%] data-[away]:-translate-y-[180%]'
      )}
    >
      {style !== 'bar' && (
        // Keeps what sits straight on the page readable over a bright hero.
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-[180%] bg-gradient-to-b to-transparent',
            style === 'fade' ? 'from-black/85 via-black/55' : 'from-black/50'
          )}
        />
      )}
      {style === 'bar' ? (
        <GlassSurface
          className={cn(row, 'rounded-none border-x-0 border-t-0 py-4')}
        >
          {logo}
          <div className="flex items-center gap-1">{tabs}</div>
          <div data-ui="top-tabs-end" className={cn(endClass, 'gap-1')}>
            {end}
          </div>
        </GlassSurface>
      ) : style === 'pill' ? (
        <div className={cn(row, 'pb-2 pt-6')}>
          {logo}
          <GlassSurface className="flex items-center gap-1 rounded-full p-1.5">
            {tabs}
          </GlassSurface>
          <GlassSurface
            data-ui="top-tabs-end"
            className={cn(endClass, 'gap-1 rounded-full p-1.5')}
          >
            {end}
          </GlassSurface>
        </div>
      ) : (
        <div className={cn(row, 'pb-2 pt-8')}>
          {logo}
          <div className="flex items-center gap-1">{tabs}</div>
          <div data-ui="top-tabs-end" className={cn(endClass, 'gap-1')}>
            {end}
          </div>
        </div>
      )}
    </nav>
  );
}
