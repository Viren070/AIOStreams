import { createRoute, createRouter, redirect } from '@tanstack/react-router';
import { rootRoute } from './routes/root';
import { IndexPage } from './routes/index-page';
import { LoginPage, safeNext } from './routes/login-page';
import { DashboardLayout } from './routes/dashboard-layout';
import {
  DashboardHome,
  AnalyticsPage,
  LogsPage,
  SystemPage,
  SettingsPage,
  ProxyPage,
  UsersPage,
  TasksPage,
  CachePage,
  UsenetLayout,
  UsenetLibraryPage,
  UsenetStreamsPage,
  UsenetStatsPage,
  UsenetProvidersPage,
  UsenetSettingsPage,
} from './routes/dashboard-pages';
import { SplashscreenPage } from './routes/splashscreen-page';
import { ConfigureRoute } from './routes/configure-route';
import { OAuthCallback } from './routes/oauth-callback';
import { sessionQuery, statusQuery } from './lib/queries';
import { queryClient } from './lib/query-client';
import type { StatusResponse } from '@aiostreams/core';

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async () => {
    const session = await queryClient
      .ensureQueryData(sessionQuery)
      .catch(() => null);
    if (session) {
      // Honour `?next=` so deeplinks (e.g. Stremio's configure intermediary
      // 302→/login?next=/stremio/<uuid>/<blob>/configure) round-trip back to
      // the originally requested page when the user is already logged in.
      // `safeNext` rejects anything that isn't a same-origin absolute path.
      const params = new URLSearchParams(window.location.search);
      const target = safeNext(params.get('next'));
      // Non-admin users trying to reach a dashboard route should see the
      // login form so they can sign in as a different (admin) account.
      if (!session.isAdmin && target.startsWith('/dashboard')) {
        return;
      }
      throw redirect({ href: target } as never);
    }
  },
  component: LoginPage,
});

const oauthGdriveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oauth/callback/gdrive',
  component: OAuthCallback,
});

const splashscreenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/splashscreen',
  component: SplashscreenPage,
});

// Auth gate for the configure routes: if the instance is protected, a valid
// session is required. Also pre-fetches status so the page renders immediately.
async function configureBeforeLoad({
  location,
}: {
  location: { href: string };
}) {
  const status = await queryClient
    .ensureQueryData(statusQuery)
    .catch(() => null);
  if ((status as StatusResponse | null)?.settings?.protected) {
    const session = await queryClient
      .ensureQueryData(sessionQuery)
      .catch(() => null);
    if (!session) {
      throw redirect({
        to: '/login',
        search: { next: location.href } as never,
      });
    }
  }
}

const stremioConfigureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stremio/configure',
  beforeLoad: configureBeforeLoad,
  component: ConfigureRoute,
});

const stremioConfigureAuthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stremio/$uuid/$encryptedPassword/configure',
  beforeLoad: configureBeforeLoad,
  component: ConfigureRoute,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  beforeLoad: async ({ location }) => {
    const session = await queryClient
      .ensureQueryData(sessionQuery)
      .catch(() => null);
    if (!session) {
      throw redirect({
        to: '/login',
        search: { next: location.href } as never,
      });
    }
    if (!session.isAdmin) {
      throw redirect({
        to: '/login',
        search: { next: location.href, error: 'forbidden' } as never,
      });
    }
  },
  component: DashboardLayout,
});

const dashboardIndexRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/',
  component: DashboardHome,
});

const dashboardAnalyticsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'analytics',
  component: AnalyticsPage,
});

const dashboardLogsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'logs',
  component: LogsPage,
});

const dashboardSystemRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'system',
  component: SystemPage,
});

const dashboardSettingsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'settings',
  component: SettingsPage,
});

const dashboardProxyRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'proxy',
  component: ProxyPage,
});

const dashboardUsersRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'users',
  component: UsersPage,
});

const dashboardTasksRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'tasks',
  component: TasksPage,
});

const dashboardCacheRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'cache',
  component: CachePage,
});

const dashboardUsenetRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'usenet',
  component: UsenetLayout,
});

// `/dashboard/usenet` → redirect to the default section.
const dashboardUsenetIndexRoute = createRoute({
  getParentRoute: () => dashboardUsenetRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard/usenet/library' });
  },
});

const dashboardUsenetLibraryRoute = createRoute({
  getParentRoute: () => dashboardUsenetRoute,
  path: 'library',
  component: UsenetLibraryPage,
});

const dashboardUsenetStreamsRoute = createRoute({
  getParentRoute: () => dashboardUsenetRoute,
  path: 'streams',
  component: UsenetStreamsPage,
});

const dashboardUsenetStatsRoute = createRoute({
  getParentRoute: () => dashboardUsenetRoute,
  path: 'stats',
  component: UsenetStatsPage,
});

const dashboardUsenetProvidersRoute = createRoute({
  getParentRoute: () => dashboardUsenetRoute,
  path: 'providers',
  component: UsenetProvidersPage,
});

const dashboardUsenetSettingsRoute = createRoute({
  getParentRoute: () => dashboardUsenetRoute,
  path: 'settings',
  component: UsenetSettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  stremioConfigureRoute,
  stremioConfigureAuthRoute,
  loginRoute,
  oauthGdriveRoute,
  splashscreenRoute,
  dashboardRoute.addChildren([
    dashboardIndexRoute,
    dashboardAnalyticsRoute,
    dashboardLogsRoute,
    dashboardSystemRoute,
    dashboardSettingsRoute,
    dashboardProxyRoute,
    dashboardUsersRoute,
    dashboardTasksRoute,
    dashboardCacheRoute,
    dashboardUsenetRoute.addChildren([
      dashboardUsenetIndexRoute,
      dashboardUsenetLibraryRoute,
      dashboardUsenetStreamsRoute,
      dashboardUsenetStatsRoute,
      dashboardUsenetProvidersRoute,
      dashboardUsenetSettingsRoute,
    ]),
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  trailingSlash: 'never',
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
