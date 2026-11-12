import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Switch } from '@aiostreams/ui/switch';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { useSession } from '@/lib/jellyfin/session';
import { useOwnAvatar, usePickableUsers } from '@/lib/jellyfin/history';
import { configureUrl } from '@/lib/paths';
import { serverAddress } from '@/lib/jellyfin/servers';
import { settings, useSetting } from '@/lib/settings';
import { useServerInfo } from '@/lib/jellyfin/server-info';
import { UserAvatar } from '@/components/user-avatar';
import { SettingsCard, SettingsRow } from './_components/settings-card';
import { onDevice } from './_components/common';

export function AccountSection() {
  const { client, user, switchUser, signOut, changeServer } = useSession();
  const info = useServerInfo();
  const users = usePickableUsers();
  const avatar = useOwnAvatar();
  const several = (users.data?.length ?? 0) > 1;
  const [askWho, setAskWho] = useSetting(settings.account.askWho);
  const configure = configureUrl(client.base, info);
  const confirmSignOut = useConfirmationDialog({
    title: t`Sign out`,
    description: __STANDALONE__
      ? t`Sign out of this server?`
      : t`Sign out of this browser?`,
    actionText: t`Sign out`,
    onConfirm: signOut,
  });
  const button = 'w-full rounded-full sm:w-auto';
  const quickConnect = useQuery({
    queryKey: ['jf-quick-connect-enabled', client.base],
    queryFn: () =>
      client.get<boolean>('/QuickConnect/Enabled').catch(() => false),
    staleTime: 5 * 60_000,
  });
  const [approving, setApproving] = React.useState(false);

  return (
    <>
      <SettingsCard>
        <SettingsRow
          label={
            <span className="flex items-center gap-3">
              <UserAvatar name={user.Name} src={avatar} className="size-10" />
              <span>
                <span className="block text-base">{user.Name}</span>
                <span className="block font-normal text-[--muted]">
                  {info.name ?? serverAddress(client.base)}
                </span>
              </span>
            </span>
          }
        >
          <Button
            intent="gray-outline"
            className={button}
            onClick={() => confirmSignOut.open()}
          >
            <Trans>Sign out</Trans>
          </Button>
        </SettingsRow>
        {several && (
          <SettingsRow
            label={t`Switch user`}
            help={t`Watch as someone else on this configuration. A user with a PIN needs it again after switching away.`}
          >
            <Button
              intent="gray-outline"
              className={button}
              onClick={switchUser}
            >
              <Trans>Switch</Trans>
            </Button>
          </SettingsRow>
        )}
        {changeServer && (
          <SettingsRow label={t`Server`} help={serverAddress(client.base)}>
            <Button
              intent="gray-outline"
              className={button}
              onClick={changeServer}
            >
              <Trans>Change server</Trans>
            </Button>
          </SettingsRow>
        )}
        {quickConnect.data && (
          <SettingsRow
            label={t`Quick Connect`}
            help={t`Sign another device in as you, with the code it shows.`}
          >
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => setApproving(true)}
            >
              <Trans>Enter a code</Trans>
            </Button>
          </SettingsRow>
        )}
        {configure && (
          <SettingsRow
            label={t`Configuration`}
            help={t`Addons, catalogs and users are set up on the configuration page.`}
          >
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => window.open(configure, '_blank')}
            >
              <Trans>Open</Trans>
            </Button>
          </SettingsRow>
        )}
      </SettingsCard>
      {several && (
        <SettingsCard
          name="who-s-watching"
          title={t`Who's watching`}
          description={onDevice()}
        >
          <Switch
            side="right"
            label={t`Ask when the app opens`}
            help={t`Also when you come back to it after half an hour. Whoever was watching carries on without their PIN.`}
            value={askWho}
            onValueChange={setAskWho}
          />
        </SettingsCard>
      )}
      <ConfirmationDialog {...confirmSignOut} />
      <QuickConnectDialog
        open={approving}
        onClose={() => setApproving(false)}
      />
    </>
  );
}

function QuickConnectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const { client } = useSession();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setCode('');
    setError(null);
  }, [open]);
  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // A code no device is waiting with is false, or not found.
    const approved = await client
      .post<boolean>('/QuickConnect/Authorize', undefined, { code })
      .catch(() => false);
    setBusy(false);
    if (!approved) return setError(t`No device is waiting with that code.`);
    toast.success(t`The device is signed in`);
    onClose();
  };
  return (
    <Modal
      data-ui="dialog"
      data-name="quick-connect"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t`Quick Connect`}
      description={t`Enter the code the other device shows.`}
    >
      <form onSubmit={approve} className="space-y-4">
        <TextInput
          label={t`Code`}
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={code}
          onValueChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          error={error ?? undefined}
        />
        <Button
          type="submit"
          intent="white"
          className="w-full rounded-full"
          loading={busy}
          disabled={code.length < 6}
        >
          <Trans>Approve</Trans>
        </Button>
      </form>
    </Modal>
  );
}
