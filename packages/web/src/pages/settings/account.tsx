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
import { ON_DEVICE } from './common';

export function AccountSection() {
  const { client, user, switchUser, signOut, changeServer } = useSession();
  const info = useServerInfo();
  const users = usePickableUsers();
  const avatar = users.data?.find((u) => u.user.Id === user.Id)?.avatar ?? null;
  const several = (users.data?.length ?? 0) > 1;
  const [askWho, setAskWho] = useSetting(settings.account.askWho);
  const configure = configureUrl(client.base, info);
  const confirmSignOut = useConfirmationDialog({
    title: 'Sign out',
    description: __STANDALONE__
      ? 'Sign out of this server?'
      : 'Sign out of this browser?',
    actionText: 'Sign out',
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
            Sign out
          </Button>
        </SettingsRow>
        {several && (
          <SettingsRow
            label="Switch user"
            help="Watch as someone else on this configuration. A user with a PIN needs it again after switching away."
          >
            <Button
              intent="gray-outline"
              className={button}
              onClick={switchUser}
            >
              Switch
            </Button>
          </SettingsRow>
        )}
        {changeServer && (
          <SettingsRow label="Server" help={serverAddress(client.base)}>
            <Button
              intent="gray-outline"
              className={button}
              onClick={changeServer}
            >
              Change server
            </Button>
          </SettingsRow>
        )}
        {configure && (
          <SettingsRow
            label="Configuration"
            help="Addons, catalogs and users are set up on the configuration page."
          >
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => window.open(configure, '_blank')}
            >
              Open
            </Button>
          </SettingsRow>
        )}
      </SettingsCard>
      {several && (
        <SettingsCard title="Who's watching" description={ON_DEVICE}>
          <Switch
            side="right"
            label="Ask when the app opens"
            help="Also when you come back to it after half an hour. Whoever was watching carries on without their PIN."
            value={askWho}
            onValueChange={setAskWho}
          />
        </SettingsCard>
      )}
      <ConfirmationDialog {...confirmSignOut} />
    </>
  );
}
