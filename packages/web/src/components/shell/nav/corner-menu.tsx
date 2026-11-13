import React from 'react';
import { t } from '@lingui/core/macro';
import type { SidebarItem } from '@aiostreams/ui/shared/sidebar';
import { cn } from '@aiostreams/ui/core/styling';
import { usingKeys } from '@/lib/input';
import { GlassSurface } from '@/components/shell/glass-surface';
import { ENTER_CURRENT, NavEntry, select } from './common';
import { YouIcon } from './account';

/** The shut corner menu's size: an entry, the padding round it and the border. */
const CORNER_SHUT = 62;

/**
 * The navigation shrunk to the current page's button in the top corner, which
 * opens down into the whole menu: on a TV while it has focus, on a touch
 * screen when tapped.
 */
export function CornerMenu({
  items,
  footerItems,
  you,
  tv,
}: {
  items: SidebarItem[];
  footerItems: SidebarItem[];
  you: SidebarItem;
  tv: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const list = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0, shift: 0 });
  const shown =
    [...items, ...footerItems].find((item) => item.isCurrent) ?? items[0];
  React.useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      const at = el.querySelector<HTMLElement>(`[data-name="${shown?.id}"]`);
      const first = el.firstElementChild as HTMLElement;
      setSize({
        width: el.offsetWidth + 2,
        height: el.offsetHeight + 2,
        shift: (at?.offsetTop ?? 0) - first.offsetTop,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown?.id]);
  const label = cn('transition-opacity duration-300', !open && 'opacity-0');
  const divider = <div className="mx-3 my-1 h-px flex-none bg-white/10" />;
  const account = (
    <NavEntry
      aria-label={you.name}
      item={{ id: 'account', name: t`You` }}
      icon={<YouIcon />}
      onClick={select(you)}
      labelClassName={label}
      inert={!open}
      className="w-full ps-3 pe-5"
    />
  );
  const entry = (item: SidebarItem) => {
    const Icon = item.iconType;
    return (
      <NavEntry
        key={item.id}
        item={item}
        icon={Icon && <Icon />}
        labelClassName={label}
        inert={!open && item !== shown}
        onClick={(e) => {
          if (!open) return setOpen(true);
          setOpen(false);
          select(item)(e);
        }}
        // Shut, the icon sits in the middle of the round button.
        className={cn('w-full ps-3 pe-5', !open && 'bg-transparent')}
      />
    );
  };
  return (
    <nav
      data-ui="corner-menu"
      data-open={open || undefined}
      data-nav-enter={ENTER_CURRENT}
      data-nav-back="up"
      data-nav-exit="end"
      // Focus moving within, or into the account menu, blurs then focuses in one go.
      onFocus={() => usingKeys() && setOpen(true)}
      onBlur={() => usingKeys() && setOpen(false)}
      className={cn(
        'z-40 transition-transform duration-200 ease-out',
        tv
          ? 'absolute start-6 top-6 [[data-in-rows]_&]:-translate-y-[180%]'
          : 'fixed start-[calc(1rem+env(safe-area-inset-left))] top-[calc(1rem+env(safe-area-inset-top))] hidden lg:block'
      )}
    >
      <div
        aria-hidden
        // Open, it takes a tap anywhere else, which only shuts the menu.
        onPointerDown={() => setOpen(false)}
        className={cn(
          'fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgb(0_0_0/0.75),transparent_70%)] transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      <GlassSurface
        className="relative overflow-hidden rounded-[31px] transition-[width,height] duration-300 ease-out"
        style={{
          width: open ? size.width : CORNER_SHUT,
          height: open ? size.height : CORNER_SHUT,
        }}
      >
        <div
          ref={list}
          className="absolute start-0 top-0 flex w-max min-w-48 flex-col gap-1 p-1.5 transition-transform duration-300 ease-out"
          style={{
            transform: open ? undefined : `translateY(${-size.shift}px)`,
          }}
        >
          {tv && account}
          {tv && divider}
          {items.map(entry)}
          {divider}
          {footerItems.map(entry)}
          {!tv && account}
        </div>
      </GlassSurface>
    </nav>
  );
}
