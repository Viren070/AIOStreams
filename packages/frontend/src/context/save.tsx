'use client';

import React from 'react';
import { UserData } from '@aiostreams/core';
import { useUserData, DefaultUserData } from './userData';
import { useStatus } from './status';
import { useMenu } from './menu';
import {
  loadRawUserConfig,
  updateUserConfig,
  APIError,
  fetchManifest,
} from '@/lib/api';
import { computeUserDataDiff } from '../utils/diff/userData';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { AddonPasswordModal } from '@/components/shared/addon-password-modal';
import { UserDataDiffViewer } from '@/components/shared/userdata-diff-viewer';
import {
  ManifestDiffViewer,
  ManifestChangeSummary,
} from '@/components/shared/manifest-diff-viewer';
import {
  hasSevereManifestChanges,
  hasAnyManifestChanges,
} from '../utils/diff/manifest';
import { Switch } from '@/components/ui/switch';

interface SaveContextType {
  handleSave: (options?: {
    skipDiff?: boolean;
    authenticated?: boolean;
  }) => Promise<void>;
  loading: boolean;
}

const storageKeys = {
  allManifestChangesDismissed: (uuid: string) =>
    `aiostreams-manifest-all-dismissed-${uuid}`,
  insignificantManifestChangesDismissed: (uuid: string) =>
    `aiostreams-manifest-insignificant-dismissed-${uuid}`,
};

const SaveContext = React.createContext<SaveContextType | undefined>(undefined);

export function SaveProvider({ children }: { children: React.ReactNode }) {
  const { userData, setUserData, uuid, password, encryptedPassword } =
    useUserData();
  const { status } = useStatus();
  const { setSelectedMenu } = useMenu();

  const baseUrl =
    status?.settings?.baseUrl ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  const [loading, setLoading] = React.useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = React.useState(false);
  const [diffModalOpen, setDiffModalOpen] = React.useState(false);
  const [manifestChangedModalOpen, setManifestChangedModalOpen] =
    React.useState(false);
  const [dontShowManifestAgain, setDontShowManifestAgain] =
    React.useState(false);
  const [dontShowInsignificantAgain, setDontShowInsignificantAgain] =
    React.useState(false);
  const [manifestDiffModalOpen, setManifestDiffModalOpen] =
    React.useState(false);
  const [manifestHasSignificantChanges, setManifestHasSignificantChanges] =
    React.useState(false);

  const [remoteConfig, setRemoteConfig] = React.useState<UserData | null>(null);

  const [savedManifest, setSavedManifest] = React.useState<any>(null);
  const [pendingNewManifest, setPendingNewManifest] = React.useState<any>(null);
  const [preSaveManifest, setPreSaveManifest] = React.useState<any>(null);

  const pendingSkipDiffRef = React.useRef(false);

  // Manifest URL

  const uuidRegex =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  const manifestUrl =
    uuid && encryptedPassword
      ? uuidRegex.test(uuid)
        ? `${baseUrl}/stremio/${uuid}/${encryptedPassword}/manifest.json`
        : `${baseUrl}/stremio/u/${uuid}/manifest.json`
      : null;

  // fetch manifest on login
  React.useEffect(() => {
    if (!manifestUrl) {
      setSavedManifest(null);
      return;
    }
    fetchManifest(manifestUrl)
      .then(setSavedManifest)
      .catch((error) => {
        console.warn('Failed to fetch manifest:', error);
      });
  }, [uuid, encryptedPassword]);

  // Revert all

  const handleRevertAll = () => {
    if (remoteConfig) {
      setUserData((prev) => ({
        ...DefaultUserData,
        ...remoteConfig,
        uuid: (prev as any).uuid,
        encryptedPassword: (prev as any).encryptedPassword,
        trusted: (prev as any).trusted,
        addonPassword: prev.addonPassword,
        ip: (prev as any).ip,
        showChanges: prev.showChanges,
      }));
      toast.success('Changes reverted');
      setDiffModalOpen(false);
    }
  };

  // Manifest change check

  const savedManifestRef = React.useRef<any>(null);
  savedManifestRef.current = savedManifest;

  const checkManifestChange = React.useCallback(async () => {
    if (!manifestUrl || !uuid) return;
    try {
      const newManifest = await fetchManifest(manifestUrl);
      const dismissedKey = storageKeys.allManifestChangesDismissed(uuid);
      const dismissedManifestStr = localStorage.getItem(dismissedKey);

      const currentSavedManifest = savedManifestRef.current;

      const hasChanged =
        currentSavedManifest !== null &&
        hasAnyManifestChanges(currentSavedManifest, newManifest);

      const isDismissed = dismissedManifestStr === 'true';

      if (hasChanged && !isDismissed) {
        const severe = hasSevereManifestChanges(
          currentSavedManifest,
          newManifest
        );
        const insignificantKey =
          storageKeys.insignificantManifestChangesDismissed(uuid);
        const insignificantDismissed =
          localStorage.getItem(insignificantKey) === 'true';

        if (!severe && insignificantDismissed) {
          // Silently accept the insignificant change
          setSavedManifest(newManifest);
          return;
        }

        setManifestHasSignificantChanges(severe);
        setPendingNewManifest(newManifest);
        setDontShowManifestAgain(false);
        setDontShowInsignificantAgain(false);
        setManifestChangedModalOpen(true);
      } else {
        setSavedManifest(newManifest);
      }
    } catch {
      // not critical, ignore
    }
  }, [manifestUrl, uuid]);

  const handleSave = React.useCallback(
    async (options?: { skipDiff?: boolean; authenticated?: boolean }) => {
      const skipDiffHandler = options?.skipDiff ?? false;
      const authenticated = options?.authenticated ?? false;
      const shouldSkipDiff = skipDiffHandler || pendingSkipDiffRef.current;
      pendingSkipDiffRef.current = false;

      // navigate to save-install page if no uuid or password (should not happen since save button is hidden)
      if (!uuid || !password) {
        setSelectedMenu('save-install');
        toast.info('Please create a configuration first');
        return;
      }

      let suppressSuccessToast = false;

      // Instance password check
      if (
        status?.settings.protected &&
        !authenticated &&
        !userData.addonPassword
      ) {
        pendingSkipDiffRef.current = shouldSkipDiff;
        setPasswordModalOpen(true);
        return;
      }

      // Diff check
      if (!shouldSkipDiff && userData?.showChanges) {
        setLoading(true);
        try {
          const remoteData = await loadRawUserConfig(uuid, password);
          const remoteConf = remoteData.userData;

          const { diffs } = computeUserDataDiff(remoteConf, userData);

          if (diffs.length === 0) {
            toast.info('No changes detected');
            suppressSuccessToast = true;
            setLoading(false);
          } else {
            setRemoteConfig(remoteConf);
            if (authenticated) setPasswordModalOpen(false);
            setDiffModalOpen(true);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.error('Error checking for changes:', err);
          toast.warning('Error checking for changes. Proceeding with save.');
          setLoading(false);
        }
      }

      setLoading(true);
      try {
        await updateUserConfig(uuid, userData, password);
        if (!suppressSuccessToast) {
          toast.success('Configuration updated successfully');
        }
        if (authenticated) setPasswordModalOpen(false);

        // Capture pre-save manifest for the diff view, then check if it changed
        setPreSaveManifest(savedManifest);
        await checkManifestChange();
      } catch (err) {
        if (err instanceof APIError && err.is('ADDON_PASSWORD_INVALID')) {
          toast.error('Your addon password is incorrect');
          setUserData((prev) => ({ ...prev, addonPassword: '' }));
          setPasswordModalOpen(true);
          return;
        }
        toast.error(
          err instanceof Error ? err.message : 'Failed to save configuration'
        );
        if (authenticated) setPasswordModalOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [
      uuid,
      password,
      userData,
      status,
      checkManifestChange,
      setSelectedMenu,
      setUserData,
    ]
  );

  const handleManifestDismiss = () => {
    if (dontShowManifestAgain && uuid) {
      localStorage.setItem(
        storageKeys.allManifestChangesDismissed(uuid),
        'true'
      );
    }
    if (dontShowInsignificantAgain && uuid && !manifestHasSignificantChanges) {
      localStorage.setItem(
        storageKeys.insignificantManifestChangesDismissed(uuid),
        'true'
      );
    }
    setSavedManifest(pendingNewManifest);
    setManifestChangedModalOpen(false);
    setManifestDiffModalOpen(false);
    setTimeout(() => {
      setPendingNewManifest(null);
      setPreSaveManifest(null);
    }, 300);
  };

  return (
    <SaveContext.Provider value={{ handleSave, loading }}>
      {children}

      <AddonPasswordModal
        open={passwordModalOpen}
        onOpenChange={setPasswordModalOpen}
        loading={loading}
        onSubmit={() => handleSave({ authenticated: true })}
        submitText="Save"
        value={userData.addonPassword ?? ''}
        onValueChange={(value) =>
          setUserData((prev) => ({ ...prev, addonPassword: value }))
        }
      />

      <Modal
        open={diffModalOpen}
        onOpenChange={setDiffModalOpen}
        title="Confirm Changes"
        description="Review the changes you are about to make to your configuration."
        contentClass="max-w-4xl"
      >
        <div className="space-y-4">
          <UserDataDiffViewer oldConfig={remoteConfig} newConfig={userData} />
          <div className="flex justify-between pt-4">
            <Button intent="alert" onClick={handleRevertAll} disabled={loading}>
              Reset Changes
            </Button>
            <div className="flex gap-3">
              <Button
                intent="gray-outline"
                onClick={() => setDiffModalOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                intent="white"
                onClick={() => {
                  setDiffModalOpen(false);
                  handleSave({ skipDiff: true });
                }}
                loading={loading}
              >
                Confirm & Save
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={manifestChangedModalOpen}
        onOpenChange={(open) => {
          if (!open) handleManifestDismiss();
        }}
        title="Manifest Changed"
        description="Your addon manifest has changed since your last install."
        contentClass="max-w-xl"
      >
        <div className="space-y-4">
          {preSaveManifest && pendingNewManifest && (
            <ManifestChangeSummary
              oldManifest={preSaveManifest}
              newManifest={pendingNewManifest}
            />
          )}
          {preSaveManifest && pendingNewManifest && (
            <Button
              intent="primary"
              className="w-full text-sm"
              onClick={() => setManifestDiffModalOpen(true)}
            >
              See what changed →
            </Button>
          )}
          {!manifestHasSignificantChanges && (
            <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
              <div className="flex-1">
                <div className="text-sm font-medium text-white">
                  Don&apos;t show for insignificant changes
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Skip this notice when there are no significant manifest
                  changes
                </div>
              </div>
              <Switch
                id="dont-show-insignificant-again"
                value={dontShowInsignificantAgain}
                onValueChange={setDontShowInsignificantAgain}
              />
            </div>
          )}
          <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
            <div className="flex-1">
              <div className="text-sm font-medium text-white">
                Don&apos;t show this again
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Skip this notice for all future manifest changes
              </div>
            </div>
            <Switch
              id="dont-show-manifest-again"
              value={dontShowManifestAgain}
              onValueChange={setDontShowManifestAgain}
            />
          </div>
          <div className="flex justify-end">
            <Button intent="white" onClick={handleManifestDismiss}>
              OK
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={manifestDiffModalOpen}
        onOpenChange={setManifestDiffModalOpen}
        title="What Changed"
        description="Detailed diff of your manifest changes."
        contentClass="max-w-4xl"
      >
        {preSaveManifest && pendingNewManifest && (
          <ManifestDiffViewer
            oldManifest={preSaveManifest}
            newManifest={pendingNewManifest}
          />
        )}
      </Modal>
    </SaveContext.Provider>
  );
}

export function useSave() {
  const ctx = React.useContext(SaveContext);
  if (ctx === undefined) {
    throw new Error('useSave must be used within a SaveProvider');
  }
  return ctx;
}
