import React from 'react';
import { toast } from 'sonner';
import { ConfigModal } from '@/components/config-modal';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import {
  endAllConfigSessions,
  endConfigSession,
  hasConfigSessionCookie,
  loadConfigFromSession,
} from '@/lib/api';
import { clearDrafts } from '@/lib/drafts';

type ConfigAuthContextType = {
  isSignedIn: boolean;
  /** Opens the sign in modal, optionally prefilled with a uuid. */
  openSignIn: (initialUuid?: string) => void;
  /** Opens the sign out confirmation. */
  openSignOut: () => void;
  /** Sign out when signed in, sign in otherwise. */
  toggleSession: () => void;
};

const ConfigAuthContext = React.createContext<ConfigAuthContextType | null>(
  null
);

/**
 * The uuid + password sign in for a saved config. Not the AIOStreams account
 * session, which `useSession` owns.
 */
export function useConfigAuth(): ConfigAuthContextType {
  const ctx = React.useContext(ConfigAuthContext);
  if (!ctx) {
    throw new Error('useConfigAuth must be used within a ConfigAuthProvider');
  }
  return ctx;
}

const CONFIGURE_URL_UUID =
  /stremio\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/.*\/configure/;

/**
 * Owns the single config sign in modal and sign out confirmation for the
 * configure app, so every entry point (sidebar, top navbar, page controls,
 * about page) shares one instance instead of mounting its own.
 */
export function ConfigAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    uuid,
    setUserData,
    setUuid,
    setPassword,
    setEncryptedPassword,
    setBaseline,
  } = useUserData();
  const { status } = useStatus();
  const [signInOpen, setSignInOpen] = React.useState(false);
  const [initialUuid, setInitialUuid] = React.useState<string | undefined>();
  const [signOutEverywhere, setSignOutEverywhere] = React.useState(false);

  const sessionsEnabled = status?.settings.configSessionsEnabled !== false;
  const [restoring, setRestoring] = React.useState(
    () => sessionsEnabled && hasConfigSessionCookie()
  );

  const isSignedIn = Boolean(uuid);

  const signOut = React.useCallback(
    (everywhere: boolean) => {
      // Must run while the uuid is known; the reset below only sees the
      // signed-out identity.
      clearDrafts(uuid);
      setUserData(null);
      setUuid(null);
      setPassword(null);
      setEncryptedPassword(null);
      const revoke = everywhere ? endAllConfigSessions() : endConfigSession();
      void revoke.catch(() => {
        /* the local state is already cleared; the row expires on its own */
      });
    },
    [uuid, setUserData, setUuid, setPassword, setEncryptedPassword]
  );

  const confirmSignOut = useConfirmationDialog({
    title: 'Sign Out',
    description: 'Are you sure you want to sign out?',
    onConfirm: () => signOut(signOutEverywhere),
  });

  const openSignIn = React.useCallback((uuidHint?: string) => {
    if (uuidHint) setInitialUuid(uuidHint);
    setSignInOpen(true);
  }, []);

  // Landing on a legacy /stremio/<uuid>/<password>/configure URL should offer
  // to sign into that config straight away.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const match = window.location.pathname.match(CONFIGURE_URL_UUID);
    if (match) openSignIn(match[1]);
  }, [openSignIn]);

  // Failure just means signed out.
  React.useEffect(() => {
    if (!restoring) return;
    let cancelled = false;
    loadConfigFromSession()
      .then((result) => {
        if (cancelled) return;
        setUserData(() => result.userData);
        setBaseline(result.userData);
        setUuid(result.userData.uuid ?? null);
        setEncryptedPassword(result.encryptedPassword);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restoring, setUserData, setBaseline, setUuid, setEncryptedPassword]);

  // confirmSignOut's identity changes every render, so read it through a ref
  // to keep the context value stable.
  const confirmSignOutRef = React.useRef(confirmSignOut);
  confirmSignOutRef.current = confirmSignOut;

  const openSignOut = React.useCallback(() => {
    confirmSignOutRef.current.open();
  }, []);

  const value = React.useMemo<ConfigAuthContextType>(
    () => ({
      isSignedIn,
      openSignIn,
      openSignOut,
      toggleSession: () => (isSignedIn ? openSignOut() : openSignIn()),
    }),
    [isSignedIn, openSignIn, openSignOut]
  );

  return (
    <ConfigAuthContext.Provider value={value}>
      {children}
      <ConfigModal
        open={signInOpen}
        onSuccess={() => {
          setSignInOpen(false);
          toast.success('Signed in successfully');
        }}
        onOpenChange={(v) => {
          if (!v) setSignInOpen(false);
        }}
        initialUuid={initialUuid}
      />
      <ConfirmationDialog
        {...confirmSignOut}
        description={
          <div className="space-y-4">
            <p>Are you sure you want to sign out?</p>
            {sessionsEnabled && (
              <div className="flex justify-center">
                <Checkbox
                  label="Sign out on all devices"
                  value={signOutEverywhere}
                  onValueChange={(v) => setSignOutEverywhere(v === true)}
                />
              </div>
            )}
          </div>
        }
      />
    </ConfigAuthContext.Provider>
  );
}
