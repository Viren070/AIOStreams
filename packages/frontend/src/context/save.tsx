import React from 'react';
import { UserData } from '@aiostreams/core';
import { useUserData, DefaultUserData } from './userData';
import { useStatus } from './status';
import { useMenu } from './menu';
import {
  loadRawUserConfig,
  updateUserConfig,
  fetchManifest,
  pushAllLinkedAccounts,
  type LinkedAccountPushAllResult,
} from '@/lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { linkedAccountsQuery, LINKED_ACCOUNTS_QUERY_ROOT } from '@/lib/queries';
import { manifestFingerprint } from '../../../core/src/utils/manifest-fingerprint';
import { computeUserDataDiff } from '../utils/diff/userData';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
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
  /** Fingerprint of the manifest as it is served right now. */
  currentManifestFingerprint: string | null;
  /** The URL that fingerprint was taken from. */
  currentManifestUrl: string | null;
}

type ManifestNotice = NonNullable<UserData['manifestNotice']>;

/**
 * These two booleans used to be the whole setting, per browser. They are still
 * read so an existing choice carries over, but nothing writes them any more:
 * the preference now lives in the configuration and follows the user.
 */
function legacyManifestNotice(uuid: string): ManifestNotice {
  if (typeof window === 'undefined') return 'always';
  if (
    localStorage.getItem(`aiostreams-manifest-all-dismissed-${uuid}`) === 'true'
  ) {
    return 'never';
  }
  if (
    localStorage.getItem(
      `aiostreams-manifest-insignificant-dismissed-${uuid}`
    ) === 'true'
  ) {
    return 'significant';
  }
  return 'always';
}

/**
 * Pushes every destination the user opted in, reporting failures as toasts.
 * Never throws: a failed push must not block or undo a successful save.
 */
async function runAutoPush(
  uuid: string,
  password: string | null
): Promise<LinkedAccountPushAllResult[] | null> {
  try {
    const results = await pushAllLinkedAccounts({ uuid, password });
    for (const result of results.filter((entry) => !entry.ok)) {
      toast.error(`Could not push to ${result.label}: ${result.error ?? ''}`);
    }
    return results;
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : 'Could not push your changes'
    );
    return null;
  }
}

const SaveContext = React.createContext<SaveContextType | undefined>(undefined);

export function SaveProvider({ children }: { children: React.ReactNode }) {
  const {
    userData,
    setUserData,
    uuid,
    password,
    encryptedPassword,
    setBaseline,
  } = useUserData();
  const { status } = useStatus();
  const { setSelectedMenu } = useMenu();

  const baseUrl =
    status?.settings?.baseUrl ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  const [loading, setLoading] = React.useState(false);
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

  const [pushResults, setPushResults] = React.useState<
    LinkedAccountPushAllResult[] | null
  >(null);
  const [alwaysPush, setAlwaysPush] = React.useState(false);
  const [pushing, setPushing] = React.useState(false);

  const pushBehaviour = userData.linkedAccounts?.pushBehaviour ?? 'ask';
  const manifestNotice: ManifestNotice =
    userData.manifestNotice ?? (uuid ? legacyManifestNotice(uuid) : 'always');

  const [savedManifest, setSavedManifest] = React.useState<any>(null);
  const currentManifestFingerprint = React.useMemo(
    () => (savedManifest ? manifestFingerprint(savedManifest) : null),
    [savedManifest]
  );
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

  const queryClient = useQueryClient();
  const credentials = uuid ? { uuid, password } : null;
  const { data: linkedAccountsData } = useQuery(
    linkedAccountsQuery(credentials)
  );
  const linkedAccounts = linkedAccountsData ?? [];

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
        accessKey: prev.accessKey,
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
      const currentSavedManifest = savedManifestRef.current;

      const hasChanged =
        currentSavedManifest !== null &&
        hasAnyManifestChanges(currentSavedManifest, newManifest);

      // Runs before the notice is considered, so an automatic push still
      // happens for someone who dismissed the notice permanently.
      if (hasChanged && pushBehaviour === 'auto') {
        const results = await runAutoPush(uuid, password);
        void queryClient.invalidateQueries({
          queryKey: LINKED_ACCOUNTS_QUERY_ROOT,
        });
        if (results?.some((result) => result.ok)) {
          const ok = results.filter((result) => result.ok).length;
          toast.success(
            `Pushed to ${ok} linked ${ok === 1 ? 'account' : 'accounts'}`
          );
        }
        // The push already happened, so the diff is not worth interrupting for.
        setSavedManifest(newManifest);
        return;
      }
      setPushResults(null);

      if (hasChanged && manifestNotice !== 'never') {
        const severe = hasSevereManifestChanges(
          currentSavedManifest,
          newManifest
        );

        if (!severe && manifestNotice === 'significant') {
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
  }, [manifestUrl, uuid, password, pushBehaviour, manifestNotice, queryClient]);

  const handleSave = React.useCallback(
    async (options?: { skipDiff?: boolean }) => {
      const skipDiffHandler = options?.skipDiff ?? false;
      const shouldSkipDiff = skipDiffHandler || pendingSkipDiffRef.current;
      pendingSkipDiffRef.current = false;

      // navigate to save-install page if no uuid or password (should not happen since save button is hidden)
      if (!uuid) {
        setSelectedMenu('save-install');
        toast.info('Please create a configuration first');
        return;
      }

      let suppressSuccessToast = false;

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
        setBaseline(userData);
        if (!suppressSuccessToast) {
          toast.success('Configuration updated successfully');
        }

        // Capture pre-save manifest for the diff view, then check if it changed
        setPreSaveManifest(savedManifest);
        await checkManifestChange();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to save configuration'
        );
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
      setBaseline,
    ]
  );

  const handleManifestDismiss = () => {
    const notice: UserData['manifestNotice'] | undefined = dontShowManifestAgain
      ? 'never'
      : dontShowInsignificantAgain && !manifestHasSignificantChanges
        ? 'significant'
        : undefined;
    const changed = notice !== undefined || alwaysPush;
    const next: UserData = {
      ...userData,
      ...(notice ? { manifestNotice: notice } : {}),
      ...(alwaysPush
        ? {
            linkedAccounts: {
              ...userData.linkedAccounts,
              pushBehaviour: 'auto' as const,
            },
          }
        : {}),
    };

    // The notice only appears straight after a successful save, so there are
    // no unsaved edits for this extra write to pick up.
    if (changed && uuid) {
      setUserData(() => next);
      updateUserConfig(uuid, next, password).catch(() =>
        toast.warning('Could not remember that preference')
      );
    }
    setAlwaysPush(false);
    setPushResults(null);
    setSavedManifest(pendingNewManifest);
    setManifestChangedModalOpen(false);
    setManifestDiffModalOpen(false);
    setTimeout(() => {
      setPendingNewManifest(null);
      setPreSaveManifest(null);
    }, 300);
  };

  return (
    <SaveContext.Provider
      value={{
        handleSave,
        loading,
        currentManifestFingerprint,
        currentManifestUrl: manifestUrl,
      }}
    >
      {children}

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
          {pushResults !== null && (
            <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
              <div className="flex-1">
                <div className="text-sm font-medium text-white">
                  {pushResults.every((result) => result.ok)
                    ? `Pushed to ${pushResults.length} linked ${
                        pushResults.length === 1 ? 'account' : 'accounts'
                      }`
                    : `Pushed to ${pushResults.filter((r) => r.ok).length} of ${pushResults.length} linked accounts`}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {pushResults.every((result) => result.ok)
                    ? 'They are now up to date with this change'
                    : 'Open the install page to see what failed'}
                </div>
              </div>
            </div>
          )}

          {pushResults === null &&
            pushBehaviour === 'ask' &&
            linkedAccounts.length > 0 && (
              <>
                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <div className="flex-1 pr-3">
                    <div className="text-sm font-medium text-white">
                      Push to your linked{' '}
                      {linkedAccounts.length === 1
                        ? linkedAccounts[0].label
                        : `${linkedAccounts.length} accounts`}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Send this change now so they pick it up without a
                      reinstall
                    </div>
                  </div>
                  <Button
                    intent="primary"
                    loading={pushing}
                    onClick={async () => {
                      if (!uuid) return;
                      setPushing(true);
                      setPushResults(await runAutoPush(uuid, password));
                      void queryClient.invalidateQueries({
                        queryKey: LINKED_ACCOUNTS_QUERY_ROOT,
                      });
                      setPushing(false);
                    }}
                  >
                    Push now
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-white">
                      Push automatically when a reinstall is needed
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Whenever a save changes your manifest, push it without
                      asking
                    </div>
                  </div>
                  <Switch
                    id="always-push-linked-accounts"
                    value={alwaysPush}
                    onValueChange={setAlwaysPush}
                  />
                </div>
              </>
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
