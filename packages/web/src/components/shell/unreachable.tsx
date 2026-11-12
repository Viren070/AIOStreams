import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiLoaderAlt, BiWifiOff, BiX } from 'react-icons/bi';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { cn } from '@aiostreams/ui/core/styling';
import { navigate, to } from '@/lib/paths';
import { retryNow, useReachable } from '@/lib/jellyfin/connection';
import { useDownloadList } from '@/lib/downloads';
import { settings, useSetting } from '@/lib/settings';

/** While the server can't be reached, a note that it keeps trying; dismissed, it shrinks to an icon. */
export function ConnectionNote() {
  // Mounted per outage, so the next one shows the full note again.
  return useReachable() ? null : <Unreachable />;
}

const NOTE_PLACE =
  'fixed bottom-[max(1rem,calc(var(--nav-bar)+var(--mini-bar,0px)+0.5rem))] end-4 z-[100] border border-white/10 bg-gray-950/90 shadow-lg backdrop-blur';

function Unreachable() {
  const [saved] = useSetting(settings.cache.enabled);
  const [small, setSmall] = React.useState(false);
  const downloaded = useDownloadList().some((d) => d.state === 'done');
  if (small) {
    return (
      <Tooltip
        trigger={
          <button
            type="button"
            data-ui="connection-note"
            data-state="small"
            aria-label={t`Can't reach the server`}
            onClick={() => {
              setSmall(false);
              retryNow();
            }}
            className={cn(
              NOTE_PLACE,
              'flex size-9 items-center justify-center rounded-full text-base text-[--muted] transition-colors hover:text-white'
            )}
          >
            <BiWifiOff />
          </button>
        }
      >
        <Trans>Can't reach the server</Trans>
      </Tooltip>
    );
  }
  return (
    <div
      data-ui="connection-note"
      className={cn(
        NOTE_PLACE,
        'flex items-center rounded-xl text-sm duration-300 animate-in fade-in-0 slide-in-from-right-4 rtl:slide-in-from-left-4'
      )}
    >
      <button
        type="button"
        onClick={retryNow}
        className="flex items-center gap-2.5 py-2 ps-4 pe-2 text-start"
      >
        <BiLoaderAlt className="flex-none animate-spin text-base text-[--muted]" />
        <span>
          <span className="block font-semibold">
            <Trans>Reconnecting…</Trans>
          </span>
          {saved && (
            <span className="block text-xs text-[--muted]">
              <Trans>Showing saved pages</Trans>
            </span>
          )}
        </span>
      </button>
      {downloaded && (
        <button
          type="button"
          data-ui="connection-note-downloads"
          onClick={() => navigate(to.downloads)}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
        >
          <Trans>Downloads</Trans>
        </button>
      )}
      <button
        type="button"
        data-ui="connection-note-dismiss"
        aria-label={t`Dismiss`}
        onClick={() => setSmall(true)}
        className="me-2 flex size-7 flex-none items-center justify-center rounded-full text-base text-[--muted] transition-colors hover:bg-white/10 hover:text-white"
      >
        <BiX />
      </button>
    </div>
  );
}
