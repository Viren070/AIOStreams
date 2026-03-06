'use client';

import React from 'react';
import { UserData } from '@aiostreams/core';
import { useUserData, DefaultUserData } from './userData';
import { useStatus } from './status';
import { useMenu } from './menu';
import {
  loadUserConfig,
  updateUserConfig,
  APIError,
  fetchManifest,
} from '@/lib/api';
import { getObjectDiff, DiffItem, sortKeys } from '@/utils/diff';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { AddonPasswordModal } from '@/components/shared/addon-password-modal';
import { DiffViewer } from '@/components/shared/diff-viewer';
import { Switch } from '@/components/ui/switch';
import { Alert } from '@/components/ui/alert';
import { error } from 'console';

interface SaveContextType {
  handleSave: (options?: {
    skipDiff?: boolean;
    authenticated?: boolean;
  }) => Promise<void>;
  loading: boolean;
}

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

  const [diffData, setDiffData] = React.useState<DiffItem[]>([]);
  const [remoteConfig, setRemoteConfig] = React.useState<UserData | null>(null);
  const [remoteDiffConfig, setRemoteDiffConfig] =
    React.useState<UserData | null>(null);
  const [localDiffConfig, setLocalDiffConfig] = React.useState<UserData | null>(
    null
  );

  const [savedManifest, setSavedManifest] = React.useState<any>(null);
  const [pendingNewManifest, setPendingNewManifest] = React.useState<any>(null);

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

  const resolveId = React.useCallback(
    (v: string) => {
      const findAddon = (presets?: UserData['presets']) =>
        presets?.find((p) => {
          if (p.instanceId === v) return true;
          const opts = p.options as Record<string, any>;
          return opts?.id === v;
        });
      const addon =
        findAddon(userData?.presets) || findAddon(remoteConfig?.presets);
      if (addon) {
        const opts = addon.options as Record<string, any>;
        if (opts?.name && typeof opts.name === 'string') return opts.name;
      }
      return v;
    },
    [userData?.presets, remoteConfig?.presets]
  );

  const valueFormatter = React.useCallback(
    (val: any): string => {
      const resolveDeep = (v: any): any => {
        if (typeof v === 'string') return resolveId(v);
        if (Array.isArray(v)) return v.map(resolveDeep);
        if (v && typeof v === 'object') {
          return Object.fromEntries(
            Object.entries(v).map(([k, value]) => [k, resolveDeep(value)])
          );
        }
        return v;
      };
      const resolved = resolveDeep(val);
      if (typeof resolved === 'object' && resolved !== null) {
        try {
          return JSON.stringify(resolved, null, 2);
        } catch {
          return '[Circular Reference]';
        }
      }
      return String(resolved);
    },
    [resolveId]
  );

  const resolveNamesInConfig = (
    conf: UserData | null,
    presetsSource: UserData['presets']
  ) => {
    if (!conf || !conf.groups) return conf;
    const newConf = { ...conf, groups: { ...conf.groups } };
    if (newConf.groups.groupings) {
      newConf.groups.groupings = newConf.groups.groupings.map((g: any) => {
        if (Array.isArray(g.addons)) {
          return {
            ...g,
            addons: g.addons.map((id: string) => {
              const find = (list?: any[]) =>
                list?.find((p) => p.instanceId === id || p.options?.id === id);
              const item = find(presetsSource);
              return item?.options?.name || id;
            }),
          };
        }
        return g;
      });
    }
    return newConf;
  };

  const filterForDiff = (d: UserData | null) => {
    if (!d) return d;
    const filtered: any = { ...d };
    delete filtered.ip;
    delete filtered.uuid;
    delete filtered.addonPassword;
    delete filtered.trusted;
    delete filtered.encryptedPassword;
    delete filtered.showChanges;
    return sortKeys(filtered) as UserData;
  };

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
      const dismissedKey = `aiostreams-manifest-dismissed-${uuid}`;
      const dismissedManifestStr = localStorage.getItem(dismissedKey);

      const currentSavedManifest = savedManifestRef.current;

      const hasChanged =
        currentSavedManifest !== null &&
        JSON.stringify(currentSavedManifest) !== JSON.stringify(newManifest);

      const isDismissed =
        dismissedManifestStr !== null &&
        dismissedManifestStr === JSON.stringify(newManifest);

      if (hasChanged && !isDismissed) {
        setPendingNewManifest(newManifest);
        setDontShowManifestAgain(false);
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
          const remoteData = await loadUserConfig(uuid, password);
          const remoteConf = remoteData.userData;

          const allPresets = [
            ...(userData?.presets || []),
            ...(remoteConf?.presets || []),
          ];

          const filteredRemote = filterForDiff(remoteConf);
          const filteredLocal = filterForDiff(userData);
          const processedRemote = resolveNamesInConfig(
            filteredRemote,
            allPresets
          );
          const processedLocal = resolveNamesInConfig(
            filteredLocal,
            allPresets
          );
          const diffs = getObjectDiff(processedRemote, processedLocal);

          if (diffs.length === 0) {
            toast.info('No changes detected');
            suppressSuccessToast = true;
            setLoading(false);
          } else {
            setRemoteConfig(remoteConf);
            setRemoteDiffConfig(processedRemote);
            setLocalDiffConfig(processedLocal);
            setDiffData(diffs);
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

        // Check if manifest changed after save
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
    if (dontShowManifestAgain && uuid && pendingNewManifest) {
      localStorage.setItem(
        `aiostreams-manifest-dismissed-${uuid}`,
        JSON.stringify(pendingNewManifest)
      );
    }
    setSavedManifest(pendingNewManifest);
    setPendingNewManifest(null);
    setManifestChangedModalOpen(false);
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
      >
        <div className="space-y-4">
          <DiffViewer
            diffs={diffData}
            valueFormatter={valueFormatter}
            oldValue={remoteDiffConfig}
            newValue={localDiffConfig}
          />
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
        description="The manifest of your configuration has changed. This will require a reinstall in Stremio (or your client) to take effect."
      >
        <div className="space-y-4">
          <Alert
            intent="warning"
            isClosable={false}
            description="Please re-install the addon in your client to apply the changes. Your current installation will continue to work, but certain changes will not take effect until you re-install with the new manifest. "
          />
          <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
            <div className="flex-1">
              <div className="text-sm font-medium text-white">
                Don&apos;t show this again
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Skip this notice for future manifest changes
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
