import React from 'react';
import { t } from '@lingui/core/macro';
import type { SidebarItem } from '@aiostreams/ui/shared/sidebar';
import { cn } from '@aiostreams/ui/core/styling';
import { BrandLogo } from '@/components/brand-logo';
import { BarSurface } from '@/components/shell/bar-surface';
import { ENTER_CURRENT, NavEntry, select } from './common';
import { YouIcon } from './account';

/** A TV's navigation down the side, which opens out with names while it has focus. */
export function TvRail({
  items,
  footerItems,
  you,
  open,
  floating = false,
}: {
  items: SidebarItem[];
  footerItems: SidebarItem[];
  you: SidebarItem;
  /** Always shows the names. */
  open: boolean;
  floating?: boolean;
}) {
  const label =
    open || !floating
      ? undefined
      : 'opacity-0 transition-opacity group-focus-within/rail:opacity-100';
  // Shut, the clear panel is clipped to its icons; its buttons keep pointer events and the icons' width, which focus moves need.
  const reach =
    !open &&
    !floating &&
    'pointer-events-auto w-14 group-focus-within/rail:w-full';
  const entry = (item: SidebarItem) => {
    const Icon = item.iconType;
    return (
      <NavEntry
        key={item.id}
        item={item}
        icon={Icon && <Icon />}
        onClick={select(item)}
        labelClassName={label}
        className={cn('w-full', reach)}
      />
    );
  };
  const account = (
    <NavEntry
      aria-label={you.name}
      item={{ id: 'account', name: t`You` }}
      icon={<YouIcon />}
      onClick={select(you)}
      labelClassName={label}
      className={cn('w-full', reach)}
    />
  );
  const divider = <div className="mx-3 my-1 h-px flex-none bg-white/10" />;
  const shade = !open && (
    <div className="pointer-events-none fixed inset-y-0 start-0 -z-10 w-[36rem] bg-gradient-to-r from-black via-black/85 to-transparent rtl:bg-gradient-to-l opacity-0 transition-opacity duration-200 will-change-[opacity] group-focus-within/rail:opacity-100" />
  );
  if (floating) {
    return (
      <nav
        data-ui="tv-rail"
        data-shape="floating"
        data-nav-enter={ENTER_CURRENT}
        data-nav-back="start"
        // Open, it covers the page's first column.
        data-nav-exit="end"
        className="group/rail fixed inset-y-0 start-0 z-50 flex items-center ps-6"
      >
        {shade}
        <BarSurface
          className={cn(
            'flex flex-col gap-1 rounded-[1.875rem] p-1.5 transition-[width] duration-200',
            open ? 'w-56' : 'w-[calc(4rem+2px)] group-focus-within/rail:w-56'
          )}
        >
          {account}
          {divider}
          {items.map(entry)}
          {divider}
          {footerItems.map(entry)}
        </BarSurface>
      </nav>
    );
  }
  const logo = (
    <BrandLogo className="mx-3.5 mb-6 h-8 w-6 flex-none object-contain" />
  );
  const glyph = (
    item: Pick<SidebarItem, 'id' | 'isCurrent'>,
    icon: React.ReactNode
  ) => (
    <span
      key={item.id}
      className={cn(
        'flex h-12 flex-none items-center rounded-full px-3.5',
        item.isCurrent ? 'bg-white/10 text-white' : 'text-gray-400'
      )}
    >
      <span className="flex w-6 justify-center text-2xl">{icon}</span>
    </span>
  );
  return (
    <nav
      data-ui="tv-rail"
      data-nav-enter={ENTER_CURRENT}
      data-nav-back="start"
      // Open, it covers the page beside it, which can leave nothing in line.
      data-nav-exit="end"
      className={cn(
        'group/rail absolute inset-y-0 start-0',
        open
          ? 'w-full'
          : 'pointer-events-none w-64 focus-within:pointer-events-auto'
      )}
    >
      {shade}
      {!open && (
        // The open panel fades in over these, as a changing width lays the page out every frame.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-0 flex w-20 flex-col gap-1 px-3 py-8 transition-opacity duration-200 will-change-[opacity] group-focus-within/rail:opacity-0"
        >
          {logo}
          {glyph({ id: 'account' }, <YouIcon />)}
          {divider}
          {items.map((item) => glyph(item, item.iconType && <item.iconType />))}
          <div className="mt-auto flex flex-col gap-1">
            {footerItems.map((item) =>
              glyph(item, item.iconType && <item.iconType />)
            )}
          </div>
        </div>
      )}
      <div
        className={cn(
          'flex h-full flex-col gap-1 px-3 py-8',
          !open &&
            'opacity-0 transition-opacity duration-200 will-change-[opacity] [clip-path:inset(0_calc(100%-5rem)_0_0)] group-focus-within/rail:opacity-100 group-focus-within/rail:[clip-path:none]'
        )}
      >
        {logo}
        {account}
        {divider}
        {items.map(entry)}
        <div className="mt-auto flex flex-col gap-1">
          {footerItems.map(entry)}
        </div>
      </div>
    </nav>
  );
}
