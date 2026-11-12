import React from 'react';
import { t } from '@lingui/core/macro';
import { motion } from 'motion/react';
import {
  Outlet,
  useChildMatches,
  useRouterState,
} from '@tanstack/react-router';
import {
  BiCalendar,
  BiTv,
  BiGroup,
  BiDownload,
  BiCompass,
  BiHeart,
  BiHistory,
  BiHomeAlt2,
  BiListUl,
  BiCog,
  BiSearch,
  BiTransferAlt,
} from 'react-icons/bi';
import {
  AppLayout,
  AppLayoutContent,
  AppLayoutSidebar,
  AppSidebarProvider,
} from '@aiostreams/ui/app-layout';
import { Sidebar, type SidebarItem } from '@aiostreams/ui/shared/sidebar';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { useSession } from '@/lib/jellyfin/session';
import { useLiveTvView } from '@/lib/jellyfin/queries';
import { usePickableUsers } from '@/lib/jellyfin/history';
import { pageOpening } from '@/lib/page-open';
import { navigate, to } from '@/lib/paths';
import { currentHost } from '@/lib/hosts';
import { shellHost } from '@/lib/hosts/shell';
import { useDiscordBrowsing } from '@/lib/discord';
import { useServerEvents } from '@/features/remote/server-events';
import { downloadsHost, useDownloadRunner } from '@/lib/downloads';
import { usePendingStops } from '@/lib/playback/reporter';
import {
  closePlayback,
  leftPlayback,
  playbackNow,
  usePlayback,
} from '@/lib/playback/session';
import { playsWithWebGpu } from '@/lib/playback/player-choice';
import { warmWebGpu } from '@/lib/playback/webgpu';
import { settings, useSetting } from '@/lib/settings';
import { useAction } from '@/lib/input';
import { VersionPickerProvider } from '@/features/versions/version-picker';
import { RemoteTarget } from '@/features/remote/remote-target';
import { RemoteSheet } from '@/features/remote/remote-sheet';
import { WatchNextSync } from './watch-next';
import { ReminderHost } from '@/features/live-tv/live-reminders';
import { RandomPick } from '@/components/media/random-pick';
import { ItemMenuHost } from '@/components/media/item-menu';
import { HomePage } from '@/app/home/page';
import { PlayerPage } from '@/app/player/page';
import { PageShown } from '@/lib/page-shown';
import { GlideLayers } from './glide-layers';
import { UpdatePrompt } from './update-prompt';
import { UsageStats } from './usage-stats';
import { usageStatsOffered } from '@/lib/usage-stats';
import { PartyHost } from '@/features/party/party-host';
import { openPartySheet } from '@/features/party/sheet-state';
import { openPlaylists, PlaylistsHost } from '@/features/playlists/playlists';
import { useParty } from '@/lib/party/party';
import { useTrailerCovers } from '@/features/trailers/preview';
import { PageScroll } from './page-scroll';
import { HistoryButtons } from './history-buttons';
import { ConnectionNote } from './unreachable';
import { Logo, onBar } from './nav/common';
import { SidebarAccount } from './nav/account';
import { MobileNav } from './nav/mobile-nav';
import { TouchRail } from './nav/touch-rail';
import { TvRail } from './nav/tv-rail';
import { CornerMenu } from './nav/corner-menu';
import { TOP_BAR_HEIGHT, TopTabs } from './nav/top-tabs';

// Kept mounted under every page, so it skips the layout's render on each route change.
const KeptHome = React.memo(HomePage);

const PAGE_FADE = {
  initial: { opacity: 0, top: 6 },
  animate: { opacity: 1, top: 0 },
  transition: { type: 'spring', damping: 28, stiffness: 260, mass: 0.7 },
} as const;

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

function pageName(pathname: string): string {
  return pathname.split('/')[1] || 'home';
}

/** Phones and TVs leave it to their first video. */
function useWebGpuWarmUp() {
  React.useEffect(() => {
    if (
      !playsWithWebGpu() ||
      currentHost().tv ||
      !matchMedia('(pointer: fine)').matches
    )
      return;
    const timer = setTimeout(
      () => void warmWebGpu(() => !!playbackNow()),
      WARM_UP_AFTER_MS
    );
    return () => clearTimeout(timer);
  }, []);
}

/** After the app's first pages have loaded what they need. */
const WARM_UP_AFTER_MS = 10_000;

export function WebLayout() {
  const { switchUser, user } = useSession();
  const users = usePickableUsers();
  const several = (users.data?.length ?? 0) > 1;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const entry = useRouterState({
    select: (s) => s.location.state.__TSR_key ?? s.location.href,
  });
  const onHome = pathname === '/';
  // From the match the outlet shows, which can trail the location for a render.
  const playing = useChildMatches({
    select: (matches) => !!matches[0]?.pathname.startsWith('/play/'),
  });
  useServerEvents(playing);
  const playback = usePlayback();
  const trailerCovers = useTrailerCovers();
  usePlayerLeaving();
  // Another user, or signing out, takes what played with the pages.
  React.useEffect(() => closePlayback, [user.Id]);
  // Home stays, hidden, while other pages and the player are open: going back
  // to its entry shows it again rather than building it anew. Any other visit
  // starts afresh.
  const [kept, setKept] = React.useState<string>();
  if (onHome && kept !== entry) setKept(entry);
  const activity: SidebarItem = {
    id: 'activity',
    name: t`Activity`,
    iconType: BiHistory,
    isCurrent: pathname.startsWith('/history'),
    onClick: () => navigate(to.history),
  };
  const downloads: SidebarItem | null = downloadsHost()
    ? {
        id: 'downloads',
        name: t`Downloads`,
        iconType: BiDownload,
        isCurrent: pathname.startsWith('/downloads'),
        onClick: () => navigate(to.downloads),
      }
    : null;
  const touch = useMediaQuery('(pointer: coarse)');
  const [touchNavigation] = useSetting(settings.interface.touchNavigation);
  const [tvNavigation] = useSetting(settings.interface.tvNavigation);
  const [desktopNavigation] = useSetting(settings.interface.desktopNavigation);
  const [topBar] = useSetting(settings.interface.topBar);
  const [tabNames] = useSetting(settings.interface.tabNames);
  const [railShape] = useSetting(settings.interface.railShape);
  const [railNames] = useSetting(settings.interface.railNames);
  // What wide screens show; narrow ones always have the bar.
  const nav = currentHost().tv
    ? (`tv-${tvNavigation}` as const)
    : touch
      ? touchNavigation
      : desktopNavigation;
  const top = nav === 'tv-top' || nav === 'top';
  const shape = nav === 'rail' || nav === 'tv-rail' ? railShape : undefined;
  const side = nav === 'sidebar' || shape === 'docked';
  const named =
    nav === 'tv-rail' ? railNames === 'always' : railNames !== 'never';
  React.useEffect(() => {
    document.documentElement.dataset.nav = nav;
  }, [nav]);
  const live: SidebarItem | null = useLiveTvView().data
    ? {
        id: 'live',
        name: t`Live TV`,
        iconType: BiTv,
        isCurrent: pathname.startsWith('/live'),
        onClick: () => navigate(to.live()),
      }
    : null;
  const calendar: SidebarItem = {
    id: 'calendar',
    name: t`Calendar`,
    iconType: BiCalendar,
    isCurrent: pathname.startsWith('/calendar'),
    onClick: () => navigate(to.calendar()),
  };
  const inParty = !!useParty();
  const together: SidebarItem = {
    id: 'party',
    name: inParty ? t`Watch party` : t`Watch together`,
    iconType: BiGroup,
    onClick: () => openPartySheet(),
  };
  const playlists: SidebarItem = {
    id: 'playlists',
    name: t`Playlists`,
    iconType: BiListUl,
    onClick: () => openPlaylists(),
  };
  const items: SidebarItem[] = [
    {
      id: 'home',
      name: t`Home`,
      iconType: BiHomeAlt2,
      isCurrent: pathname === '/',
      onClick: () => navigate(to.home),
    },
    {
      id: 'discover',
      name: t`Discover`,
      iconType: BiCompass,
      isCurrent:
        pathname.startsWith('/discover') || pathname.startsWith('/library'),
      onClick: () => navigate(to.discover()),
    },
    {
      id: 'search',
      name: t`Search`,
      iconType: BiSearch,
      isCurrent: pathname.startsWith('/search'),
      onClick: () => navigate(to.search()),
    },
    {
      id: 'favourites',
      name: t`Favourites`,
      iconType: BiHeart,
      isCurrent: pathname.startsWith('/favourites'),
      onClick: () => navigate(to.favourites()),
    },
    ...(live ? [live] : []),
    calendar,
    activity,
    playlists,
    together,
    ...(downloads ? [downloads] : []),
  ];

  const settingsItem: SidebarItem = {
    id: 'settings',
    name: t`Settings`,
    iconType: BiCog,
    isCurrent: pathname.startsWith('/settings'),
    onClick: () => navigate(to.settings()),
  };

  const switchItem: SidebarItem = {
    id: 'switch-user',
    name: t`Switch user`,
    iconType: BiTransferAlt,
    onClick: switchUser,
  };
  const you: SidebarItem = several
    ? switchItem
    : {
        id: 'account',
        name: t`Account`,
        onClick: () => navigate(to.settings('account')),
      };

  const page = cn(
    'relative pb-[calc(var(--nav-bar)+var(--mini-bar,0px))] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] pt-[var(--top-bar,0px)]',
    // In place of the sidebar's gutter, which pages leave to it.
    (nav === 'bar' || top || shape === 'corner') &&
      'lg:ps-[calc(2.5rem+env(safe-area-inset-left))]',
    shape === 'floating' &&
      'lg:ps-[calc(var(--side-bar)+env(safe-area-inset-left))]'
  );

  return (
    <>
      {!playing && <PagesWork pathname={pathname} playing={!!playback} />}
      <div
        data-ui="shell"
        inert={playing || trailerCovers}
        className={cn(
          playing
            ? 'invisible [content-visibility:hidden]'
            : // Faded away from a trailer playing behind it, which goes on.
              trailerCovers
              ? 'invisible opacity-0 [transition:opacity_300ms,visibility_0s_300ms]'
              : 'transition-opacity duration-300'
        )}
      >
        <AppSidebarProvider>
          <AppLayout
            withSidebar={side}
            sidebarSize={nav === 'tv-rail' && named ? 'sm' : 'slim'}
          >
            {side && (
              <AppLayoutSidebar data-ui="sidebar">
                {nav === 'rail' ? (
                  <TouchRail
                    items={items}
                    footerItems={[settingsItem]}
                    you={you}
                    named={named}
                  />
                ) : nav === 'tv-rail' ? (
                  <TvRail
                    items={items}
                    footerItems={[settingsItem]}
                    you={you}
                    open={named}
                  />
                ) : (
                  <Sidebar
                    header={<Logo />}
                    items={items}
                    belowItems={<HistoryButtons />}
                    footerItems={[settingsItem]}
                    footer={<SidebarAccount you={you} />}
                  />
                )}
              </AppLayoutSidebar>
            )}
            {shape === 'floating' &&
              (nav === 'rail' ? (
                <TouchRail
                  items={items}
                  footerItems={[settingsItem]}
                  you={you}
                  named={named}
                  floating
                />
              ) : (
                <TvRail
                  items={items}
                  footerItems={[settingsItem]}
                  you={you}
                  open={named}
                  floating
                />
              ))}
            <AppLayout>
              <AppLayoutContent
                style={
                  top
                    ? ({
                        // Narrow windows have the bottom bar instead, but a TV's web view may be narrower still.
                        [nav === 'top' ? '--top-bar-wide' : '--top-bar']:
                          TOP_BAR_HEIGHT[topBar],
                      } as React.CSSProperties)
                    : shape === 'floating'
                      ? ({
                          '--side-bar':
                            FLOAT_GUTTER[nav === 'rail' ? 'touch' : 'tv'][
                              named ? 'named' : 'icons'
                            ],
                        } as React.CSSProperties)
                      : undefined
                }
                className={cn(
                  // A page swiped past the edge mustn't widen the document.
                  touch && !currentHost().tv && 'overflow-x-clip',
                  shape === 'corner' &&
                    (nav === 'rail'
                      ? 'lg:[--top-bar:calc(1rem+3.875rem)]'
                      : '[--top-bar:calc(1.5rem+3.875rem)]'),
                  nav === 'top' && 'lg:[--top-bar:var(--top-bar-wide)]'
                )}
              >
                {shape === 'corner' && (
                  <CornerMenu
                    items={items}
                    footerItems={[settingsItem]}
                    you={you}
                    tv={nav === 'tv-rail'}
                  />
                )}
                {top && (
                  <TopTabs
                    style={topBar}
                    names={tabNames === 'shown'}
                    tv={nav === 'tv-top'}
                    // A row of named tabs fills up; these sit with the icons at its end.
                    items={items.filter(
                      (i) => i !== together && i !== playlists
                    )}
                    footerItems={[playlists, together, settingsItem]}
                    you={you}
                  />
                )}
                <VersionPickerProvider>
                  <RemoteTarget />
                  <ReminderHost />
                  <RandomPick />
                  <PlaylistsHost />
                  {currentHost().watchNext && <WatchNextSync />}
                  <ItemMenuHost>
                    <GlideLayers name="page">
                      {kept && (
                        <motion.div
                          key={kept}
                          data-page="home"
                          {...PAGE_FADE}
                          inert={!onHome}
                          className={cn(
                            page,
                            !onHome &&
                              'invisible absolute inset-x-0 top-0 [content-visibility:hidden]'
                          )}
                        >
                          <PageShown.Provider value={onHome}>
                            <KeptHome />
                          </PageShown.Provider>
                          {onHome && <PageScroll />}
                        </motion.div>
                      )}
                      {!onHome && !playing && (
                        <motion.div
                          key={pathname}
                          data-page={pageName(pathname)}
                          {...PAGE_FADE}
                          initial={pageOpening() ? false : PAGE_FADE.initial}
                          className={page}
                        >
                          <Outlet />
                          <PageScroll />
                        </motion.div>
                      )}
                    </GlideLayers>
                  </ItemMenuHost>
                </VersionPickerProvider>
              </AppLayoutContent>
            </AppLayout>
          </AppLayout>
          {!currentHost().tv && (
            <MobileNav
              items={items}
              places={[
                ...(live ? [live] : []),
                ...(downloads ? [downloads] : []),
                activity,
                calendar,
                playlists,
                together,
                ...items.filter(onBar),
              ]}
              menuItems={several ? [settingsItem, switchItem] : [settingsItem]}
              wide={nav === 'bar'}
              named={tabNames === 'shown'}
            />
          )}
          <ConnectionNote />
        </AppSidebarProvider>
      </div>
      {playing && <Outlet />}
      {playback && (
        <PlayerPage
          key={`${playback.itemId}|${playback.sourceId}|${playback.playlist ?? ''}`}
          itemId={playback.itemId}
          sourceId={playback.sourceId}
          startMs={playback.startMs}
          playlist={playback.playlist}
          mini={playback.mini}
        />
      )}
      <PartyHost />
      <RemoteSheet />
    </>
  );
}

/**
 * Tells the playback which way its page closed, by the history entry it left
 * for: an earlier one is Back.
 */
function usePlayerLeaving() {
  const onPlayer = useChildMatches({
    select: (matches) =>
      /^\/play\/(?!trailer\/)/.test(matches[0]?.pathname ?? ''),
  });
  const index = useRouterState({
    select: (s) => s.location.state.__TSR_index ?? 0,
  });
  const was = React.useRef({ onPlayer, index });
  React.useLayoutEffect(() => {
    const before = was.current;
    was.current = { onPlayer, index };
    if (!before.onPlayer || onPlayer) return;
    leftPlayback(
      index < before.index
        ? 'back'
        : index > before.index
          ? 'forward'
          : 'replace'
    );
  }, [onPlayer, index]);
}

/** What runs while pages are open, and stops while the player is; downloads start nothing new while the mini player plays. */
function PagesWork({
  pathname,
  playing,
}: {
  pathname: string;
  playing: boolean;
}) {
  useDiscordBrowsing(pathname);
  usePendingStops();
  useWebGpuWarmUp();
  useAction('search', () => navigate(to.search()));
  useAction('home', () => navigate(to.home));
  return (
    <>
      <DownloadRunner paused={playing} />
      {shellHost() && <UpdatePrompt />}
      {usageStatsOffered() && <UsageStats />}
    </>
  );
}

function DownloadRunner({ paused }: { paused: boolean }) {
  useDownloadRunner(paused);
  return null;
}

/** How much of the page's left a floating rail keeps clear. */
const FLOAT_GUTTER = {
  touch: {
    named: 'calc(1rem + 4.75rem + 2px + 1rem)',
    icons: 'calc(1rem + 3.75rem + 2px + 1rem)',
  },
  tv: {
    named: 'calc(1.5rem + 14rem + 1.5rem)',
    icons: 'calc(1.5rem + 4rem + 2px + 1.5rem)',
  },
};
