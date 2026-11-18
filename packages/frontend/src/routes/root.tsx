import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@aiostreams/ui/toaster';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { LoadingOverlay } from '@aiostreams/ui/loading-spinner';
import type { QueryClient } from '@tanstack/react-query';
import { PHONE_LAYOUT } from '@/context/menu';
import { lazy, Suspense } from 'react';

const DevTools = import.meta.env.DEV
  ? lazy(async () => {
      const [
        { TanStackDevtools },
        { ReactQueryDevtoolsPanel },
        { TanStackRouterDevtoolsPanel },
      ] = await Promise.all([
        import('@tanstack/react-devtools'),
        import('@tanstack/react-query-devtools'),
        import('@tanstack/react-router-devtools'),
      ]);
      return {
        default: function DevTools() {
          return (
            <TanStackDevtools
              plugins={[
                { name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> },
                {
                  name: 'TanStack Router',
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
          );
        },
      };
    })
  : null;

function NotFound() {
  return (
    <LoadingOverlay showSpinner={false}>
      <LuffyError title="Page not found" showRefreshButton={false}>
        <p>The page you are looking for does not exist.</p>
      </LuffyError>
    </LoadingOverlay>
  );
}

function RootComponent() {
  // Clear of a phone's Save bar, and of the header wider screens save from.
  const phone = useMediaQuery(PHONE_LAYOUT);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <Toaster
        // It reads its props once.
        key={phone ? 'phone' : 'wide'}
        position={phone ? 'top-center' : 'bottom-right'}
        swipeDirections={phone ? ['top', 'right'] : ['bottom', 'right']}
      />
      <Outlet />
      {DevTools && (
        <Suspense>
          <DevTools />
        </Suspense>
      )}
    </ThemeProvider>
  );
}

export const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootComponent,
  notFoundComponent: NotFound,
});
