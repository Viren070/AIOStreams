import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Switch } from '@aiostreams/ui/switch';
import { Button } from '@aiostreams/ui/button';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { useSession } from '../../lib/session';
import { usePickableUsers } from '../../lib/queries';
import { configureUrl } from '../../lib/paths';
import { serverAddress } from '../../lib/servers';
import { settings, useSetting } from '../../lib/settings';
import { useServerInfo } from '../../lib/server-info';
import { UserAvatar } from '../../components/user-avatar';
import { SettingsCard, SettingsRow } from '../../components/settings-card';
import { onDevice } from './common';

export function AccountSection() {
  const { client, user, switchUser, signOut, changeServer } = useSession();
  const info = useServerInfo();
  const users = usePickableUsers();
  const avatar = users.data?.find((u) => u.user.Id === user.Id)?.avatar ?? null;
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
    </>
  );
}
