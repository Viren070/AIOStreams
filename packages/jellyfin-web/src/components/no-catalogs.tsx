import { Alert } from '@aiostreams/ui/alert';
import { Button } from '@aiostreams/ui/button';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '../lib/session';
import { usePickableUsers, useViews } from '../lib/queries';
import { useServerInfo } from '../lib/server-info';
import { configureUrl } from '../lib/paths';

export function NoCatalogs() {
  const { client, switchUser, changeServer } = useSession();
  const configure = configureUrl(client.base, useServerInfo());
  const views = useViews();
  const users = usePickableUsers();
  const several = (users.data?.length ?? 0) > 1;
  const button = 'rounded-full';

  return (
    <LuffyError title="No catalogs yet" className="mt-0">
      <p className="text-sm text-[--muted]">
        {configure
          ? 'Add catalogs to your configuration, then refresh.'
          : 'This server shares no movie or show catalogs with this account.'}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {configure && (
          <Button
            intent="white"
            className={button}
            onClick={() => window.open(configure, '_blank')}
          >
            Configure
          </Button>
        )}
        <Button
          intent="gray-subtle"
          className={button}
          loading={views.isFetching}
          onClick={() => void views.refetch()}
        >
          Refresh
        </Button>
        {several && (
          <Button intent="gray-subtle" className={button} onClick={switchUser}>
            Switch user
          </Button>
        )}
        {changeServer && (
          <Button
            intent="gray-subtle"
            className={button}
            onClick={changeServer}
          >
            Change server
          </Button>
        )}
      </div>
      {configure && (
        <Alert
          data-ui="no-catalogs-tip"
          intent="info-basic"
          className="mx-auto mt-6 max-w-md text-left"
          description="Add a catalog addon from the Marketplace, or any addon with Custom."
        />
      )}
    </LuffyError>
  );
}
