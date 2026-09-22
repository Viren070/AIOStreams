import './app/globals.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';

/** The Jellyfin API serves its web app at `/web` under any of its mounts. */
const JELLYFIN_WEB_PATH = /^\/jellyfin(\/.*)?\/web(\/(index\.html)?)?$/i;

const App = React.lazy(() =>
  JELLYFIN_WEB_PATH.test(window.location.pathname)
    ? import('./app/jellyfin/app')
    : import('./router').then(({ router }) => ({
        default: () => <RouterProvider router={router} />,
      }))
);

const rootEl = document.getElementById('root')!;

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <React.Suspense fallback={null}>
        <App />
      </React.Suspense>
    </QueryClientProvider>
  </React.StrictMode>
);
