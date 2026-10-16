import './styles.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import JellyfinWebApp from './app';
import { persister } from './lib/cache';
import { followReachable } from './lib/connection';
import { startI18n } from './lib/i18n';
import { setupTv } from './lib/tv';

onlineManager.setEventListener(followReachable);
setupTv();

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

const container = document.getElementById('root')!;
// React listens at its root and at the body, where portals go, for every event
// it knows, so the browser would build and send one for each CSS transition and
// animation, which nothing uses.
for (const el of [container, document.body]) {
  const listen = el.addEventListener;
  el.addEventListener = function (
    this: HTMLElement,
    ...args: Parameters<HTMLElement['addEventListener']>
  ) {
    if (!/^(transition|animation)/.test(args[0])) listen.apply(this, args);
  };
}

// The page waits for its language, so it never shows English first.
void startI18n().then(() =>
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <JellyfinWebApp />
        </QueryClientProvider>
      </I18nProvider>
    </React.StrictMode>
  )
);
