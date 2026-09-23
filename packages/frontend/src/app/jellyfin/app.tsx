import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { LoadingOverlay } from '@/components/ui/loading-spinner';
import { pickerUuid, SessionProvider, useSessionPhase } from './lib/session';
import { announceToAndroid } from './lib/hosts';
import { webRouter } from './router';
import { SignInPage, UserPicker } from './pages/sign-in';
import { PageBackground } from './components/layout';
import { BrandingProvider, useServerBranding } from './components/brand-logo';
import { JellyfinClient } from './lib/client';

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
        <Session />
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

function Session() {
  const { base, phase, signIn, switchUser, signOut } = useSessionPhase();
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
      screen = (
        <SignInPage onSignIn={signIn} defaultUsername={pickerUuid(base)} />
      );
      break;
    case 'picking':
      screen = <UserPicker users={phase.users} onPick={phase.choose} />;
      break;
    case 'ready':
      screen = (
        <SessionProvider
          client={phase.client}
          user={phase.user}
          switchUser={switchUser}
          signOut={signOut}
        >
          <RouterProvider router={webRouter} />
        </SessionProvider>
      );
      break;
  }

  // Signed in, the layout draws its own background, which the player leaves out.
  return (
    <BrandingProvider value={branding}>
      {!ready && <PageBackground />}
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
