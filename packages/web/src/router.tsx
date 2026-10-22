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
import { PageMessage, WebLayout } from './components/layout';
import { navigate, setNavigator, to } from './lib/paths';
import { lastCatalog } from './lib/settings';
import { DiscoverIndex, DiscoverPage } from './pages/discover';
import { FavouritesPage } from './pages/favourites';
import { CalendarPage } from './pages/calendar';
import { SearchPage } from './pages/search';
import { ItemPage } from './pages/item';
import { PersonPage } from './pages/person';
import { HistoryPage } from './pages/history';
import { DownloadsPage } from './pages/downloads';
import { PlayerPage } from './pages/player';
import { TrailerPage } from './pages/trailer';
import { Button } from '@aiostreams/ui/button';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { SettingsPage } from './pages/settings';

const rootRoute = createRootRoute({ component: Outlet });

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: WebLayout,
});

// The layout renders the home page itself, to keep it while others are open.
const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: () => null,
});

const historyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/history',
  component: HistoryPage,
});

const downloadsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/downloads',
  component: DownloadsPage,
});

const favouritesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/favourites',
  validateSearch: (search: Record<string, unknown>) => ({
    kind: search.kind == null ? undefined : String(search.kind),
  }),
  component: FavouritesRouteView,
});

function FavouritesRouteView(): React.ReactElement {
  const { kind } = favouritesRoute.useSearch();
  return <FavouritesPage kind={kind} />;
}

const calendarRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calendar',
  validateSearch: (search: Record<string, unknown>) => ({
    month: search.month == null ? undefined : String(search.month),
  }),
  component: CalendarRouteView,
});

function CalendarRouteView(): React.ReactElement {
  const { month } = calendarRoute.useSearch();
  return <CalendarPage month={month} />;
}

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab == null ? '' : String(search.tab),
  }),
  component: SettingsRouteView,
});

function SettingsRouteView(): React.ReactElement {
  const { tab } = settingsRoute.useSearch();
  return (
    <SettingsPage
      tab={tab}
      onTabChange={(next) => navigate(to.settings(next), { replace: true })}
    />
  );
}

const searchRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/search',
  validateSearch: (search: Record<string, unknown>) => ({
    q: search.q == null ? '' : String(search.q),
  }),
  component: SearchRouteView,
});

function SearchRouteView(): React.ReactElement {
  const { q } = searchRoute.useSearch();
  return <SearchPage initialTerm={q} />;
}

const discoverIndexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/discover',
  component: () => <DiscoverIndex lastViewId={lastCatalog()} />,
});

const discoverRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/discover/$viewId',
  validateSearch: (search: Record<string, unknown>) => ({
    genre: search.genre == null ? undefined : String(search.genre),
    kind: search.kind == null ? undefined : String(search.kind),
  }),
  component: DiscoverRouteView,
});

function DiscoverRouteView(): React.ReactElement {
  const { viewId } = discoverRoute.useParams();
  const { genre, kind } = discoverRoute.useSearch();
  return <DiscoverPage viewId={viewId} genre={genre} kind={kind} />;
}

/** Where catalogs used to live. */
const libraryRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/library/$viewId',
  component: LibraryRouteView,
});

function LibraryRouteView(): React.ReactElement {
  const { viewId } = libraryRoute.useParams();
  React.useEffect(() => {
    navigate(to.discover(viewId), { replace: true });
  }, [viewId]);
  return <></>;
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
  component: ItemRouteView,
});

function ItemRouteView(): React.ReactElement {
  const { itemId } = itemRoute.useParams();
  const { season, episode, pick, playlist } = itemRoute.useSearch();
  return (
    <ItemPage
      key={itemId}
      itemId={itemId}
      seasonId={season}
      episodeId={episode}
      pickId={pick}
      playlistId={playlist}
    />
  );
}

const personRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/person/$personId',
  component: PersonRouteView,
});

function PersonRouteView(): React.ReactElement {
  const { personId } = personRoute.useParams();
  return <PersonPage key={personId} personId={personId} />;
}

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
  return (
    <TrailerPage key={`${itemId}|${trailer}`} itemId={itemId} index={trailer} />
  );
}

function PlayRouteView(): React.ReactElement {
  const { itemId } = playRoute.useParams();
  const { source, start, playlist } = playRoute.useSearch();
  return (
    <PlayerPage
      key={`${itemId}|${source}`}
      itemId={itemId}
      sourceId={source}
      startMs={start}
      playlist={playlist}
    />
  );
}

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    homeRoute,
    historyRoute,
    downloadsRoute,
    favouritesRoute,
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
