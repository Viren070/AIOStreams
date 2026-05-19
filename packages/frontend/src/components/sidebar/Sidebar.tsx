import React from 'react';
import { AppSidebar, useAppSidebarContext } from '@/components/ui/app-layout';
import { cn } from '@/components/ui/core/styling';
import { VerticalMenu, VerticalMenuItem } from '@/components/ui/vertical-menu';

export type SidebarItem = VerticalMenuItem;

interface SidebarProps {
  /** Optional content rendered above the menu (logo, search, …). */
  header?: React.ReactNode;
  /** Menu items. */
  items: SidebarItem[];
  /**
   * Bottom action items (donate, configure, sign out, …). Rendered with the
   * same pill / icon styling as the main menu so footer actions don't look
   * like out-of-place outline buttons.
   */
  footerItems?: SidebarItem[];
  /** Optional custom content rendered at the very bottom (modals, etc.). */
  footer?: React.ReactNode;
  onItemSelect?: (item: SidebarItem) => void;
  onFooterItemSelect?: (item: SidebarItem) => void;
  className?: string;
}

/**
 * Presentational sidebar shell shared by the configure page and the
 * dashboard. Holds no app/menu state — selection is driven by `isCurrent`
 * on each item and the `onItemSelect` callback.
 */
export function Sidebar({
  header,
  items,
  footerItems,
  footer,
  onItemSelect,
  onFooterItemSelect,
  className,
}: SidebarProps) {
  const ctx = useAppSidebarContext();
  const isCollapsed = !ctx.isBelowBreakpoint;

  return (
    <AppSidebar
      className={cn(
        'h-full flex flex-col justify-between w-full',
        !ctx.isBelowBreakpoint && 'bg-transparent',
        className
      )}
    >
      <div>
        {header}
        <VerticalMenu
          className="px-4"
          collapsed={isCollapsed}
          isSidebar
          itemClass="relative"
          items={items}
          onItemSelect={(item) => {
            onItemSelect?.(item);
            ctx.setOpen(false);
          }}
        />
      </div>
      {(footerItems?.length || footer) && (
        <div className="p-4 gap-2 flex flex-col">
          {footerItems && footerItems.length > 0 && (
            <VerticalMenu
              collapsed={isCollapsed}
              isSidebar
              itemClass="relative"
              items={footerItems}
              onItemSelect={(item) => {
                onFooterItemSelect?.(item);
                ctx.setOpen(false);
              }}
            />
          )}
          {footer}
        </div>
      )}
    </AppSidebar>
  );
}
