import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { SettingsCard } from '@/components/shared/settings-card';
import { useSession } from '@/context/session';
import { useUserData } from '@/context/userData';
import { configProfilesQuery } from '@/lib/queries';
import {
  saveConfigProfile,
  updateConfigProfile,
  deleteConfigProfile,
} from '@/lib/api';

/** Saving is explicit because it puts the config password on the server. */
export function ProfileCard() {
  const { user: sessionUser } = useSession();
  const { uuid, password } = useUserData();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    ...configProfilesQuery,
    enabled: Boolean(sessionUser),
  });
  const profile = data?.profiles.find((p) => p.uuid === uuid) ?? null;

  const [label, setLabel] = React.useState('');
  const [alias, setAlias] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setLabel(profile?.label ?? '');
    setAlias(profile?.alias ?? '');
  }, [profile?.id, profile?.label, profile?.alias]);

  if (!sessionUser || !uuid || !password) {
    return null;
  }

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({
        queryKey: configProfilesQuery.queryKey,
      });
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title="Profile"
      description={
        profile
          ? `Saved to ${sessionUser.username}. Pick it from Load Configuration to reopen it without the password.`
          : `Save this configuration to ${sessionUser.username} so you can reopen it without the password.`
      }
    >
      {!profile ? (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <TextInput
            label="Name"
            value={label}
            onValueChange={setLabel}
            placeholder="Optional"
            className="flex-1"
          />
          <Button
            intent="white"
            rounded
            loading={busy}
            onClick={() =>
              run(
                () =>
                  saveConfigProfile(uuid, password, label.trim() || undefined),
                'Saved to your profile'
              )
            }
          >
            Save as profile
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <TextInput
              label="Name"
              value={label}
              onValueChange={setLabel}
              className="flex-1"
            />
            <Button
              intent="gray-subtle"
              rounded
              loading={busy}
              disabled={!label.trim() || label.trim() === profile.label}
              onClick={() =>
                run(
                  () =>
                    updateConfigProfile(profile.id, { label: label.trim() }),
                  'Renamed'
                )
              }
            >
              Rename
            </Button>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <TextInput
                label="Share alias"
                value={alias}
                onValueChange={setAlias}
                placeholder="Optional, e.g. living-room"
                className="flex-1"
              />
              <Button
                intent="gray-subtle"
                rounded
                loading={busy}
                disabled={alias.trim().toLowerCase() === (profile.alias ?? '')}
                onClick={() =>
                  run(
                    () =>
                      updateConfigProfile(profile.id, {
                        alias: alias.trim() ? alias.trim() : null,
                      }),
                    alias.trim() ? 'Alias set' : 'Alias removed'
                  )
                }
              >
                {alias.trim() ? 'Set alias' : 'Clear alias'}
              </Button>
            </div>
            <p className="text-sm text-[--muted]">
              {profile.alias
                ? 'Your manifest URL above uses this alias. Anyone with it can install this configuration, so treat it like the long URL, and keep it hard to guess.'
                : 'An alias shortens your manifest URL above. It replaces the UUID and password in the link, so it grants the same access.'}
            </p>
          </div>

          <Button
            intent="alert-subtle"
            rounded
            size="sm"
            loading={busy}
            onClick={() =>
              run(
                () => deleteConfigProfile(profile.id),
                'Profile deleted. The configuration itself is untouched.'
              )
            }
          >
            Delete profile
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}
