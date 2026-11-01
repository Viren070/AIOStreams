import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiPlay } from 'react-icons/bi';
import { Alert } from '@aiostreams/ui/alert';
import { Button } from '@aiostreams/ui/button';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '../lib/session';
import { useFeature, useServerInfo } from '../lib/server-info';
import { configureUrl } from '../lib/paths';
import { ticksToMs } from '../lib/format';
import { useVersionPicker } from './version-picker';
import type { BaseItemDto } from '../lib/types';

export function NoDetails({
  item,
  refreshing,
  onRefresh,
}: {
  item: BaseItemDto;
  refreshing: boolean;
  onRefresh(): void;
}) {
  const { client } = useSession();
  const configure = configureUrl(client.base, useServerInfo());
  const configTip = useFeature('configSignIn');
  const picker = useVersionPicker();
  const id = item.Name ?? '';
  const movie = item.Type === 'Movie';
  const button = 'rounded-full';

  return (
    <div data-ui="no-details">
      <LuffyError title={t`No details for this title`} className="mt-0">
        <p className="text-sm text-[--muted]">
          {configure
            ? t`None of your addons has details for ${id}. Add a metadata addon to your configuration, then refresh.`
            : t`This server has no details for ${id}.`}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {movie && (
            <Button
              intent="white"
              className={button}
              leftIcon={<BiPlay className="text-xl" />}
              onClick={() =>
                picker.play(item, {
                  startMs: ticksToMs(item.UserData?.PlaybackPositionTicks),
                })
              }
            >
              <Trans>Play</Trans>
            </Button>
          )}
          {configure && (
            <Button
              intent={movie ? 'gray-subtle' : 'white'}
              className={button}
              onClick={() => window.open(configure, '_blank')}
            >
              <Trans>Configure</Trans>
            </Button>
          )}
          <Button
            intent="gray-subtle"
            className={button}
            loading={refreshing}
            onClick={onRefresh}
          >
            <Trans>Refresh</Trans>
          </Button>
        </div>
        {configure && configTip && (
          <Alert
            data-ui="no-details-tip"
            intent="info-basic"
            className="mx-auto mt-6 max-w-md text-start"
            description={t`Install a metadata addon from Addons → Marketplace. For one that isn't listed, use the Custom addon there.`}
          />
        )}
      </LuffyError>
    </div>
  );
}
