import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { RouterProvider } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@aiostreams/ui/toaster';
import { LoadingOverlay } from '@aiostreams/ui/loading-spinner';
import { pickerUuid, SessionProvider, useSessionPhase } from './lib/session';
import { announceToAndroid } from './lib/hosts/jellyfin-android';
import { webRouter } from './router';
import { SignInPage, UserPicker } from './pages/sign-in';
import { PageBackground } from './components/layout';
import { BrandingProvider, useServerBranding } from './components/brand-logo';
import { apiBase, JellyfinClient } from './lib/client';
import { configureUrl, navigate, to } from './lib/paths';
import type { UserDto } from './lib/types';
import {
  currentServer,
  enterServer,
  leaveServer,
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
          <BrandingProvider value={{ name: null, logo: null }}>
            <ServersPage onChoose={choose} />
          </BrandingProvider>
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
  const { phase, signIn, switchUser, signOut } = useSessionPhase(base);
  useStableScrollbar();

  React.useEffect(() => announceToAndroid(base), [base]);

  const ready = phase.kind === 'ready' ? phase : null;
  const anonymous = React.useMemo(() => new JellyfinClient(base), [base]);
  const branding = useServerBranding(
    phase.kind === 'ready' || phase.kind === 'picking'
      ? phase.client
      : anonymous,
    phase.kind === 'picking' ? phase.branding : undefined
  );
  React.useEffect(() => {
    document.title = branding.name || 'AIOStreams';
  }, [branding.name]);
  const picker = pickerUuid(base);
  const pinSignInQuery = useQuery({
    queryKey: ['jf-pin-sign-in', base],
    queryFn: async () => {
      const info = await anonymous.get<{
        aiostreams?: { pinSignIn?: boolean };
      }>('/System/Info/Public');
      return info.aiostreams?.pinSignIn ?? false;
    },
    enabled: phase.kind === 'signed-out' && !!picker,
    staleTime: 5 * 60_000,
  });
  const pinSignIn = pinSignInQuery.data ?? false;
  // A picker address lists its users, so nobody has to type the UUID.
  const publicUsersQuery = useQuery({
    queryKey: ['jf-public-users', base],
    queryFn: () => anonymous.get<UserDto[]>('/Users/Public'),
    enabled: phase.kind === 'signed-out' && !!picker,
    staleTime: 5 * 60_000,
  });
  const listed = publicUsersQuery.data ?? [];
  const [chosen, setChosen] = React.useState<UserDto | null>(null);
  const [manual, setManual] = React.useState(false);
  const signInAs = manual
    ? null
    : (chosen ?? (listed.length === 1 ? listed[0] : null));
  const byUuid = {
    label: 'Use a UUID instead',
    onClick: () => setManual(true),
  };
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
    case 'signed-out':
      // The form keeps its first username, so it waits to know which to offer.
      screen =
        pinSignInQuery.isLoading || publicUsersQuery.isLoading ? (
          <LoadingOverlay />
        ) : listed.length > 1 && !signInAs && !manual ? (
          <UserPicker
            users={listed.map((user) => ({
              user,
              avatar: null,
              hidden: false,
              needs: null,
            }))}
            onPick={async (id) =>
              setChosen(listed.find((u) => u.Id === id) ?? null)
            }
            otherWay={byUuid}
            onChangeServer={changeServer}
          />
        ) : (
          <SignInPage
            key={signInAs?.Id ?? 'uuid'}
            onSignIn={signIn}
            defaultUsername={pinSignIn ? '' : picker}
            pinSignIn={pinSignIn}
            user={signInAs ?? undefined}
            otherWay={
              signInAs
                ? listed.length > 1
                  ? {
                      label: 'Choose another user',
                      onClick: () => setChosen(null),
                    }
                  : byUuid
                : listed.length
                  ? {
                      label: 'Choose a user',
                      onClick: () => {
                        setChosen(null);
                        setManual(false);
                      },
                    }
                  : undefined
            }
            configureUrl={configureUrl(base, branding)}
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
    <BrandingProvider value={branding}>
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
    </BrandingProvider>
  );
}
