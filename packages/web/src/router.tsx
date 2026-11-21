import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { PageMessage } from './components/shell/page';
import { WebLayout } from './components/shell/layout';
import type { PageView } from './components/shell/page-stack';
import { navigate, setNavigator, to } from './lib/paths';
import { lastCatalog } from './lib/settings';
import { openStartPage } from './lib/start-page';
import { HomePage } from './app/home/page';
import { DiscoverIndex, DiscoverPage } from './app/discover/page';
import { FavouritesPage } from './app/favourites/page';
import { CalendarPage } from './app/calendar/page';
import { LiveTvPage } from './app/live-tv/page';
import { SearchPage } from './app/search/page';
import { ItemPage } from './app/item/page';
import { PersonPage } from './app/person/page';
import { HistoryPage } from './app/history/page';
import { DownloadsPage } from './app/downloads/page';
import { openPlayback } from './lib/playback/session';
import { endNowPlaying } from './lib/playback/now-playing';
import { TrailerPage } from './app/trailer/page';
import { Button } from '@aiostreams/ui/button';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { SettingsPage } from './app/settings/page';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** What the layout shows for each of the route's history entries, rather than its outlet. */
    page?: PageView;
  }
}

const rootRoute = createRootRoute({ component: Outlet });

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: WebLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  staticData: { page: () => <HomePage /> },
});

const historyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/history',
  staticData: { page: () => <HistoryPage /> },
});

const downloadsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/downloads',
  staticData: { page: () => <DownloadsPage /> },
});

const favouritesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/favourites',
  validateSearch: (search: Record<string, unknown>) => ({
    kind: search.kind == null ? undefined : String(search.kind),
  }),
  staticData: {
    page: ({ search }) => <FavouritesPage kind={search.kind} />,
  },
});

const liveRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/live',
  validateSearch: (search: Record<string, unknown>) => ({
    group: search.group == null ? undefined : String(search.group),
    view: search.view == null ? undefined : String(search.view),
  }),
  staticData: {
    page: ({ search }) => (
      <LiveTvPage group={search.group} view={search.view} />
    ),
  },
});

const calendarRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calendar',
  validateSearch: (search: Record<string, unknown>) => ({
    month: search.month == null ? undefined : String(search.month),
  }),
  staticData: {
    page: ({ search }) => <CalendarPage month={search.month} />,
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab == null ? '' : String(search.tab),
    for: search.for == null ? '' : String(search.for),
  }),
  staticData: {
    page: ({ search }) => (
      <SettingsPage tab={search.tab ?? ''} who={search.for ?? ''} />
    ),
  },
});

const searchRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/search',
  validateSearch: (search: Record<string, unknown>) => ({
    q: search.q == null ? '' : String(search.q),
  }),
  staticData: {
    page: ({ search }) => <SearchPage initialTerm={search.q ?? ''} />,
  },
});

const discoverIndexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/discover',
  staticData: {
    page: () => <DiscoverIndex lastViewId={lastCatalog()} />,
  },
});

const discoverRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/discover/$viewId',
  validateSearch: (search: Record<string, unknown>) => ({
    genre: search.genre == null ? undefined : String(search.genre),
    kind: search.kind == null ? undefined : String(search.kind),
  }),
  staticData: {
    page: ({ params, search }) => (
      <DiscoverPage
        viewId={params.viewId}
        genre={search.genre}
        kind={search.kind}
      />
    ),
  },
});

/** Where catalogs used to live. */
const libraryRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/library/$viewId',
  staticData: {
    page: ({ params }) => <LibraryRedirect viewId={params.viewId} />,
  },
});

function LibraryRedirect({ viewId }: { viewId: string }): null {
  React.useEffect(() => {
    navigate(to.discover(viewId), { replace: true });
  }, [viewId]);
  return null;
}

const itemRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/item/$itemId',
  validateSearch: (search: Record<string, unknown>) => ({
    season: search.season == null ? undefined : String(search.season),
    episode: search.episode == null ? undefined : String(search.episode),
    pick: search.pick == null ? undefined : String(search.pick),
    playlist: search.playlist == null ? undefined : String(search.playlist),
  }),
  staticData: {
    page: ({ params, search }) => (
      <ItemPage
        itemId={params.itemId}
        seasonId={search.season}
        episodeId={search.episode}
        pickId={search.pick}
        playlistId={search.playlist}
      />
    ),
  },
});

const personRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/person/$personId',
  staticData: {
    page: ({ params }) => <PersonPage personId={params.personId} />,
  },
});

const playRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/play/$itemId',
  validateSearch: (search: Record<string, unknown>) => ({
    source: search.source == null ? '' : String(search.source),
    start: Number(search.start) || 0,
    playlist: search.playlist == null ? undefined : String(search.playlist),
  }),
  component: PlayRouteView,
});

const trailerRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/play/trailer/$itemId',
  validateSearch: (search: Record<string, unknown>) => ({
    trailer: Number(search.trailer) || 0,
  }),
  component: TrailerRouteView,
});

function TrailerRouteView(): React.ReactElement {
  const { itemId } = trailerRoute.useParams();
  const { trailer } = trailerRoute.useSearch();
  // Here, not in the page, which each trailer remounts.
  React.useEffect(() => endNowPlaying, []);
  return (
    <TrailerPage key={`${itemId}|${trailer}`} itemId={itemId} index={trailer} />
  );
}

/** The layout draws the player, which plays on in the mini player after its page closes. */
function PlayRouteView(): null {
  const { itemId } = playRoute.useParams();
  const { source, start, playlist } = playRoute.useSearch();
  React.useLayoutEffect(() => {
    openPlayback({ itemId, sourceId: source, startMs: start, playlist });
  }, [itemId, source, start, playlist]);
  return null;
}

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    homeRoute,
    historyRoute,
    downloadsRoute,
    favouritesRoute,
    liveRoute,
    calendarRoute,
    settingsRoute,
    searchRoute,
    discoverIndexRoute,
    discoverRoute,
    libraryRoute,
    itemRoute,
    personRoute,
    playRoute,
    trailerRoute,
  ]),
]);

function NotFoundPage(): React.ReactElement {
  return (
    <PageMessage>
      <LuffyError title={t`There is nothing here`} className="mt-0">
        <p className="text-sm text-[--muted]">
          <Trans>The link may be old, or the page moved.</Trans>
        </p>
        <Button
          intent="white"
          className="mt-4 rounded-full"
          onClick={() => navigate(to.home, { replace: true })}
        >
          <Trans>Go home</Trans>
        </Button>
      </LuffyError>
    </PageMessage>
  );
}

openStartPage();

export const webRouter = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFoundPage,
  history: createHashHistory(),
  scrollRestoration: true,
});

setNavigator((path, { replace, keepScroll }) => {
  if (keepScroll)
    void webRouter.navigate({ href: path, replace, resetScroll: false });
  else if (replace) webRouter.history.replace(path);
  else return webRouter.history.push(path);
  // The history batches a tick's changes into one, so a push right after would drop this.
  if (replace) webRouter.history.flush();
}, startOver);

let restarting: Promise<void> | undefined;

// One at a time: two going back by the same count would leave the app.
function startOver(path: string): Promise<void> {
  return (restarting ??= goToFirstEntry(path).finally(() => {
    restarting = undefined;
  }));
}

async function goToFirstEntry(path: string) {
  const { history } = webRouter;
  const steps = history.location.state.__TSR_index;
  if (steps > 0) {
    await new Promise<void>((done) => {
      const stop = history.subscribe(() => {
        stop();
        done();
      });
      // A go past the entries the browser still has does nothing, popstate included.
      setTimeout(() => {
        stop();
        done();
      }, 1000);
      history.go(-steps);
    });
  }
  history.replace(path);
  history.flush();
}

/*
 * In-app links are plain anchors, so opening one in a new tab works. A plain
 * click goes through the router's history instead, which counts its entries:
 * one the browser adds on its own looks like the first, and back would leave.
 */
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const anchor = (e.target as Element | null)?.closest?.('a[href^="#/"]');
  if (!anchor || anchor.getAttribute('target')) return;
  e.preventDefault();
  navigate(anchor.getAttribute('href')!.slice(1));
});
