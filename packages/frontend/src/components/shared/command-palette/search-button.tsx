import { BiSearch } from 'react-icons/bi';
import { cn } from '@/components/ui/core/styling';
import { useAppSidebarContext } from '@/components/ui/app-layout';
import { Tooltip } from '@/components/ui/tooltip';

const APPLE_PLATFORM = /mac|ios|iphone|ipad|ipod/i;

const platform =
  typeof navigator === 'undefined'
    ? ''
    : (navigator as { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ||
      navigator.platform ||
      '';

export const COMMAND_PALETTE_SHORTCUT = APPLE_PLATFORM.test(platform)
  ? '⌘K'
  : 'Ctrl K';

const SURFACE =
  'flex items-center rounded-md border border-[--border] bg-[--subtle]/50 hover:bg-[--subtle] text-[--muted] hover:text-[--foreground] transition-colors';

/**
 * The sidebar entry point to a command palette, for both the configure and the
 * dashboard sidebar.
 *
 * The sidebar is an icon rail on desktop but a full-width drawer on mobile, so
 * the button follows suit: a square with a tooltip when it is a rail, a
 * labelled search bar when there is room for one.
 */
export function CommandPaletteSearchButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}) {
  const ctx = useAppSidebarContext();
  const isRail = !ctx.isBelowBreakpoint;

  const open = () => {
    onOpen();
    // Otherwise the mobile drawer stays open behind the palette.
    ctx.setOpen(false);
  };

  return (
    <div className={cn('mb-3', isRail ? 'flex justify-center' : 'px-4')}>
      {isRail ? (
        <Tooltip
          side="right"
          trigger={
            <button
              type="button"
              onClick={open}
              aria-label={label}
              className={cn(SURFACE, 'w-11 h-10 justify-center')}
            >
              <BiSearch className="text-base shrink-0" />
            </button>
          }
        >
          {label} ({COMMAND_PALETTE_SHORTCUT})
        </Tooltip>
      ) : (
        <button
          type="button"
          onClick={open}
          aria-label={label}
          className={cn(SURFACE, 'w-full h-9 gap-2 px-3 text-sm')}
        >
          <BiSearch className="text-base shrink-0" />
          <span className="flex-1 text-left">{label}…</span>
          <kbd className="font-mono text-xs px-1.5 py-0.5 rounded border border-[--border] bg-[--background] text-[--muted] leading-none">
            {COMMAND_PALETTE_SHORTCUT}
          </kbd>
        </button>
      )}
    </div>
  );
}

/** The same entry point, for the mobile top bar rather than the sidebar. */
export function CommandPaletteTopBarButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={cn(SURFACE, 'flex-1 h-9 gap-2 px-3 text-sm truncate')}
    >
      <BiSearch className="text-base shrink-0" />
      <span className="flex-1 text-left">{label}…</span>
    </button>
  );
}
