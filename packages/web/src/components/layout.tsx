import React from 'react';
import { motion } from 'motion/react';
import {
  Outlet,
  useElementScrollRestoration,
  useRouterState,
} from '@tanstack/react-router';
import {
  BiCalendar,
  BiDownload,
  BiCompass,
  BiHeart,
  BiHistory,
  BiHomeAlt2,
  BiLoaderAlt,
  BiLogOutCircle,
  BiCog,
  BiSearch,
  BiServer,
  BiSliderAlt,
  BiTransferAlt,
  BiWifiOff,
  BiX,
} from 'react-icons/bi';
import {
  AppLayout,
  AppLayoutContent,
  AppLayoutSidebar,
  AppSidebarProvider,
  useAppSidebarContext,
} from '@aiostreams/ui/app-layout';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  type DropdownMenuProps,
} from '@aiostreams/ui/dropdown-menu';
import { LuCircleArrowLeft, LuCircleArrowRight } from 'react-icons/lu';
import { VerticalMenu } from '@aiostreams/ui/vertical-menu';
import { HoverCard } from '@aiostreams/ui/hover-card';
import { Tooltip } from '@aiostreams/ui/tooltip';
import type { IconType } from 'react-icons';
import { Sidebar, type SidebarItem } from '@aiostreams/ui/shared/sidebar';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { useSession } from '../lib/session';
import { usePickableUsers } from '../lib/queries';
import { configureUrl, navigate, to } from '../lib/paths';
import { currentHost } from '../lib/hosts';
import { serverAddress } from '../lib/servers';
import { useServerInfo } from '../lib/server-info';
import { useDiscordBrowsing } from '../lib/discord';
import { useServerEvents } from '../lib/server-events';
import { retryNow, useReachable } from '../lib/connection';
import {
  downloadsHost,
  useDownloadList,
  useDownloadRunner,
} from '../lib/downloads';
import { usePendingStops } from '../lib/playback/reporter';
import { settings, useSetting } from '../lib/settings';
import { useAction } from '../lib/input';
import { UserAvatar } from './user-avatar';
import { BrandLogo } from './brand-logo';
import { VersionPickerProvider } from './version-picker';

const PAGE_FADE = {
  initial: { opacity: 0, top: 6 },
  animate: { opacity: 1, top: 0 },
  transition: { type: 'spring', damping: 28, stiffness: 260, mass: 0.7 },
} as const;

function Logo() {
  return (
    <div
      data-ui="sidebar-logo"
      className="mb-4 flex w-full justify-center p-4 pb-0"
    >
      <BrandLogo className="max-h-[60px] max-w-[90px] object-contain p-4" />
    </div>
  );
}

/** The signed-in user's picture, in a sidebar item's icon slot. */
function SidebarAvatar({ className }: { className?: string }) {
  const { user } = useSession();
  const users = usePickableUsers();
  const avatar = users.data?.find((u) => u.user.Id === user.Id)?.avatar ?? null;
  return (
    <UserAvatar
      name={user.Name}
      src={avatar}
      className={cn(className, 'size-6 !text-[0.7rem] !text-white')}
    />
  );
}

/** The avatar, ringed with the progress of running downloads. */
function YouIcon() {
  const running = useDownloadList().filter(
    (d) => d.state === 'downloading' || d.state === 'queued'
  );
  const total = running.reduce((sum, d) => sum + (d.total ?? 0), 0);
  const bytes = running.reduce((sum, d) => sum + d.bytes, 0);
  return (
    <span className="relative flex">
      <SidebarAvatar />
      {running.length > 0 && (
        <svg
          data-ui="download-ring"
          viewBox="0 0 32 32"
          className="pointer-events-none absolute -inset-1 size-8 -rotate-90"
        >
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            strokeWidth="2.5"
            className="stroke-white/15"
          />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={100 - (total ? (bytes / total) * 100 : 0)}
            className="stroke-brand-500 transition-[stroke-dashoffset]"
          />
        </svg>
      )}
    </span>
  );
}

/** An icon over its label, sized for a finger. */
function NavTab({
  item,
  icon,
  className,
  ...props
}: {
  item: Pick<SidebarItem, 'id' | 'name' | 'isCurrent'>;
  icon: React.ReactNode;
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
      <span className="max-w-full truncate">{item.name}</span>
    </button>
  );
}

/** The account menu: who is signed in, on which server, and the account actions. */
function AccountMenu({
  trigger,
  places = [],
  items,
  ...position
}: {
  trigger: React.ReactNode;
  /** Pages listed above the account's actions. */
  places?: SidebarItem[];
  items: SidebarItem[];
} & Pick<DropdownMenuProps, 'side' | 'align' | 'sideOffset'>) {
  const { client, user } = useSession();
  const info = useServerInfo();
  return (
    <DropdownMenu
      data-ui="account-menu"
      {...position}
      className="min-w-52"
      trigger={trigger}
    >
      <DropdownMenuLabel>
        <span className="block truncate">{user.Name ?? 'You'}</span>
        <span className="block truncate text-xs font-normal text-[--muted]">
          {info.name ?? serverAddress(client.base)}
        </span>
      </DropdownMenuLabel>
      {[places, items]
        .filter((group) => group.length)
        .map((group, i) => (
          <React.Fragment key={i}>
            <DropdownMenuSeparator />
            {group.map((item) => {
              const Icon = item.iconType;
              return (
                <DropdownMenuItem
                  key={item.name}
                  data-name={item.id}
                  onClick={item.onClick}
                >
                  {Icon && <Icon className="text-lg" />}
                  {item.name}
                </DropdownMenuItem>
              );
            })}
          </React.Fragment>
        ))}
    </DropdownMenu>
  );
}

/** The avatar at the foot of the sidebar, styled as its other items. */
function SidebarAccount({ items }: { items: SidebarItem[] }) {
  const { user } = useSession();
  const sidebar = useAppSidebarContext();
  return (
    <AccountMenu
      side="right"
      align="end"
      sideOffset={8}
      items={items}
      trigger={
        <div>
          <VerticalMenu
            collapsed={!sidebar.isBelowBreakpoint}
            isSidebar
            itemClass="relative"
            items={[
              {
                id: 'account',
                name: user.Name ?? 'You',
                iconType: SidebarAvatar,
              },
            ]}
          />
        </div>
      }
    />
  );
}

/**
 * The backdrop as one element that never fades with the screens, so a
 * transparent page shows nothing beneath it; the player hides it.
 */
export function PageBackground() {
  return (
    <div
      aria-hidden
      data-ui="page-background"
      className="page-background pointer-events-none fixed inset-0 -z-10 bg-[--background]"
    />
  );
}

/** The router scrolls a commit after a page renders, so the old offset could paint first. */
function PageScroll() {
  const saved = useElementScrollRestoration({ getElement: () => window });
  React.useLayoutEffect(() => {
    window.scrollTo(saved?.scrollX ?? 0, saved?.scrollY ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

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
      <Icon className="text-2xl transition group-hover/history:-rotate-2 group-hover/history:scale-[1.05]" />
    </button>
  );
}

/** Back, and forward on hover, where no browser around the app has them. */
function HistoryButtons() {
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
      label="Back"
      icon={LuCircleArrowLeft}
      disabled={nav?.canGoBack === false}
      onClick={() => window.history.back()}
    />
  );
  return (
    <div
      data-ui="sidebar-history"
      className="flex w-full flex-col items-center gap-3 px-4 pt-3"
    >
      <span aria-hidden className="h-px w-8 bg-white/10" />
      {nav?.canGoForward === false ? (
        back
      ) : (
        <HoverCard
          side="right"
          sideOffset={0}
          openDelay={150}
          closeDelay={150}
          className="w-auto border-none bg-transparent p-0 pl-1.5 shadow-none"
          trigger={<span className="flex">{back}</span>}
        >
          <HistoryButton
            data-name="forward"
            label="Forward"
            icon={LuCircleArrowRight}
            className="border border-white/10 bg-[--paper] shadow-lg shadow-black/50"
            onClick={() => window.history.forward()}
          />
        </HoverCard>
      )}
    </div>
  );
}

function pageName(pathname: string): string {
  return pathname.split('/')[1] || 'home';
}

/** While the server can't be reached, a note that it keeps trying; dismissed, it shrinks to an icon. */
function ConnectionNote() {
  // Mounted per outage, so the next one shows the full note again.
  return useReachable() ? null : <Unreachable />;
}

const NOTE_PLACE =
  'fixed bottom-[max(1rem,calc(var(--nav-bar)+0.5rem))] right-4 z-[100] border border-white/10 bg-gray-950/90 shadow-lg backdrop-blur';

function Unreachable() {
  const [saved] = useSetting(settings.cache.enabled);
  const [small, setSmall] = React.useState(false);
  const downloaded = useDownloadList().some((d) => d.state === 'done');
  if (small) {
    return (
      <Tooltip
        trigger={
          <button
            type="button"
            data-ui="connection-note"
            data-state="small"
            aria-label="Can't reach the server"
            onClick={() => {
              setSmall(false);
              retryNow();
            }}
            className={cn(
              NOTE_PLACE,
              'flex size-9 items-center justify-center rounded-full text-base text-[--muted] transition-colors hover:text-white'
            )}
          >
            <BiWifiOff />
          </button>
        }
      >
        Can't reach the server
      </Tooltip>
    );
  }
  return (
    <div
      data-ui="connection-note"
      className={cn(
        NOTE_PLACE,
        'flex items-center rounded-xl text-sm duration-300 animate-in fade-in-0 slide-in-from-right-4'
      )}
    >
      <button
        type="button"
        onClick={retryNow}
        className="flex items-center gap-2.5 py-2 pl-4 pr-2 text-left"
      >
        <BiLoaderAlt className="flex-none animate-spin text-base text-[--muted]" />
        <span>
          <span className="block font-semibold">Reconnecting…</span>
          {saved && (
            <span className="block text-xs text-[--muted]">
              Showing saved pages
            </span>
          )}
        </span>
      </button>
      {downloaded && (
        <button
          type="button"
          data-ui="connection-note-downloads"
          onClick={() => navigate(to.downloads)}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
        >
          Downloads
        </button>
      )}
      <button
        type="button"
        data-ui="connection-note-dismiss"
        aria-label="Dismiss"
        onClick={() => setSmall(true)}
        className="mr-2 flex size-7 flex-none items-center justify-center rounded-full text-base text-[--muted] transition-colors hover:bg-white/10 hover:text-white"
      >
        <BiX />
      </button>
    </div>
  );
}

export function WebLayout() {
  const { client, signOut, switchUser, changeServer } = useSession();
  const configure = configureUrl(client.base, useServerInfo());
  const users = usePickableUsers();
  const several = (users.data?.length ?? 0) > 1;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useDiscordBrowsing(pathname);
  useServerEvents();
  useDownloadRunner();
  usePendingStops();
  useAction('search', () => navigate(to.search()));
  useAction('home', () => navigate(to.home));
  const activity: SidebarItem = {
    id: 'activity',
    name: 'Activity',
    iconType: BiHistory,
    isCurrent: pathname.startsWith('/history'),
    onClick: () => navigate(to.history),
  };
  const downloads: SidebarItem | null = downloadsHost()
    ? {
        id: 'downloads',
        name: 'Downloads',
        iconType: BiDownload,
        isCurrent: pathname.startsWith('/downloads'),
        onClick: () => navigate(to.downloads),
      }
    : null;
  const touch = useMediaQuery('(pointer: coarse)');
  const [touchNavigation] = useSetting(settings.touchNavigation);
  const [tvNavigation] = useSetting(settings.tvNavigation);
  // What wide screens show; narrow ones always have the bar.
  const nav = currentHost().tv
    ? (`tv-${tvNavigation}` as const)
    : touch
      ? touchNavigation
      : 'sidebar';
  const side = nav !== 'bar' && nav !== 'tv-top';
  React.useEffect(() => {
    document.documentElement.dataset.nav = nav;
  }, [nav]);
  const calendar: SidebarItem = {
    id: 'calendar',
    name: 'Calendar',
    iconType: BiCalendar,
    isCurrent: pathname.startsWith('/calendar'),
    onClick: () => navigate(to.calendar()),
  };
  const confirmSignOut = useConfirmationDialog({
    title: 'Sign out',
    description: __STANDALONE__
      ? 'Sign out of this server?'
      : 'Sign out of this browser?',
    actionText: 'Sign out',
    onConfirm: signOut,
  });

  const items: SidebarItem[] = [
    {
      id: 'home',
      name: 'Home',
      iconType: BiHomeAlt2,
      isCurrent: pathname === '/',
      onClick: () => navigate(to.home),
    },
    {
      id: 'discover',
      name: 'Discover',
      iconType: BiCompass,
      isCurrent:
        pathname.startsWith('/discover') || pathname.startsWith('/library'),
      onClick: () => navigate(to.discover()),
    },
    {
      id: 'search',
      name: 'Search',
      iconType: BiSearch,
      isCurrent: pathname.startsWith('/search'),
      onClick: () => navigate(to.search()),
    },
    {
      id: 'favourites',
      name: 'Favourites',
      iconType: BiHeart,
      isCurrent: pathname.startsWith('/favourites'),
      onClick: () => navigate(to.favourites()),
    },
    calendar,
    activity,
    ...(downloads ? [downloads] : []),
  ];

  const settingsItem: SidebarItem = {
    id: 'settings',
    name: 'Settings',
    iconType: BiCog,
    isCurrent: pathname.startsWith('/settings'),
    onClick: () => navigate(to.settings()),
  };

  const accountItems: SidebarItem[] = [
    ...(several
      ? [
          {
            id: 'switch-user',
            name: 'Switch user',
            iconType: BiTransferAlt,
            onClick: switchUser,
          },
        ]
      : []),
    ...(configure
      ? [
          {
            id: 'configure',
            name: 'Configure',
            iconType: BiSliderAlt,
            onClick: () => window.open(configure, '_blank'),
          },
        ]
      : []),
    ...(changeServer
      ? [
          {
            id: 'change-server',
            name: 'Change server',
            iconType: BiServer,
            onClick: changeServer,
          },
        ]
      : []),
    {
      id: 'sign-out',
      name: 'Sign out',
      iconType: BiLogOutCircle,
      onClick: () => confirmSignOut.open(),
    },
  ];

  return (
    <AppSidebarProvider>
      <AppLayout
        withSidebar={side}
        sidebarSize={nav === 'tv-sidebar' ? 'sm' : 'slim'}
      >
        {side && (
          <AppLayoutSidebar data-ui="sidebar">
            {nav === 'rail' ? (
              <TouchRail
                items={items}
                footerItems={[settingsItem]}
                accountItems={accountItems}
              />
            ) : nav === 'tv-rail' || nav === 'tv-sidebar' ? (
              <TvRail
                items={items}
                footerItems={[settingsItem]}
                accountItems={accountItems}
                open={nav === 'tv-sidebar'}
              />
            ) : (
              <Sidebar
                header={<Logo />}
                items={items}
                belowItems={<HistoryButtons />}
                footerItems={[settingsItem]}
                footer={<SidebarAccount items={accountItems} />}
              />
            )}
          </AppLayoutSidebar>
        )}
        <AppLayout>
          <AppLayoutContent>
            {nav === 'tv-top' && (
              <TvTabs
                items={items}
                footerItems={[settingsItem]}
                accountItems={accountItems}
              />
            )}
            <VersionPickerProvider>
              <motion.div
                key={pathname}
                data-page={pageName(pathname)}
                {...PAGE_FADE}
                className={cn(
                  'relative pb-[var(--nav-bar)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
                  // In place of the sidebar's gutter, which pages leave to it.
                  (nav === 'bar' || nav === 'tv-top') &&
                    'lg:pl-[calc(2.5rem+env(safe-area-inset-left))]'
                )}
              >
                <Outlet />
                <PageScroll />
              </motion.div>
            </VersionPickerProvider>
          </AppLayoutContent>
        </AppLayout>
      </AppLayout>
      <MobileNav
        items={items.filter(
          (i) => i !== calendar && i !== activity && i !== downloads
        )}
        places={[...(downloads ? [downloads] : []), activity, calendar]}
        menuItems={[settingsItem, ...accountItems]}
        wide={nav === 'bar'}
      />
      <ConnectionNote />
      <ConfirmationDialog {...confirmSignOut} />
    </AppSidebarProvider>
  );
}

function select(item: SidebarItem) {
  return (e: React.MouseEvent<HTMLButtonElement>) => {
    (document.activeElement as HTMLElement | null)?.blur();
    item.onClick?.(e);
  };
}

function MobileNav({
  items,
  places,
  menuItems,
  wide,
}: {
  items: SidebarItem[];
  places: SidebarItem[];
  menuItems: SidebarItem[];
  /** Shown on wide screens too, in place of the sidebar. */
  wide: boolean;
}) {
  const inMenu = [...places, ...menuItems].some((item) => item.isCurrent);
  const tab = 'flex-1 gap-0.5 rounded-full px-1 py-1.5 text-[0.65rem]';
  return (
    <nav
      data-ui="mobile-nav"
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
        !wide && 'lg:hidden'
      )}
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full border border-white/10 bg-gray-950/80 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
        {items.map((item) => {
          const Icon = item.iconType;
          return (
            <NavTab
              key={item.id}
              data-ui="mobile-nav-item"
              item={item}
              icon={Icon && <Icon className="text-xl" />}
              onClick={select(item)}
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
              aria-label="Account"
              item={{ id: 'account', name: 'You', isCurrent: inMenu }}
              icon={<YouIcon />}
              className={tab}
            />
          }
        />
      </div>
    </nav>
  );
}

/** The sidebar on a touch screen: each item labelled and big enough for a finger. */
function TouchRail({
  items,
  footerItems,
  accountItems,
}: {
  items: SidebarItem[];
  footerItems: SidebarItem[];
  accountItems: SidebarItem[];
}) {
  const tab = 'w-full gap-1 rounded-2xl px-0.5 py-2.5 text-[0.7rem]';
  const railItem = (item: SidebarItem) => {
    const Icon = item.iconType;
    return (
      <NavTab
        key={item.id}
        data-ui="rail-item"
        item={item}
        icon={Icon && <Icon className="text-2xl" />}
        onClick={select(item)}
        className={tab}
      />
    );
  };
  return (
    <nav
      data-ui="touch-rail"
      className="flex h-full flex-col items-center gap-1 overflow-y-auto px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <Logo />
      {items.map(railItem)}
      <div className="mt-auto flex w-full flex-col gap-1 pt-4">
        {footerItems.map(railItem)}
        <AccountMenu
          side="right"
          align="end"
          sideOffset={8}
          items={accountItems}
          trigger={
            <NavTab
              data-ui="rail-item"
              aria-label="Account"
              item={{ id: 'account', name: 'You' }}
              icon={<YouIcon />}
              className={tab}
            />
          }
        />
      </div>
    </nav>
  );
}

/** Moving into a TV's navigation lands on the current page, as on TV menus. */
const ENTER_CURRENT = '[aria-current="page"]';

/** A TV's entry: an icon, and its name beside it where there is room. */
function TvNavItem({
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
        'flex h-12 flex-none items-center gap-4 overflow-hidden whitespace-nowrap rounded-full px-3.5 font-medium transition-[color,box-shadow] focus-visible:text-white',
        // A shadow, as a fading background or opacity shows its start again for a frame as it ends in a TV's web view.
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

/** A TV's navigation down the side, which opens out with names while it has focus. */
function TvRail({
  items,
  footerItems,
  accountItems,
  open,
}: {
  items: SidebarItem[];
  footerItems: SidebarItem[];
  accountItems: SidebarItem[];
  /** Always shows the names. */
  open: boolean;
}) {
  const label = open
    ? undefined
    : 'opacity-0 transition-opacity group-focus-within/rail:opacity-100';
  const entry = (item: SidebarItem) => {
    const Icon = item.iconType;
    return (
      <TvNavItem
        key={item.id}
        item={item}
        icon={Icon && <Icon />}
        onClick={select(item)}
        labelClassName={label}
        className="w-full"
      />
    );
  };
  return (
    <nav
      data-ui="tv-rail"
      data-nav-enter={ENTER_CURRENT}
      className={cn(
        'group/rail absolute inset-y-0 left-0 flex flex-col gap-1 px-3 py-8 transition-[width] duration-200',
        open ? 'w-full' : 'w-20 focus-within:w-64'
      )}
    >
      {!open && (
        <div className="pointer-events-none fixed inset-y-0 left-0 -z-10 w-[36rem] bg-gradient-to-r from-black via-black/85 to-transparent opacity-0 transition-opacity duration-200 group-focus-within/rail:opacity-100" />
      )}
      <BrandLogo className="mx-3.5 mb-6 h-8 w-6 flex-none object-contain" />
      {items.map(entry)}
      <div className="mt-auto flex flex-col gap-1">
        {footerItems.map(entry)}
        <AccountMenu
          side="right"
          align="end"
          sideOffset={8}
          items={accountItems}
          trigger={
            <TvNavItem
              aria-label="Account"
              item={{ id: 'account', name: 'You' }}
              icon={<YouIcon />}
              labelClassName={label}
              className="w-full"
            />
          }
        />
      </div>
    </nav>
  );
}

function TvTabs({
  items,
  footerItems,
  accountItems,
}: {
  items: SidebarItem[];
  footerItems: SidebarItem[];
  accountItems: SidebarItem[];
}) {
  const tab = (item: SidebarItem) => {
    const Icon = item.iconType;
    return (
      <TvNavItem
        key={item.id}
        item={item}
        icon={Icon && <Icon />}
        onClick={select(item)}
        className="pr-5"
      />
    );
  };
  return (
    <nav
      data-ui="tv-tabs"
      data-nav-enter={ENTER_CURRENT}
      className="relative z-40 flex items-center gap-6 px-10 pb-2 pt-8"
    >
      <BrandLogo className="h-8 w-6 flex-none object-contain" />
      <div className="flex flex-1 items-center justify-center gap-1">
        {items.map(tab)}
      </div>
      <div className="flex items-center gap-1">
        {footerItems.map((item) => {
          const Icon = item.iconType;
          return (
            <TvNavItem
              key={item.id}
              aria-label={item.name}
              item={item}
              icon={Icon && <Icon />}
              onClick={select(item)}
              labelClassName="hidden"
            />
          );
        })}
        <AccountMenu
          side="bottom"
          align="end"
          sideOffset={8}
          items={accountItems}
          trigger={
            <TvNavItem
              aria-label="Account"
              item={{ id: 'account', name: 'You' }}
              icon={<YouIcon />}
              labelClassName="hidden"
            />
          }
        />
      </div>
    </nav>
  );
}

/** The padded column a page renders into. */
export function PageBody({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-ui="page-body"
      className="relative z-[1] space-y-8 px-4 pb-16 pt-[calc(1.5rem+env(safe-area-inset-top))] lg:pl-0 lg:pr-10 lg:pt-[calc(2.5rem+env(safe-area-inset-top))]"
    >
      {children}
    </div>
  );
}

/** The window's height less the phone nav bar, which pages are padded for. */
export const FILL_WINDOW = 'min-h-[calc(100dvh-var(--nav-bar))]';

export function PageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-ui="page-message"
      className={cn(
        'relative z-[1] flex flex-col justify-center px-4 py-10 lg:pl-0 lg:pr-10',
        FILL_WINDOW
      )}
    >
      {children}
    </div>
  );
}
