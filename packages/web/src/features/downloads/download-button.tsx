import React from 'react';
import { Modal } from '@aiostreams/ui/modal';
import { Select } from '@aiostreams/ui/select';
import { itemSubtitle } from '@/lib/format';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiDownload, BiErrorCircle, BiSolidDownload } from 'react-icons/bi';
import { DropdownMenu, DropdownMenuItem } from '@aiostreams/ui/dropdown-menu';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { cn } from '@aiostreams/ui/core/styling';
import { toast } from 'sonner';
import {
  type Download,
  downloadsHost,
  useDownloadOf,
  useEpisodesToDownload,
  useMayDownload,
} from '@/lib/downloads';
import { navigate, to } from '@/lib/paths';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { useVersionPicker } from '@/features/versions/version-picker';

/** Fills with the download; spins while there is nothing to measure yet. */
export function ProgressRing({ percent }: { percent: number | null }) {
  const r = 8;
  const length = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={cn('size-[1em]', percent == null && 'animate-spin')}
    >
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        strokeWidth="2.5"
        className="stroke-white/20"
      />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-current"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - (percent ?? 25) / 100)}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

export function percentOf(download: Download): number | null {
  return download.total
    ? Math.min(100, Math.round((download.bytes / download.total) * 100))
    : null;
}

function describe(download: Download | undefined): string {
  if (!download) return t`Download`;
  switch (download.state) {
    case 'done':
      return t`Downloaded`;
    case 'sent':
      return t`In the app's downloads`;
    case 'failed':
    case 'needs-version':
      return t`Download needs attention`;
    case 'finding':
      return t`Finding a version to download`;
    case 'paused':
      return t`Download paused`;
    default: {
      const percent = percentOf(download);
      return percent == null ? t`Downloading` : t`Downloading, ${percent}%`;
    }
  }
}

/** An item's download: starts one, or shows how it is going and opens the list. */
export function DownloadButton({
  item,
  className,
}: {
  item: BaseItemDto;
  className?: string;
}) {
  const picker = useVersionPicker();
  const download = useDownloadOf(item.Id);
  const mayDownload = useMayDownload();
  if (!downloadsHost() || (!download && !mayDownload)) return null;
  const state = download?.state;
  const label = describe(download);
  const icon = !download ? (
    <BiDownload />
  ) : state === 'done' || state === 'sent' ? (
    <BiSolidDownload />
  ) : state === 'failed' || state === 'needs-version' ? (
    <BiErrorCircle />
  ) : (
    <ProgressRing percent={state === 'finding' ? null : percentOf(download)} />
  );
  return (
    <Tooltip
      trigger={
        <IconButton
          data-ui="download-button"
          data-state={state}
          size="sm"
          intent={
            state === 'done' || state === 'sent'
              ? 'primary-subtle'
              : 'gray-subtle'
          }
          className={cn('rounded-full', className)}
          icon={icon}
          aria-label={label}
          onClick={() =>
            download ? navigate(to.downloads) : picker.download([item])
          }
        />
      }
    >
      {label}
    </Tooltip>
  );
}

/** A show's downloads: the season on screen or all of it, everything or what is unwatched. */
export function ShowDownloadMenu({
  series,
  season,
  className,
}: {
  series: BaseItemDto;
  season?: BaseItemDto;
  className?: string;
}) {
  const picker = useVersionPicker();
  const episodes = useEpisodesToDownload();
  const mayDownload = useMayDownload();
  const seasonName = season?.Name;
  const [range, setRange] = React.useState<BaseItemDto[] | null>(null);
  const [start, setStart] = React.useState(0);
  const [end, setEnd] = React.useState(0);
  const loadingRange = React.useRef(false);
  const chooseRange = async () => {
    if (loadingRange.current) return;
    loadingRange.current = true;
    const notice = toast.loading(t`Loading episodes…`);
    try {
      const items = await episodes(series.Id!, { seasonId: season?.Id });
      if (!items.length) {
        toast(t`No episodes to download there`);
        return;
      }
      setStart(0);
      setEnd(items.length - 1);
      setRange(items);
    } catch {
      toast.error(t`Could not list the episodes`);
    } finally {
      toast.dismiss(notice);
      loadingRange.current = false;
    }
  };
  if (!mayDownload) return null;
  const run = (opts: { seasonId?: string; unwatched?: boolean }) =>
    void episodes(series.Id!, opts).then(
      (items) =>
        items.length
          ? picker.download(items)
          : toast(t`No episodes to download there`),
      () => toast.error(t`Could not list the episodes`)
    );
  const menu = (
    <DropdownMenu
      data-ui="download-menu"
      trigger={
        <IconButton
          data-ui="item-action"
          data-name="download"
          intent="gray-subtle"
          className={cn('rounded-full', className)}
          icon={<BiDownload />}
          aria-label={t`Download`}
        />
      }
    >
      <DropdownMenuItem onClick={chooseRange}>
        <Trans>Choose episode range…</Trans>
      </DropdownMenuItem>
      {season && (
        <>
          <DropdownMenuItem onClick={() => run({ seasonId: season.Id! })}>
            {season.Name ?? t`This season`}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run({ seasonId: season.Id!, unwatched: true })}
          >
            {seasonName
              ? t`Unwatched in ${seasonName}`
              : t`Unwatched in this season`}
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuItem onClick={() => run({})}>
        <Trans>The whole show</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => run({ unwatched: true })}>
        <Trans>Everything unwatched</Trans>
      </DropdownMenuItem>
    </DropdownMenu>
  );
  const startLabel = t`Start episode`;
  const endLabel = t`End episode (included)`;
  const options = range?.map((item, i) => ({
    value: String(i),
    label: itemSubtitle(item),
  }));
  return (
    <>
      <Tooltip trigger={<span className="inline-flex">{menu}</span>}>
        <Trans>Download</Trans>
      </Tooltip>
      <Modal
        open={!!range}
        onOpenChange={(open) => !open && setRange(null)}
        title={t`Choose episode range`}
      >
        <Select
          label={startLabel}
          aria-label={startLabel}
          options={options}
          value={String(start)}
          onValueChange={(value) => {
            const next = Number(value);
            setStart(next);
            setEnd((end) => Math.max(next, end));
          }}
        />
        <Select
          label={endLabel}
          aria-label={endLabel}
          options={options?.map((option, i) => ({
            ...option,
            disabled: i < start,
          }))}
          value={String(end)}
          onValueChange={(value) => setEnd(Number(value))}
        />
        <Button
          intent="primary"
          onClick={() => {
            if (!range || start < 0 || end < start || end >= range.length)
              return;
            const items = range.slice(start, end + 1);
            setRange(null);
            setTimeout(() => picker.download(items));
          }}
        >
          <Trans>Download</Trans>
        </Button>
      </Modal>
    </>
  );
}
