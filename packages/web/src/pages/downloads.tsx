import React from 'react';
import {
  BiDotsVerticalRounded,
  BiFolderOpen,
  BiPause,
  BiPlay,
  BiRefresh,
  BiListUl,
  BiTrash,
  BiX,
} from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import { DropdownMenu, DropdownMenuItem } from '@aiostreams/ui/dropdown-menu';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { cn } from '@aiostreams/ui/core/styling';
import { formatBytes, formatSpeed } from '@aiostreams/ui/core/format';
import { useSession } from '../lib/session';
import { duration, fullTitle, itemSubtitle, itemTitle } from '../lib/format';
import { landscapeUrl, posterUrl } from '../lib/images';
import { itemPath, navigate } from '../lib/paths';
import {
  downloadsHost,
  pauseDownload,
  removeDownloads,
  resumeDownload,
  retryDownload,
  useDownloadFolder,
  useDownloadList,
  useDownloadSpeeds,
  type Download,
} from '../lib/downloads';
import { PageBody } from '../components/layout';
import { CachedImage } from '../components/cached-image';
import { ProgressRing, percentOf } from '../components/download-button';
import { useVersionPicker } from '../components/version-picker';

const RUNNING = new Set(['finding', 'queued', 'downloading', 'paused']);

function sizeOf(downloads: Download[]): number {
  return downloads.reduce((sum, d) => sum + (d.total ?? d.bytes), 0);
}

function status(download: Download, speed: number | undefined): string {
  const { bytes, total } = download;
  const of = total
    ? `${formatBytes(bytes)} of ${formatBytes(total)}`
    : formatBytes(bytes);
  switch (download.state) {
    case 'finding':
      return 'Finding a version…';
    case 'needs-version':
      return 'No version was found to match. Pick one.';
    case 'queued':
      return bytes ? `Waiting · ${of}` : 'Waiting';
    case 'paused':
      return `Paused · ${of}`;
    case 'failed':
      return download.error ?? 'Failed';
    case 'done':
      return formatBytes(total ?? bytes);
    case 'sent':
      return "In the app's downloads";
    case 'downloading':
      return speed ? `${of} · ${formatSpeed(speed)}` : of;
  }
}

function timeLeft(download: Download, speed: number | undefined): string {
  const { bytes, total } = download;
  return speed && total
    ? `${duration(((total - bytes) / speed) * 1000)} left`
    : '';
}

function DownloadRow({
  download,
  speed,
  episodeOnly,
}: {
  download: Download;
  speed?: number;
  /** In a show's group, which already names the show. */
  episodeOnly?: boolean;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const host = downloadsHost();
  const { item, state } = download;
  const art =
    landscapeUrl(client, item, { maxWidth: 320 }) ??
    posterUrl(client, item, { maxWidth: 320 });
  const percent = percentOf(download);
  const pick = () => picker.download([item], { replace: download });
  const actions: {
    name: string;
    label: string;
    icon: React.ReactNode;
    run: () => void;
  }[] = [];
  if (state === 'downloading' || state === 'queued')
    actions.push({
      name: 'pause',
      label: 'Pause',
      icon: <BiPause />,
      run: () => pauseDownload(download),
    });
  if (state === 'paused')
    actions.push({
      name: 'resume',
      label: 'Resume',
      icon: <BiPlay />,
      run: () => resumeDownload(download),
    });
  if (state === 'failed')
    actions.push({
      name: 'retry',
      label: 'Try again',
      icon: <BiRefresh />,
      run: () => retryDownload(download),
    });
  if (state === 'failed' || state === 'needs-version')
    actions.push({
      name: 'pick',
      label: 'Pick a version',
      icon: <BiListUl />,
      run: pick,
    });
  if (state === 'done' && host?.folder)
    actions.push({
      name: 'folder',
      label: 'Show in folder',
      icon: <BiFolderOpen />,
      run: () => host.folder?.open(download.id),
    });

  return (
    <div
      data-ui="download"
      data-state={state}
      className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2 sm:items-center sm:pr-3"
    >
      <button
        type="button"
        onClick={() => navigate(itemPath(item))}
        className="relative aspect-video w-28 flex-none overflow-hidden rounded-lg bg-gray-900 sm:w-36"
      >
        {art && (
          <CachedImage
            src={art}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </button>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-2 text-sm font-semibold [overflow-wrap:anywhere] sm:text-base">
          {episodeOnly ? itemSubtitle(item) : fullTitle(item)}
        </p>
        {download.version && (
          <p className="truncate text-xs text-[--muted]">
            {download.version.label.split('\n')[0]}
          </p>
        )}
        <p
          data-ui="download-status"
          className={cn(
            'line-clamp-3 text-xs [overflow-wrap:anywhere] sm:text-sm',
            state === 'failed' || state === 'needs-version'
              ? 'text-red-300'
              : 'text-gray-300'
          )}
        >
          {status(download, speed)}
        </p>
        {(state === 'downloading' ||
          state === 'paused' ||
          (state === 'queued' && download.bytes > 0)) && (
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  'h-full rounded-full',
                  state === 'paused' ? 'bg-gray-400' : 'bg-brand-500'
                )}
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            {state === 'downloading' && (
              <span className="flex-none text-xs text-gray-300">
                {timeLeft(download, speed)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-none flex-col items-center gap-1 sm:flex-row">
        {state === 'finding' && (
          <span className="px-2 text-lg text-[--muted]">
            <ProgressRing percent={null} />
          </span>
        )}
        {actions.map((a, i) => (
          <Tooltip
            key={a.name}
            trigger={
              <IconButton
                data-ui="download-action"
                data-name={a.name}
                size="sm"
                intent="gray-subtle"
                // A phone keeps one beside the menu, which holds the rest.
                className={cn('rounded-full', i > 0 && 'max-sm:hidden')}
                icon={a.icon}
                aria-label={a.label}
                onClick={a.run}
              />
            }
          >
            {a.label}
          </Tooltip>
        ))}
        <DropdownMenu
          align="end"
          trigger={
            <IconButton
              size="sm"
              intent="gray-basic"
              className="rounded-full"
              icon={<BiDotsVerticalRounded />}
              aria-label="More"
            />
          }
        >
          {actions.slice(1).map((a) => (
            <DropdownMenuItem
              key={a.name}
              data-name={a.name}
              className="sm:hidden"
              onClick={a.run}
            >
              {a.icon} {a.label}
            </DropdownMenuItem>
          ))}
          {state === 'sent' ? null : state === 'done' ? (
            <DropdownMenuItem
              data-name="delete"
              onClick={() => removeDownloads([download], true)}
            >
              <BiTrash /> Delete
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              data-name="cancel"
              onClick={() => removeDownloads([download], true)}
            >
              <BiX /> Cancel
            </DropdownMenuItem>
          )}
          {(state === 'done' || state === 'sent') && (
            <DropdownMenuItem
              data-name="forget"
              onClick={() => removeDownloads([download], false)}
            >
              <BiX /> Remove from the list, keep the file
            </DropdownMenuItem>
          )}
        </DropdownMenu>
      </div>
    </div>
  );
}

function Section({
  name,
  title,
  actions,
  children,
}: {
  name: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section data-ui="downloads-section" data-name={name} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** Finished downloads: movies, then each show with its seasons in order. */
function Downloaded({ downloads }: { downloads: Download[] }) {
  const movies = downloads.filter((d) => d.item.Type !== 'Episode');
  const shows = new Map<string, Download[]>();
  for (const d of downloads.filter((d) => d.item.Type === 'Episode')) {
    const key = d.item.SeriesId ?? itemTitle(d.item);
    shows.set(key, [...(shows.get(key) ?? []), d]);
  }
  const order = (a: Download, b: Download) =>
    (a.item.ParentIndexNumber ?? 0) - (b.item.ParentIndexNumber ?? 0) ||
    (a.item.IndexNumber ?? 0) - (b.item.IndexNumber ?? 0);
  return (
    <div className="space-y-6">
      {movies.map((d) => (
        <DownloadRow key={d.id} download={d} />
      ))}
      {[...shows.values()].map((episodes) => {
        const sorted = [...episodes].sort(order);
        const first = sorted[0].item;
        return (
          <div
            key={first.SeriesId ?? first.Id}
            data-ui="downloads-show"
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <div className="mr-auto min-w-0">
                <p className="truncate font-semibold">{itemTitle(first)}</p>
                <p className="text-sm text-[--muted]">
                  {sorted.length === 1
                    ? '1 episode'
                    : `${sorted.length} episodes`}{' '}
                  · {formatBytes(sizeOf(sorted))}
                </p>
              </div>
              <Button
                size="sm"
                intent="gray-subtle"
                className="rounded-full"
                leftIcon={<BiTrash />}
                onClick={() => removeDownloads(sorted, true)}
              >
                Delete all
              </Button>
            </div>
            {sorted.map((d) => (
              <DownloadRow key={d.id} download={d} episodeOnly />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function DownloadsPage() {
  const { client, user } = useSession();
  const all = useDownloadList();
  const speeds = useDownloadSpeeds();
  const folder = useDownloadFolder();
  const host = downloadsHost();
  const mine = all.filter(
    (d) => d.base === client.base && d.userId === user.Id
  );
  const running = mine.filter((d) => RUNNING.has(d.state));
  const attention = mine.filter(
    (d) => d.state === 'failed' || d.state === 'needs-version'
  );
  const done = mine.filter((d) => d.state === 'done');
  const sent = mine.filter((d) => d.state === 'sent');
  const pausable = running.filter(
    (d) => d.state === 'downloading' || d.state === 'queued'
  );
  const paused = running.filter((d) => d.state === 'paused');

  return (
    <PageBody>
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 data-ui="page-title" className="text-3xl font-bold">
            Downloads
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto min-w-0 text-sm text-[--muted]">
              {done.length > 0 && <p>{formatBytes(sizeOf(done))} downloaded</p>}
              {folder && (
                <p className="truncate" title={folder}>
                  Saved to {folder}
                </p>
              )}
            </div>
            {host?.handsOff && (
              <Button
                size="sm"
                intent="gray-outline"
                className="rounded-full"
                leftIcon={<BiFolderOpen />}
                onClick={() => host.handsOff?.open()}
              >
                Open the app's downloads
              </Button>
            )}
            {host?.folder && (
              <>
                <Button
                  size="sm"
                  intent="gray-outline"
                  className="rounded-full"
                  leftIcon={<BiFolderOpen />}
                  onClick={() => host.folder?.open()}
                >
                  Open folder
                </Button>
                <Button
                  size="sm"
                  intent="gray-outline"
                  className="rounded-full"
                  onClick={() => host.folder?.choose()}
                >
                  Change folder
                </Button>
              </>
            )}
          </div>
        </div>

        {!mine.length && (
          <p className="text-[--muted]">
            Nothing downloaded yet. Download a movie or episode from its page,
            or a whole season from the show's.
          </p>
        )}

        {running.length > 0 && (
          <Section
            name="running"
            title="Downloading"
            actions={
              pausable.length > 0 ? (
                <Button
                  size="sm"
                  intent="gray-subtle"
                  className="rounded-full"
                  leftIcon={<BiPause />}
                  onClick={() => pausable.forEach(pauseDownload)}
                >
                  Pause all
                </Button>
              ) : paused.length > 0 ? (
                <Button
                  size="sm"
                  intent="gray-subtle"
                  className="rounded-full"
                  leftIcon={<BiPlay />}
                  onClick={() => paused.forEach(resumeDownload)}
                >
                  Resume all
                </Button>
              ) : null
            }
          >
            {running.map((d) => (
              <DownloadRow key={d.id} download={d} speed={speeds[d.id]} />
            ))}
          </Section>
        )}

        {attention.length > 0 && (
          <Section name="attention" title="Needs attention">
            {attention.map((d) => (
              <DownloadRow key={d.id} download={d} />
            ))}
          </Section>
        )}

        {sent.length > 0 && (
          <Section name="sent" title="In the app's downloads">
            {sent.map((d) => (
              <DownloadRow key={d.id} download={d} />
            ))}
          </Section>
        )}

        {done.length > 0 && (
          <Section name="done" title="Downloaded">
            <Downloaded downloads={done} />
          </Section>
        )}
      </div>
    </PageBody>
  );
}
