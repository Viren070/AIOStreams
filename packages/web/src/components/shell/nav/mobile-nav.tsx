import React from 'react';
import { t } from '@lingui/core/macro';
import type { SidebarItem } from '@aiostreams/ui/shared/sidebar';
import { cn } from '@aiostreams/ui/core/styling';
import { BarSurface } from '@/components/shell/bar-surface';
import { useScrollAway } from '@/components/shell/page-scroll';
import { NavTab, onBar, select } from './common';
import { AccountMenu, YouIcon } from './account';

export function MobileNav({
  items,
  places,
  menuItems,
  wide,
  named,
}: {
  items: SidebarItem[];
  places: SidebarItem[];
  menuItems: SidebarItem[];
  /** Shown on wide screens too, in place of the sidebar. */
  wide: boolean;
  named: boolean;
}) {
  const inMenu = [...places.filter((item) => !onBar(item)), ...menuItems].some(
    (item) => item.isCurrent
  );
  // The same height either way, as pages keep the bar's room free.
  const tab = cn(
    'gap-0.5 rounded-full px-1 text-[0.65rem]',
    named ? 'flex-1 py-1.5' : 'w-12 py-3'
  );
  const nav = React.useRef<HTMLElement>(null);
  const [away, show] = useScrollAway(nav, true);
  return (
    <nav
      ref={nav}
      data-ui="mobile-nav"
      data-names={named ? 'shown' : 'hidden'}
      data-away={away || undefined}
      onFocus={show}
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(0.25rem+env(safe-area-inset-bottom))] transition-transform duration-200 ease-out will-change-transform data-[away]:translate-y-full',
        !wide && 'lg:hidden'
      )}
    >
      <BarSurface
        className={cn(
          'pointer-events-auto flex items-center gap-1 rounded-full p-1.5',
          named && 'w-full max-w-md'
        )}
      >
        {items.map((item) => {
          const Icon = item.iconType;
          return (
            <NavTab
              key={item.id}
              data-ui="mobile-nav-item"
              data-shown={onBar(item) || undefined}
              item={item}
              icon={Icon && <Icon className={named ? 'text-xl' : 'text-2xl'} />}
              onClick={select(item)}
              named={named}
              className={tab}
            />
          );
        })}
        <AccountMenu
          side="top"
          align="end"
          sideOffset={12}
          places={places}
          items={menuItems}
          trigger={
            <NavTab
              data-ui="mobile-nav-item"
              aria-label={t`Account`}
              item={{ id: 'account', name: t`You`, isCurrent: inMenu }}
              icon={<YouIcon />}
              named={named}
              className={tab}
            />
          }
        />
      </BarSurface>
    </nav>
  );
}
