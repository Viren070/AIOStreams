import './styles.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import JellyfinWebApp from './app';
import { persister } from './lib/cache';
import { followReachable } from './lib/connection';

onlineManager.setEventListener(followReachable);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
      persister,
      // Runs even while the server is out of reach, so saved copies still load.
      networkMode: 'offlineFirst',
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <JellyfinWebApp />
    </QueryClientProvider>
  </React.StrictMode>
);
