import React from 'react';
import { BiDownload, BiErrorCircle, BiSolidDownload } from 'react-icons/bi';
import { DropdownMenu, DropdownMenuItem } from '@aiostreams/ui/dropdown-menu';
import { IconButton } from '@aiostreams/ui/button';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { cn } from '@aiostreams/ui/core/styling';
import { toast } from 'sonner';
import {
  downloadsHost,
  useDownloadOf,
  useEpisodesToDownload,
  type Download,
} from '../lib/downloads';
import { navigate, to } from '../lib/paths';
import type { BaseItemDto } from '../lib/types';
import { useVersionPicker } from './version-picker';

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
  if (!download) return 'Download';
  switch (download.state) {
    case 'done':
      return 'Downloaded';
    case 'failed':
    case 'needs-version':
      return 'Download needs attention';
    case 'finding':
      return 'Finding a version to download';
    case 'paused':
      return 'Download paused';
    default: {
      const percent = percentOf(download);
      return percent == null ? 'Downloading' : `Downloading, ${percent}%`;
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
  if (!downloadsHost()) return null;
  const state = download?.state;
  const label = describe(download);
  const icon = !download ? (
    <BiDownload />
  ) : state === 'done' ? (
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
          intent={state === 'done' ? 'primary-subtle' : 'gray-subtle'}
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
  if (!downloadsHost()) return null;
  const run = (opts: { seasonId?: string; unwatched?: boolean }) =>
    void episodes(series.Id!, opts).then(
      (items) =>
        items.length
          ? picker.download(items)
          : toast('No episodes to download there'),
      () => toast.error('Could not list the episodes')
    );
  return (
    <DropdownMenu
      data-ui="download-menu"
      trigger={
        <IconButton
          data-ui="item-action"
          data-name="download"
          intent="gray-subtle"
          className={cn('rounded-full', className)}
          icon={<BiDownload />}
          aria-label="Download"
        />
      }
    >
      {season && (
        <>
          <DropdownMenuItem onClick={() => run({ seasonId: season.Id! })}>
            {season.Name ?? 'This season'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run({ seasonId: season.Id!, unwatched: true })}
          >
            Unwatched in {season.Name ?? 'this season'}
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuItem onClick={() => run({})}>
        The whole show
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => run({ unwatched: true })}>
        Everything unwatched
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
