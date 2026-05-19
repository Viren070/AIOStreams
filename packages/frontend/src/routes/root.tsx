import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { LuffyError } from '@/components/shared/luffy-error';
import { LoadingOverlay } from '@/components/ui/loading-spinner';
import type { QueryClient } from '@tanstack/react-query';
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
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <Outlet />
      <Toaster />
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
