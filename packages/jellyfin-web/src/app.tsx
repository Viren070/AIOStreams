import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { RouterProvider } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@aiostreams/ui/toaster';
import { LoadingOverlay } from '@aiostreams/ui/loading-spinner';
import { pickerAccount, SessionProvider, useSessionPhase } from './lib/session';
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
import { currentHost } from './lib/hosts';
import { ShellSetup, useShellLinks } from './lib/hosts/shell';
import { parseAppLink } from './lib/app-links';
import { toast } from 'sonner';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { ThemeStyles } from './components/theme-styles';
import { WindowControls } from './components/window-controls';
import { InputSetup } from './components/input-setup';

/** The web app served at the Jellyfin API's `/web`. */
export default function JellyfinWebApp() {
  React.useEffect(() => {
    const html = document.documentElement;
    document.body.classList.add('jellyfin-web');
    html.dataset.host = currentHost().name;
    return () => {
      document.body.classList.remove('jellyfin-web');
      delete html.dataset.host;
    };
  }, []);
  useStableScrollbar();
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <MotionConfig reducedMotion="user">
        <Toaster
          swipeDirections={['top', 'right']}
          offset={{ top: 'calc(24px + env(safe-area-inset-top))' }}
          mobileOffset={{ top: 'calc(16px + env(safe-area-inset-top))' }}
        />
        <PageBackground />
        <ThemeStyles />
        <InputSetup history={webRouter.history} />
        {currentHost().name === 'desktop' && (
          <>
            <ShellSetup />
            <WindowControls />
          </>
        )}
        {__STANDALONE__ ? <Standalone /> : <Served />}
      </MotionConfig>
    </ThemeProvider>
  );
}

/**
 * Keeps the page's own scrollbar on every screen, since an embedded engine can
 * drop the gutter an overlay's scroll lock reserves, and a see-through page
 * shows the empty gutter as a strip of the video surface.
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
  // A linked server fills in the add form; it never connects on its own.
  const [linked, setLinked] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);

  const choose = React.useCallback((server: SavedServer) => {
    enterServer(server);
    setLinked(null);
    setBase(server.base);
  }, []);
  const leave = React.useCallback(() => {
    leaveServer();
    navigate(to.home, { replace: true });
    queryClient.clear();
    setBase(null);
  }, [queryClient]);

  const confirmLeave = useConfirmationDialog({
    title: 'Add a server',
    description: asking
      ? `Leave ${base ? serverAddress(base) : 'this server'} to add ${serverAddress(asking)}?`
      : undefined,
    actionText: 'Continue',
    onConfirm: () => {
      setLinked(asking);
      leave();
    },
  });
  const openConfirm = confirmLeave.open;
  useShellLinks((raw) => {
    const link = parseAppLink(raw);
    if (!link) return void toast.error('The app cannot open that link');
    if (link.kind === 'route') return navigate(link.path);
    if (!base) return setLinked(link.address);
    setAsking(link.address);
    openConfirm();
  });

  return (
    <>
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
              <ServersPage key={linked} onChoose={choose} address={linked} />
            </ServerInfoProvider>
          )}
        </motion.div>
      </AnimatePresence>
      <ConfirmationDialog {...confirmLeave} />
    </>
  );
}

function Session({
  base,
  changeServer: leave,
}: {
  base: string;
  changeServer?: () => void;
}) {
  const { phase, signIn, signInWithQuickConnect, switchUser, signOut, retry } =
    useSessionPhase(base);
  const changeServer = leave ?? currentHost().selectServer;

  React.useEffect(() => currentHost().start?.({ base }), [base]);

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
  React.useEffect(() => {
    if (ready) currentHost().signedIn?.(ready.client);
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
              ? pickerAccount(base)
              : ''
          }
          onSignIn={signIn}
          onQuickConnect={signInWithQuickConnect}
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
