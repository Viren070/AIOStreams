import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { RouterProvider } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@aiostreams/ui/toaster';
import { LoadingOverlay } from '@aiostreams/ui/loading-spinner';
import { pickerUuid, SessionProvider, useSessionPhase } from './lib/session';
import { announceToAndroid } from './lib/hosts/jellyfin-android';
import { webRouter } from './router';
import { SignInScreen, Unreachable, UserPicker } from './pages/sign-in';
import { PageBackground } from './components/layout';
import { apiBase, JellyfinClient } from './lib/client';
import { navigate, to } from './lib/paths';
import {
  NO_SERVER_INFO,
  ServerInfoProvider,
  useServerInfoQuery,
} from './lib/server-info';
import {
  currentServer,
  enterServer,
  leaveServer,
  serverAddress,
  type SavedServer,
} from './lib/servers';
import { ServersPage } from './pages/servers';
import { playbackHost } from './lib/hosts';
import { ShellSetup } from './lib/hosts/shell';

/** The web app served at the Jellyfin API's `/web`. */
export default function JellyfinWebApp() {
  React.useEffect(() => {
    document.body.classList.add('jellyfin-web');
    return () => document.body.classList.remove('jellyfin-web');
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <MotionConfig reducedMotion="user">
        <Toaster
          swipeDirections={['top', 'right']}
          offset={{ top: 'calc(24px + env(safe-area-inset-top))' }}
          mobileOffset={{ top: 'calc(16px + env(safe-area-inset-top))' }}
        />
        <PageBackground />
        {playbackHost() === 'shell' && <ShellSetup />}
        {__STANDALONE__ ? <Standalone /> : <Served />}
      </MotionConfig>
    </ThemeProvider>
  );
}

/**
 * Keeps the page's own scrollbar, since an embedded engine can drop the gutter
 * an overlay's scroll lock reserves.
 */
function useStableScrollbar() {
  React.useEffect(() => {
    const html = document.documentElement;
    html.style.overflowY = 'scroll';
    return () => {
      html.style.overflowY = '';
    };
  }, []);
}

function Served() {
  const base = React.useMemo(apiBase, []);
  return <Session base={base} />;
}

/** Picks a server first; changing server comes back here without a reload. */
function Standalone() {
  const queryClient = useQueryClient();
  const [base, setBase] = React.useState(currentServer);

  const choose = React.useCallback((server: SavedServer) => {
    enterServer(server);
    setBase(server.base);
  }, []);
  const leave = React.useCallback(() => {
    leaveServer();
    navigate(to.home, { replace: true });
    queryClient.clear();
    setBase(null);
  }, [queryClient]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={base ?? 'servers'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        {base ? (
          <Session base={base} changeServer={leave} />
        ) : (
          <ServerInfoProvider value={NO_SERVER_INFO}>
            <ServersPage onChoose={choose} />
          </ServerInfoProvider>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Session({
  base,
  changeServer,
}: {
  base: string;
  changeServer?: () => void;
}) {
  const { phase, signIn, switchUser, signOut, retry } = useSessionPhase(base);
  useStableScrollbar();

  React.useEffect(() => announceToAndroid(base), [base]);

  const ready = phase.kind === 'ready' ? phase : null;
  const anonymous = React.useMemo(() => new JellyfinClient(base), [base]);
  const infoQuery = useServerInfoQuery(
    phase.kind === 'ready' || phase.kind === 'picking'
      ? phase.client
      : anonymous
  );
  const branding = phase.kind === 'picking' ? phase.branding : undefined;
  const info = React.useMemo(
    () => ({ ...(infoQuery.data ?? NO_SERVER_INFO), ...branding }),
    [infoQuery.data, branding]
  );
  React.useEffect(() => {
    document.title = info.name || 'AIOStreams';
  }, [info.name]);
  // The Android app reads the stored sign-in when this is requested.
  React.useEffect(() => {
    if (ready && window.NativeInterface) {
      void ready.client.post('/Sessions/Capabilities/Full', {}).catch(() => {});
    }
  }, [ready]);

  let screen: React.ReactNode;
  switch (phase.kind) {
    case 'loading':
      screen = <LoadingOverlay />;
      break;
    case 'unreachable':
      screen = (
        <Unreachable
          address={serverAddress(base)}
          onRetry={retry}
          onChangeServer={changeServer}
        />
      );
      break;
    case 'signed-out':
      // The form asks for what this server takes, so it waits to know.
      screen = infoQuery.isLoading ? (
        <LoadingOverlay />
      ) : infoQuery.isError ? (
        <Unreachable
          address={serverAddress(base)}
          onRetry={() => void infoQuery.refetch()}
          onChangeServer={changeServer}
        />
      ) : (
        <SignInScreen
          client={anonymous}
          defaultUsername={
            info.features.configSignIn && !info.pinSignIn
              ? pickerUuid(base)
              : ''
          }
          onSignIn={signIn}
          onChangeServer={changeServer}
        />
      );
      break;
    case 'picking':
      screen = (
        <UserPicker
          users={phase.users}
          onPick={phase.choose}
          onChangeServer={changeServer}
        />
      );
      break;
    case 'ready':
      screen = (
        <SessionProvider
          client={phase.client}
          user={phase.user}
          switchUser={switchUser}
          signOut={signOut}
          changeServer={changeServer}
        >
          <RouterProvider router={webRouter} />
        </SessionProvider>
      );
      break;
  }

  return (
    <ServerInfoProvider value={info}>
      <AnimatePresence mode="wait">
        <motion.div
          key={ready ? `ready-${ready.user.Id}` : phase.kind}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {screen}
        </motion.div>
      </AnimatePresence>
    </ServerInfoProvider>
  );
}
