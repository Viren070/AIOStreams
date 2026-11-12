import { t } from '@lingui/core/macro';
import type { SidebarItem } from '@aiostreams/ui/shared/sidebar';
import { cn } from '@aiostreams/ui/core/styling';
import { BarSurface } from '@/components/shell/bar-surface';
import { Logo, NavTab, select } from './common';
import { YouIcon } from './account';

/** The sidebar on a touch screen: each item big enough for a finger. */
export function TouchRail({
  items,
  footerItems,
  you,
  named,
  floating = false,
}: {
  items: SidebarItem[];
  footerItems: SidebarItem[];
  you: SidebarItem;
  named: boolean;
  floating?: boolean;
}) {
  const tab = cn(
    'w-full gap-1 rounded-2xl px-0.5 text-[0.7rem]',
    named ? 'py-2.5' : 'py-3'
  );
  const railItem = (item: SidebarItem) => {
    const Icon = item.iconType;
    return (
      <NavTab
        key={item.id}
        data-ui="rail-item"
        item={item}
        icon={Icon && <Icon className="text-2xl" />}
        named={named}
        onClick={select(item)}
        className={tab}
      />
    );
  };
  const account = (
    <NavTab
      data-ui="rail-item"
      aria-label={you.name}
      item={{ id: 'account', name: t`You` }}
      icon={<YouIcon />}
      named={named}
      onClick={select(you)}
      className={tab}
    />
  );
  if (floating) {
    return (
      <nav
        data-ui="touch-rail"
        data-shape="floating"
        className="pointer-events-none fixed inset-y-0 start-0 z-50 hidden items-center py-4 ps-[calc(1rem+env(safe-area-inset-left))] lg:flex"
      >
        <BarSurface
          className={cn(
            'pointer-events-auto flex max-h-full flex-col gap-1 overflow-y-auto rounded-[1.375rem] p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            named ? 'w-[calc(4.75rem+2px)]' : 'w-[calc(3.75rem+2px)]'
          )}
        >
          {items.map(railItem)}
          <div className="mx-2 my-1 h-px flex-none bg-white/10" />
          {footerItems.map(railItem)}
          {account}
        </BarSurface>
      </nav>
    );
  }
  return (
    <nav
      data-ui="touch-rail"
      className="flex h-full flex-col items-center gap-1 overflow-y-auto px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Logo />
      {items.map(railItem)}
      <div className="mt-auto flex w-full flex-col gap-1 pt-4">
        {footerItems.map(railItem)}
        {account}
      </div>
    </nav>
  );
}
