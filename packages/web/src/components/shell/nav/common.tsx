import React from 'react';
import type { SidebarItem } from '@aiostreams/ui/shared/sidebar';
import { cn } from '@aiostreams/ui/core/styling';
import { BrandLogo } from '@/components/brand-logo';

export function Logo() {
  return (
    <div
      data-ui="sidebar-logo"
      className="mb-4 flex w-full justify-center p-4 pb-0"
    >
      <BrandLogo className="max-h-[60px] max-w-[90px] object-contain p-4" />
    </div>
  );
}

/** An icon over its label, sized for a finger. */
export function NavTab({
  item,
  icon,
  named = true,
  className,
  ...props
}: {
  item: Pick<SidebarItem, 'id' | 'name' | 'isCurrent'>;
  icon: React.ReactNode;
  named?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-ui="nav-item"
      data-name={item.id}
      aria-current={item.isCurrent ? 'page' : undefined}
      className={cn(
        'flex min-w-0 flex-col items-center font-medium transition-colors',
        item.isCurrent
          ? 'bg-white/10 text-white'
          : 'text-gray-400 hover:text-white',
        className
      )}
      {...props}
    >
      {icon}
      <span className={cn('max-w-full truncate', !named && 'sr-only')}>
        {item.name}
      </span>
    </button>
  );
}

export function select(item: SidebarItem) {
  return (e: React.MouseEvent<HTMLButtonElement>) => {
    (document.activeElement as HTMLElement | null)?.blur();
    item.onClick?.(e);
  };
}

/** Pages the bottom bar shows; every page is in the bar and its menu, so a stylesheet can move any. */
const BAR_PAGES: ReadonlySet<string> = new Set([
  'home',
  'discover',
  'search',
  'favourites',
]);
export const onBar = (item: Pick<SidebarItem, 'id'>) =>
  !!item.id && BAR_PAGES.has(item.id);

/** Moving into a TV's navigation lands on the current page, as on TV menus. */
export const ENTER_CURRENT = '[aria-current="page"]';

/** An entry: an icon, and its name beside it where there is room. */
export function NavEntry({
  item,
  icon,
  labelClassName,
  className,
  ...props
}: {
  item: Pick<SidebarItem, 'id' | 'name' | 'isCurrent'>;
  icon: React.ReactNode;
  labelClassName?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-ui="nav-item"
      data-name={item.id}
      data-focus="own"
      aria-current={item.isCurrent ? 'page' : undefined}
      className={cn(
        'flex h-12 flex-none items-center gap-4 overflow-hidden whitespace-nowrap rounded-full px-3.5 font-medium focus-visible:text-white',
        // A shadow, as an ending background or opacity fade flashes its start for a frame in a TV's web view.
        'focus-visible:shadow-[inset_0_0_0_999px_rgb(255_255_255/0.2)]',
        item.isCurrent ? 'bg-white/10 text-white' : 'text-gray-400',
        className
      )}
      {...props}
    >
      <span className="flex w-6 flex-none justify-center text-2xl">{icon}</span>
      <span className={labelClassName}>{item.name}</span>
    </button>
  );
}
