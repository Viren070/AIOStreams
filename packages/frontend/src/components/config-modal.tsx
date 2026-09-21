import React from 'react';
import { Modal } from '@/components/ui/modal';
import { TextInput } from '@/components/ui/text-input';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import {
  loadRawUserConfig,
  openConfigProfile,
  saveConfigProfile,
  deleteConfigProfile,
  createConfigSession,
  APIError,
  type ConfigProfile,
} from '@/lib/api';
import { useStatus } from '@/context/status';
import { configProfilesQuery } from '@/lib/queries';
import { useUserData } from '@/context/userData';
import { useSession } from '@/context/session';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BiTrash, BiLinkExternal } from 'react-icons/bi';
import { PasswordInput } from './ui/password-input';

interface ConfigModalProps {
  open: boolean;
  onSuccess: () => void;
  onOpenChange: (v: boolean) => void;
  initialUuid?: string;
}

export function ConfigModal({
  open,
  onSuccess,
  onOpenChange,
  initialUuid,
}: ConfigModalProps) {
  const {
    setUserData,
    setUuid,
    setPassword,
    setEncryptedPassword,
    setBaseline,
  } = useUserData();
  const { user: sessionUser } = useSession();
  const { status } = useStatus();
  const sessionsEnabled = status?.settings.configSessionsEnabled !== false;
  const queryClient = useQueryClient();
  const [uuid, setUuidInput] = React.useState(initialUuid || '');
  const [password, setPasswordInput] = React.useState('');
  const [saveToAccount, setSaveToAccount] = React.useState(false);
  const [staySignedIn, setStaySignedIn] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [busyProfileId, setBusyProfileId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    React.useState<ConfigProfile | null>(null);
  const [showManualForm, setShowManualForm] = React.useState(false);
  // handleOpenProfile is an effect dependency; a changing identity re-fires it.
  const staySignedInRef = React.useRef(staySignedIn);
  staySignedInRef.current = staySignedIn;
  const passwordRef = React.useRef<HTMLInputElement>(null);

  const { data: profileData, isLoading: profilesLoading } = useQuery({
    ...configProfilesQuery,
    enabled: open && Boolean(sessionUser),
  });
  const profiles = profileData?.profiles ?? [];
  const hasProfiles = profiles.length > 0;

  const applyConfig = React.useCallback(
    async (loadUuid: string, loadPassword: string, remember = false) => {
      const result = await loadRawUserConfig(loadUuid, loadPassword);
      setUserData(() => result.userData);
      setBaseline(result.userData);
      setUuid(loadUuid);
      setPassword(loadPassword);
      setEncryptedPassword(result.encryptedPassword);

      if (sessionsEnabled) {
        // The configuration is already open, so this failing is not a failed sign in.
        try {
          await createConfigSession(loadUuid, loadPassword, remember);
        } catch {
          /* ignored */
        }
      }
      onSuccess();
    },
    [
      sessionsEnabled,
      setUserData,
      setBaseline,
      setUuid,
      setPassword,
      setEncryptedPassword,
      onSuccess,
    ]
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    try {
      await applyConfig(uuid, password, staySignedIn);
      if (saveToAccount && sessionUser) {
        try {
          await saveConfigProfile(uuid, password, label.trim() || undefined);
          queryClient.invalidateQueries({
            queryKey: configProfilesQuery.queryKey,
          });
        } catch (err) {
          // The configuration did load, so this is not a failed sign-in.
          toast.error(
            err instanceof Error
              ? `Loaded, but not saved: ${err.message}`
              : 'Loaded, but could not be saved as a profile'
          );
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load configuration'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOpenProfile = React.useCallback(
    async (profile: ConfigProfile) => {
      setBusyProfileId(profile.id);
      try {
        const creds = await openConfigProfile(profile.id);
        await applyConfig(creds.uuid, creds.password, staySignedInRef.current);
      } catch (err) {
        if (err instanceof APIError) {
          // A stale saved password: prefill the manual form so it can be fixed
          // in place rather than removed and re-added.
          setUuidInput(profile.uuid);
          setShowManualForm(true);
          queryClient.invalidateQueries({
            queryKey: configProfilesQuery.queryKey,
          });
        }
        toast.error(
          err instanceof Error ? err.message : 'Failed to open configuration'
        );
      } finally {
        setBusyProfileId(null);
      }
    },
    [applyConfig, queryClient]
  );

  // Nothing to ask for when the uuid in the URL is already a profile.
  const matchingProfile = initialUuid
    ? profiles.find((p) => p.uuid === initialUuid && !p.needsRelink)
    : undefined;
  const autoOpened = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open || !matchingProfile) return;
    if (autoOpened.current === matchingProfile.id) return;
    autoOpened.current = matchingProfile.id;
    void handleOpenProfile(matchingProfile);
  }, [open, matchingProfile, handleOpenProfile]);

  const handleDelete = async (profile: ConfigProfile) => {
    setDeletingId(profile.id);
    try {
      await deleteConfigProfile(profile.id);
      queryClient.invalidateQueries({
        queryKey: configProfilesQuery.queryKey,
      });
      toast.success(`Deleted profile "${profile.label}"`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete profile'
      );
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  };

  // Reset form when modal opens/closes
  React.useEffect(() => {
    if (!open) {
      setPasswordInput('');
      setSaveToAccount(false);
      setStaySignedIn(false);
      setLabel('');
      setShowManualForm(false);
      setPendingDelete(null);
      autoOpened.current = null;
    }
  }, [open]);

  // Handle initialUuid changes
  React.useEffect(() => {
    if (initialUuid) {
      setUuidInput(initialUuid);
    } else {
      setUuidInput('');
    }
  }, [initialUuid]);

  const handleCancel = () => {
    onOpenChange(false);
  };

  // Held back until the list arrives, so a saved configuration does not flash
  // a password prompt on its way to opening itself.
  const manualFormVisible =
    !profilesLoading &&
    (showManualForm || (!!initialUuid && !matchingProfile) || !hasProfiles);

  const staySignedInField = sessionsEnabled ? (
    <Checkbox
      label="Stay signed in on this device"
      value={staySignedIn}
      onValueChange={(v) => setStaySignedIn(v === true)}
    />
  ) : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Load Configuration"
      onOpenAutoFocus={
        initialUuid
          ? (e) => {
              e.preventDefault();
              passwordRef.current?.focus();
            }
          : undefined
      }
    >
      <div className="space-y-4">
        {sessionUser && profilesLoading && (
          <div className="flex justify-center py-2">
            <LoadingSpinner />
          </div>
        )}

        {hasProfiles && (
          <div className="space-y-2">
            <p className="text-sm text-[--muted]">
              Your profiles
              {sessionUser ? ` (${sessionUser.username})` : ''}
            </p>
            <ul className="space-y-1">
              {profiles.map((profile) =>
                pendingDelete?.id === profile.id ? (
                  <li
                    key={profile.id}
                    className="flex flex-wrap items-center gap-2 rounded-[--radius] border border-[--border] px-3 py-2"
                  >
                    <span className="flex-1 min-w-0 text-sm">
                      Delete <b>{profile.label}</b>? The configuration itself is
                      kept.
                    </span>
                    <Button
                      type="button"
                      intent="alert-subtle"
                      size="sm"
                      loading={deletingId === profile.id}
                      onClick={() => handleDelete(profile)}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      intent="gray-subtle"
                      size="sm"
                      disabled={deletingId !== null}
                      onClick={() => setPendingDelete(null)}
                    >
                      Cancel
                    </Button>
                  </li>
                ) : (
                  <li key={profile.id} className="flex items-center gap-2">
                    <Button
                      type="button"
                      intent="gray-subtle"
                      className="flex-1 justify-start min-w-0"
                      loading={busyProfileId === profile.id}
                      disabled={busyProfileId !== null}
                      onClick={() => handleOpenProfile(profile)}
                    >
                      <span className="truncate">{profile.label}</span>
                      {profile.alias && (
                        <span className="ml-2 text-xs text-[--muted] truncate">
                          /u/{profile.alias}
                        </span>
                      )}
                      {profile.needsRelink && (
                        <span className="ml-2 text-xs text-[--red]">
                          needs password
                        </span>
                      )}
                    </Button>
                    <IconButton
                      type="button"
                      icon={<BiTrash />}
                      intent="alert-subtle"
                      size="sm"
                      disabled={busyProfileId !== null || deletingId !== null}
                      aria-label={`Delete profile ${profile.label}`}
                      onClick={() => setPendingDelete(profile)}
                    />
                  </li>
                )
              )}
            </ul>
            {!manualFormVisible && (
              <Button
                type="button"
                intent="white-link"
                size="sm"
                leftIcon={<BiLinkExternal />}
                onClick={() => setShowManualForm(true)}
              >
                Use a UUID and password
              </Button>
            )}
            {!manualFormVisible && staySignedInField}
          </div>
        )}

        {manualFormVisible && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <TextInput
              label="UUID"
              id="uuid"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={uuid}
              onValueChange={(value) => setUuidInput(value)}
              placeholder="Enter your configuration UUID"
              required
              readOnly={!!initialUuid}
              className={initialUuid ? 'opacity-50' : undefined}
            />
            <PasswordInput
              ref={passwordRef}
              label="Password"
              id="password"
              name="password"
              value={password}
              onValueChange={(value) => setPasswordInput(value)}
              placeholder="Enter your configuration password"
              required
            />
            {sessionUser && (
              <div className="space-y-2">
                <Checkbox
                  label="Save as a profile"
                  value={saveToAccount}
                  onValueChange={(v) => setSaveToAccount(v === true)}
                />
                {saveToAccount && (
                  <TextInput
                    label="Name"
                    value={label}
                    onValueChange={setLabel}
                    placeholder="Optional, defaults to the start of the UUID"
                  />
                )}
              </div>
            )}
            {staySignedInField}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                Load
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
