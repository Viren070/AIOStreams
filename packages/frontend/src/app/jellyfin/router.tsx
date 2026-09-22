import React from 'react';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { WebLayout } from './components/layout';
import { navigate, setNavigator, to } from './lib/paths';
import { lastCatalog } from './lib/settings';
import { HomePage } from './pages/home';
import { DiscoverIndex, DiscoverPage } from './pages/discover';
import { SearchPage } from './pages/search';
import { ItemPage } from './pages/item';
import { PersonPage } from './pages/person';
import { HistoryPage } from './pages/history';
import { PlayerPage } from './pages/player';

const rootRoute = createRootRoute({ component: Outlet });

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: WebLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: HomePage,
});

const historyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/history',
  component: HistoryPage,
});

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
  }),
  component: ItemRouteView,
});

function ItemRouteView(): React.ReactElement {
  const { itemId } = itemRoute.useParams();
  const { season, episode } = itemRoute.useSearch();
  return (
    <ItemPage
      key={itemId}
      itemId={itemId}
      seasonId={season}
      episodeId={episode}
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
  getParentRoute: () => rootRoute,
  path: '/play/$itemId',
  validateSearch: (search: Record<string, unknown>) => ({
    source: search.source == null ? '' : String(search.source),
    start: Number(search.start) || 0,
  }),
  component: PlayRouteView,
});

function PlayRouteView(): React.ReactElement {
  const { itemId } = playRoute.useParams();
  const { source, start } = playRoute.useSearch();
  return (
    <PlayerPage
      key={`${itemId}|${source}`}
      itemId={itemId}
      sourceId={source}
      startMs={start}
    />
  );
}

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    homeRoute,
    historyRoute,
    searchRoute,
    discoverIndexRoute,
    discoverRoute,
    libraryRoute,
    itemRoute,
    personRoute,
  ]),
  playRoute,
]);

export const webRouter = createRouter({
  routeTree,
  history: createHashHistory(),
  scrollRestoration: true,
});

setNavigator((path, replace) =>
  replace ? webRouter.history.replace(path) : webRouter.history.push(path)
);

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

/*
 * The Android app sends its back button to `NavigationHelper.goBack()`, which
 * jellyfin-web defines. An open overlay closes first; at the root it exits.
 */
if (window.NativeInterface) {
  window.NavigationHelper = {
    goBack() {
      if (document.querySelector('[role="dialog"], [role="menu"]')) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      } else if (webRouter.history.canGoBack()) {
        webRouter.history.back();
      } else {
        window.NativeInterface?.exitApp?.();
      }
    },
  };
}
