import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Alert } from '@aiostreams/ui/alert';
import { Button } from '@aiostreams/ui/button';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '../lib/session';
import { usePickableUsers, useViews } from '../lib/queries';
import { useFeature, useServerInfo } from '../lib/server-info';
import { configureUrl } from '../lib/paths';

export function NoCatalogs() {
  const { client, switchUser, changeServer } = useSession();
  const configure = configureUrl(client.base, useServerInfo());
  const configTip = useFeature('configSignIn');
  const views = useViews();
  const users = usePickableUsers();
  const several = (users.data?.length ?? 0) > 1;
  const button = 'rounded-full';

  return (
    <LuffyError title={t`No catalogs yet`} className="mt-0">
      <p className="text-sm text-[--muted]">
        {configure
          ? t`Add catalogs to your configuration, then refresh.`
          : t`This server shares no movie or show catalogs with this account.`}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {configure && (
          <Button
            intent="white"
            className={button}
            onClick={() => window.open(configure, '_blank')}
          >
            <Trans>Configure</Trans>
          </Button>
        )}
        <Button
          intent="gray-subtle"
          className={button}
          loading={views.isFetching}
          onClick={() => void views.refetch()}
        >
          <Trans>Refresh</Trans>
        </Button>
        {several && (
          <Button intent="gray-subtle" className={button} onClick={switchUser}>
            <Trans>Switch user</Trans>
          </Button>
        )}
        {changeServer && (
          <Button
            intent="gray-subtle"
            className={button}
            onClick={changeServer}
          >
            <Trans>Change server</Trans>
          </Button>
        )}
      </div>
      {configure && configTip && (
        <Alert
          data-ui="no-catalogs-tip"
          intent="info-basic"
          className="mx-auto mt-6 max-w-md text-start"
          description={t`Install catalog addons from Addons → Marketplace. For one that isn't listed, use the Custom addon there.`}
        />
      )}
    </LuffyError>
  );
}
