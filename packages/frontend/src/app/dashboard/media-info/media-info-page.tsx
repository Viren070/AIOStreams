import React from 'react';
import { toast } from 'sonner';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { BiErrorCircle, BiSearch, BiX } from 'react-icons/bi';
import { Alert } from '@aiostreams/ui/alert';
import { Card } from '@aiostreams/ui/card';
import { IconButton } from '@aiostreams/ui/button';
import { Select } from '@aiostreams/ui/select';
import { TextInput } from '@aiostreams/ui/text-input';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { Spinner } from '@aiostreams/ui/loading-spinner';
import { Stat } from '@aiostreams/ui/charts';
import {
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationTrigger,
  pageWindow,
} from '@aiostreams/ui/pagination';
import { cn } from '@aiostreams/ui/core/styling';
import { useDebounce } from '@aiostreams/ui/hooks/debounce';
import {
  formatBytes,
  formatClock,
  formatCompact,
  formatDuration,
  formatLatency,
  formatPercent,
  relativeTime,
} from '@aiostreams/ui/core/format';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import {
  useCancelProbe,
  useMediaInfoLive,
  useMediaInfoSummary,
  useProbeAttempts,
  useProbedFiles,
  type MediaInfoKind,
  type MediaInfoSummary,
  type ProbeAttempt,
  type ProbedFile,
  type ProbeJob,
  type ProbeOutcome,
  type ProbePath,
  type ProberSnapshot,
} from './queries';
import {
  MediaInfoModal,
  baseName,
  codecName,
  hdrLabels,
  isTorrent,
  resolutionLabel,
  sourceLabel,
} from './_components/media-info-modal';

const PAGE_SIZE = 20;

const PATH_LABEL: Record<ProbePath, string> = {
  stremio: 'Stremio',
  jellyfin: 'Jellyfin',
  library: 'Library add',
  shares: 'Share read',
};

const PATH_OPTIONS: { value: ProbePath | 'all'; label: string }[] = [
  { value: 'all', label: 'Every path' },
  ...(Object.keys(PATH_LABEL) as ProbePath[]).map((value) => ({
    value,
    label: PATH_LABEL[value],
  })),
];

const KIND_OPTIONS: { value: MediaInfoKind | 'all'; label: string }[] = [
  { value: 'all', label: 'Usenet and torrents' },
  { value: 'usenet', label: 'Usenet' },
  { value: 'torrent', label: 'Torrents' },
];

const ORIGIN_NAME: Record<string, string> = {
  local: 'This instance',
  stremthru: 'StremThru',
  remuxdb: 'RemuxDB',
};

const OUTCOME: Record<ProbeOutcome, { label: string; dot: string }> = {
  stored: { label: 'Stored', dot: 'bg-emerald-500' },
  applied: { label: 'Used, not stored', dot: 'bg-sky-400' },
  empty: { label: 'No tracks', dot: 'bg-amber-500' },
  failed: { label: 'Failed', dot: 'bg-red-400' },
  timeout: { label: 'Timed out', dot: 'bg-orange-400' },
  cancelled: { label: 'Cancelled', dot: 'bg-[--muted]' },
};

const OUTCOME_OPTIONS: { value: ProbeOutcome | 'all'; label: string }[] = [
  { value: 'all', label: 'All outcomes' },
  ...(Object.keys(OUTCOME) as ProbeOutcome[]).map((value) => ({
    value,
    label: OUTCOME[value].label,
  })),
];

const STAGE_LABEL: Record<ProbeJob['stage'], string> = {
  waiting: 'Waiting',
  queued: 'Queued',
  opening: 'Opening',
  probing: 'Reading',
};

type View = 'files' | 'attempts';

/** Re-renders every second while `active`, for elapsed timers. */
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border border-[--border] px-1.5 py-0.5 text-[10px] font-medium text-[--muted]',
        className
      )}
    >
      {children}
    </span>
  );
}

function Pager({
  page,
  total,
  capped,
  shown,
  onPage,
}: {
  page: number;
  total: number;
  capped: boolean;
  shown: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[--border]/50 p-3 text-xs text-[--muted]">
      <span className="tabular-nums">
        {(page - 1) * PAGE_SIZE + (shown > 0 ? 1 : 0)}–
        {(page - 1) * PAGE_SIZE + shown} of {total.toLocaleString()}
        {capped && '+'}
      </span>
      {pages > 1 && (
        <Pagination>
          <PaginationTrigger
            direction="previous"
            isDisabled={page <= 1}
            onClick={() => onPage(Math.max(1, page - 1))}
          />
          {pageWindow(page, pages).map((p, i) =>
            p === '…' ? (
              <PaginationEllipsis key={`e${i}`} />
            ) : (
              <PaginationItem
                key={p}
                value={p}
                data-selected={p === page}
                onClick={() => onPage(p)}
              />
            )
          )}
          <PaginationTrigger
            direction="next"
            isDisabled={page >= pages}
            onClick={() => onPage(Math.min(pages, page + 1))}
          />
        </Pagination>
      )}
    </div>
  );
}

function StatusAlert({
  summary,
  live,
}: {
  summary?: MediaInfoSummary;
  live?: ProberSnapshot;
}) {
  if (live && !live.enabled) {
    return (
      <Alert
        intent="info"
        title="Probing is off"
        description="Files keep the media info already stored, but nothing new is probed. Turn it on in Settings under Media Info."
      />
    );
  }
  if (summary?.ffprobe.missing || live?.ffprobe.missing) {
    const path = summary?.ffprobe.path ?? live?.ffprobe.path;
    return (
      <Alert
        intent="warning"
        title="ffprobe not found"
        description={`Nothing can be probed until ffprobe is installed or the path is set (currently "${path}"). The Docker image includes it.`}
      />
    );
  }
  return null;
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs uppercase tracking-wide text-[--muted]">
      {children}
    </h3>
  );
}

interface SourceRow {
  name: string;
  note?: string;
  files?: number;
  lastDay?: number;
  filled: number;
}

function sourceRows(summary: MediaInfoSummary): SourceRow[] {
  const { stored, backfill, lookups } = summary;
  const origin = (name: string) =>
    stored.byOrigin.find((o) => o.origin === name);
  const rows: SourceRow[] = [
    {
      name: 'Probed here',
      note: summary.probing ? undefined : 'Probing is off',
      files: origin('local')?.files ?? 0,
      lastDay: origin('local')?.lastDay ?? 0,
      filled: lookups.bySource.local ?? 0,
    },
  ];
  // A source that stores, or has stored before, gets a row.
  const sources = [
    ...new Set([
      ...backfill.sources,
      ...stored.byOrigin.map((o) => o.origin).filter((o) => o !== 'local'),
    ]),
  ];
  for (const source of sources) {
    const pending = backfill.pending[source] ?? 0;
    const dropped = backfill.dropped[source] ?? 0;
    const notes = [
      !backfill.sources.includes(source) && 'Not stored',
      pending > 0 && `${formatCompact(pending)} waiting`,
      dropped > 0 && `${formatCompact(dropped)} left for later while busy`,
    ].filter(Boolean);
    rows.push({
      name: ORIGIN_NAME[source] ?? source,
      note: notes.join(' · ') || undefined,
      files: origin(source)?.files ?? 0,
      lastDay: origin(source)?.lastDay ?? 0,
      filled: lookups.bySource[source] ?? 0,
    });
  }
  if (summary.lookupHost) {
    rows.push({
      name: summary.lookupHost,
      note: 'Looked up, not stored',
      filled: lookups.bySource.remote ?? 0,
    });
  }
  return rows;
}

const count = (n: number | undefined) =>
  n === undefined ? '–' : formatCompact(n);

function SourcesCard({ summary }: { summary: MediaInfoSummary }) {
  return (
    <Card className="space-y-3 p-4">
      <CardTitle>Sources</CardTitle>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-4 gap-y-2 text-sm">
        <span className="text-xs text-[--muted]">Source</span>
        <span className="text-right text-xs text-[--muted]">Files</span>
        <span className="text-right text-xs text-[--muted]">New, 24h</span>
        <span className="text-right text-xs text-[--muted]">
          Streams filled
        </span>
        {sourceRows(summary).map((row) => (
          <React.Fragment key={row.name}>
            <div className="min-w-0">
              <p className="truncate">{row.name}</p>
              {row.note && (
                <p className="truncate text-xs text-[--muted]">{row.note}</p>
              )}
            </div>
            <span className="text-right tabular-nums">{count(row.files)}</span>
            <span className="text-right tabular-nums">
              {count(row.lastDay)}
            </span>
            <span className="text-right tabular-nums">
              {formatCompact(row.filled)}
            </span>
          </React.Fragment>
        ))}
      </div>
      {summary.serving && (
        <p className="text-xs text-[--muted]">
          Shared read-only with other instances.
        </p>
      )}
    </Card>
  );
}

function ProbingCard({ summary }: { summary: MediaInfoSummary }) {
  const { day, week } = summary;
  const shown = (Object.keys(OUTCOME) as ProbeOutcome[]).filter(
    (o) => day[o] > 0
  );
  return (
    <Card className="space-y-4 p-4">
      <CardTitle>Probing</CardTitle>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(PATH_LABEL) as ProbePath[]).map((path) => {
          const on = summary.probing && summary.probeOn.includes(path);
          return (
            <Pill
              key={path}
              className={cn(
                'text-xs',
                on ? 'text-[--foreground]' : 'opacity-60'
              )}
            >
              {PATH_LABEL[path]}
              <span className="tabular-nums text-[--muted]">
                {on ? formatCompact(week.byPath[path]) : 'off'}
              </span>
            </Pill>
          );
        })}
        <span className="self-center text-xs text-[--muted]">
          probes in 7 days
        </span>
      </div>
      {day.attempts === 0 ? (
        <p className="text-sm text-[--muted]">
          No probes in the last 24 hours.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex h-2 overflow-hidden rounded-full bg-[--subtle]">
            {shown.map((o) => (
              <span
                key={o}
                className={OUTCOME[o].dot}
                style={{ width: `${(day[o] / day.attempts) * 100}%` }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[--muted]">
            {shown.map((o) => (
              <span key={o} className="inline-flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', OUTCOME[o].dot)} />
                {OUTCOME[o].label}
                <span className="tabular-nums text-[--foreground]">
                  {formatCompact(day[o])}
                </span>
              </span>
            ))}
            <span>in 24h</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function SummaryTiles({ summary }: { summary: MediaInfoSummary }) {
  const { day, stored, lookups } = summary;
  const failures = day.failed + day.timeout;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Files with tracks"
          value={formatCompact(stored.total)}
          hint={`${formatCompact(stored.lastDay)} new in 24h`}
        />
        <Stat
          label="Streams filled, 24h"
          value={
            lookups.eligible
              ? formatPercent(lookups.filled / lookups.eligible)
              : '–'
          }
          hint={
            lookups.eligible
              ? `${formatCompact(lookups.filled)} of ${formatCompact(lookups.eligible)} streams`
              : 'no streams listed yet'
          }
        />
        <Stat
          label="Probes, 24h"
          value={formatCompact(day.attempts)}
          hint={
            failures
              ? `${formatCompact(failures)} failed`
              : day.attempts
                ? 'none failed'
                : 'none yet'
          }
          spark={day.hourly.some(Boolean) ? day.hourly : undefined}
        />
        <Stat
          label="Probe time"
          value={formatLatency(day.medianMs)}
          hint={
            day.p95Ms !== null ? `p95 ${formatLatency(day.p95Ms)}` : 'median'
          }
          spark={summary.recentMs.length > 1 ? summary.recentMs : undefined}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <SourcesCard summary={summary} />
        <ProbingCard summary={summary} />
      </div>
    </div>
  );
}

/** What a file or probe is, beyond its name: its kind and how it was read. */
function KindPills({
  kind,
  reader,
}: {
  kind: MediaInfoKind;
  reader?: ProbeJob['reader'];
}) {
  return (
    <>
      {kind === 'torrent' && <Pill>Torrent</Pill>}
      {reader === 'http' && <Pill>Debrid link</Pill>}
    </>
  );
}

function JobRow({
  job,
  now,
  onCancel,
  cancelling,
}: {
  job: ProbeJob;
  now: number;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const active = job.stage === 'opening' || job.stage === 'probing';
  const since = job.startedAt ?? job.queuedAt;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex w-5 shrink-0 justify-center">
        {active ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-[--muted]/60" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={job.file}>
          {baseName(job.file) || 'Name not known yet'}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[--muted]">
          <Pill>{PATH_LABEL[job.path]}</Pill>
          <KindPills kind={job.kind} reader={job.reader} />
          <span className={cn(active && 'text-[--foreground]')}>
            {STAGE_LABEL[job.stage]}
          </span>
          <span className="tabular-nums">{formatClock(now - since)}</span>
          {job.bytesRead > 0 && (
            <span className="tabular-nums">{formatBytes(job.bytesRead)}</span>
          )}
        </div>
      </div>
      <Tooltip
        trigger={
          <IconButton
            size="sm"
            intent="gray-subtle"
            icon={<BiX />}
            aria-label="Cancel probe"
            loading={cancelling}
            onClick={() => onCancel(job.id)}
          />
        }
      >
        Cancel
      </Tooltip>
    </li>
  );
}

function LiveQueue({
  live,
  version,
}: {
  live: ProberSnapshot;
  version?: string | null;
}) {
  const cancel = useCancelProbe();
  const now = useNow(live.jobs.length > 0);
  const running = live.jobs.filter(
    (j) => j.stage === 'opening' || j.stage === 'probing'
  ).length;
  const onCancel = (id: string) =>
    cancel
      .mutateAsync(id)
      .catch((err: any) => toast.error(err?.message ?? 'Cancel failed'));
  return (
    <Card className="overflow-hidden p-0">
      <div
        className={cn(
          'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3',
          live.jobs.length > 0 && 'border-b border-[--border]/50'
        )}
      >
        <div>
          <h3 className="text-sm font-semibold">Queue</h3>
          <p className="text-xs text-[--muted]">
            {live.jobs.length === 0
              ? 'Nothing is being probed right now.'
              : `${running} running · ${live.jobs.length - running} waiting`}
          </p>
        </div>
        <p className="text-xs text-[--muted] tabular-nums">
          {version && `ffprobe ${version} · `}
          {live.limits.concurrency} at a time · {live.limits.timeoutSeconds}s
          limit · {live.limits.queue} max queued
        </p>
      </div>
      {live.jobs.length > 0 && (
        <ul className="divide-y divide-[--border]/50">
          {live.jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              now={now}
              onCancel={onCancel}
              cancelling={cancel.isPending && cancel.variables === job.id}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: View;
  onChange: (v: View) => void;
}) {
  const item = (v: View, label: string) => (
    <button
      type="button"
      aria-pressed={value === v}
      onClick={() => onChange(v)}
      className={cn(
        'flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none',
        value === v
          ? 'bg-brand/10 text-brand'
          : 'text-[--muted] hover:text-[--foreground]'
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1 rounded-full border border-[--border] p-1 sm:inline-flex">
      {item('files', 'Probed files')}
      {item('attempts', 'Attempts')}
    </div>
  );
}

function fileChips(file: ProbedFile): string[] {
  const { tracks } = file.info;
  const video = tracks.find((t) => t.type === 'video');
  const audio = tracks.filter((t) => t.type === 'audio').length;
  const subs = tracks.filter((t) => t.type === 'subtitle').length;
  const chips: string[] = [];
  if (video?.type === 'video') {
    const res = resolutionLabel(video);
    chips.push([res, codecName(video.codec)].filter(Boolean).join(' '));
    chips.push(...hdrLabels(video));
  }
  chips.push(`${audio} audio`);
  chips.push(`${subs} sub${subs === 1 ? '' : 's'}`);
  return chips;
}

function FileRow({
  file,
  showRelease,
  onOpen,
}: {
  file: ProbedFile;
  showRelease: boolean;
  onOpen: (file: ProbedFile) => void;
}) {
  const { info } = file;
  const size = info.size ?? file.size;
  const release = file.title ?? file.nzbName;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-[--subtle]/30"
      >
        <div className="flex w-full items-baseline gap-3">
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium"
            title={file.file}
          >
            {baseName(file.file)}
          </span>
          <span className="shrink-0 text-xs text-[--muted]">
            {relativeTime(file.updatedAt)}
          </span>
        </div>
        {showRelease && release && release !== baseName(file.file) && (
          <span className="truncate text-xs text-[--muted]">{release}</span>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {isTorrent(file) && <Pill>Torrent</Pill>}
          {file.origin !== 'local' && <Pill>{sourceLabel(file)}</Pill>}
          {fileChips(file).map((chip) => (
            <Pill key={chip}>{chip}</Pill>
          ))}
          {info.duration ? <Pill>{formatDuration(info.duration)}</Pill> : null}
          {size ? <Pill>{formatBytes(size)}</Pill> : null}
        </div>
      </button>
    </li>
  );
}

function ProbedFiles({ nzb, origins }: { nzb?: string; origins: string[] }) {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = React.useState('');
  const search = useDebounce(searchInput, 300);
  const [kind, setKind] = React.useState<MediaInfoKind | 'all'>('all');
  const [origin, setOrigin] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<ProbedFile | null>(null);
  React.useEffect(() => setPage(1), [search, nzb, kind, origin]);
  const query = useProbedFiles({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search,
    nzb,
    kind: kind === 'all' ? undefined : kind,
    origin: origin === 'all' ? undefined : origin,
  });
  const originOptions = [
    { value: 'all', label: 'Every source' },
    ...['local', ...origins.filter((o) => o !== 'local')].map((value) => ({
      value,
      label: ORIGIN_NAME[value] ?? value,
    })),
  ];
  const filtered = !!search.trim() || kind !== 'all' || origin !== 'all';
  const items = query.data?.items ?? [];
  const nzbName = nzb ? items[0]?.nzbName : undefined;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TextInput
          leftIcon={<BiSearch />}
          placeholder="Search by name, hash or release key…"
          value={searchInput}
          onValueChange={setSearchInput}
          fieldClass="sm:flex-1 sm:min-w-0"
        />
        {!nzb && (
          <Select
            value={kind}
            options={KIND_OPTIONS}
            onValueChange={(v) => setKind(v as MediaInfoKind | 'all')}
            fieldClass="sm:w-48 sm:shrink-0"
          />
        )}
        {origins.length > 0 && (
          <Select
            value={origin}
            options={originOptions}
            onValueChange={setOrigin}
            fieldClass="sm:w-40 sm:shrink-0"
          />
        )}
        {nzb && (
          <div className="flex min-w-0 items-center gap-1 rounded-full border border-[--border] py-1 pl-3 pr-1 text-xs sm:max-w-[50%]">
            <span className="shrink-0 text-[--muted]">NZB</span>
            <span className="min-w-0 truncate" title={nzbName ?? nzb}>
              {nzbName ?? nzb}
            </span>
            <IconButton
              size="xs"
              intent="gray-subtle"
              icon={<BiX />}
              aria-label="Show every file"
              className="shrink-0 rounded-full"
              onClick={() =>
                navigate({ to: '/dashboard/media-info', search: {} })
              }
            />
          </div>
        )}
      </div>
      <DashboardQueryBoundary query={query} errorTitle="Failed to load files">
        {(d) =>
          d.items.length === 0 ? (
            <Card className="p-8 text-center text-sm text-[--muted]">
              {filtered
                ? 'No files match this filter.'
                : nzb
                  ? 'No file of this NZB has been probed yet. Files are probed when they are played.'
                  : 'No files yet. Files are probed when they are played.'}
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <ul className="divide-y divide-[--border]/50">
                {d.items.map((file) => (
                  <FileRow
                    key={`${file.releaseKey}:${file.file}`}
                    file={file}
                    showRelease={!nzb}
                    onOpen={setOpen}
                  />
                ))}
              </ul>
              <Pager
                page={page}
                total={d.total}
                capped={d.capped}
                shown={d.items.length}
                onPage={setPage}
              />
            </Card>
          )
        }
      </DashboardQueryBoundary>
      <MediaInfoModal
        file={open}
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
      />
    </div>
  );
}

function AttemptRow({ attempt: a }: { attempt: ProbeAttempt }) {
  const outcome = OUTCOME[a.outcome];
  // A probe with no trusted key has none to show.
  const key = a.releaseKey || undefined;
  const took = a.startedAt !== null ? a.finishedAt - a.startedAt : null;
  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-baseline gap-3">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={a.file}
        >
          {baseName(a.file) || 'Name not known'}
        </span>
        <span className="shrink-0 text-xs text-[--muted]">
          {relativeTime(a.finishedAt)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[--muted]">
        <span className="inline-flex items-center gap-1.5 text-[--foreground]">
          <span className={cn('h-2 w-2 rounded-full', outcome.dot)} />
          {outcome.label}
        </span>
        <Pill>{PATH_LABEL[a.path]}</Pill>
        <KindPills kind={a.kind} reader={a.reader} />
        {took !== null && (
          <span className="tabular-nums">{formatLatency(took)}</span>
        )}
        {a.bytesRead > 0 && (
          <span className="tabular-nums">read {formatBytes(a.bytesRead)}</span>
        )}
        {a.tracks !== null && (
          <span className="tabular-nums">
            {a.tracks} track{a.tracks === 1 ? '' : 's'}
          </span>
        )}
        {key && (
          <span className="font-mono" title={key}>
            {key.slice(0, key.indexOf(':') + 9)}…
          </span>
        )}
      </div>
      {a.error && (
        <p className="flex items-start gap-1 text-xs text-red-400 break-words">
          <BiErrorCircle className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{a.error}</span>
        </p>
      )}
    </li>
  );
}

function Attempts() {
  const [searchInput, setSearchInput] = React.useState('');
  const search = useDebounce(searchInput, 300);
  const [outcome, setOutcome] = React.useState<ProbeOutcome | 'all'>('all');
  const [path, setPath] = React.useState<ProbePath | 'all'>('all');
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [search, outcome, path]);
  const query = useProbeAttempts({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    outcome: outcome === 'all' ? undefined : outcome,
    path: path === 'all' ? undefined : path,
    search,
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TextInput
          leftIcon={<BiSearch />}
          placeholder="Search by file name…"
          value={searchInput}
          onValueChange={setSearchInput}
          fieldClass="sm:flex-1 sm:min-w-0"
        />
        <Select
          value={path}
          options={PATH_OPTIONS}
          onValueChange={(v) => setPath(v as ProbePath | 'all')}
          fieldClass="sm:w-40 sm:shrink-0"
        />
        <Select
          value={outcome}
          options={OUTCOME_OPTIONS}
          onValueChange={(v) => setOutcome(v as ProbeOutcome | 'all')}
          fieldClass="sm:w-44 sm:shrink-0"
        />
      </div>
      <DashboardQueryBoundary
        query={query}
        errorTitle="Failed to load attempts"
      >
        {(d) =>
          d.items.length === 0 ? (
            <Card className="p-8 text-center text-sm text-[--muted]">
              {search.trim() || outcome !== 'all' || path !== 'all'
                ? 'No attempts match this filter.'
                : 'No probes have run in the last 30 days.'}
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <ul className="divide-y divide-[--border]/50">
                {d.items.map((a) => (
                  <AttemptRow key={a.id} attempt={a} />
                ))}
              </ul>
              <Pager
                page={page}
                total={d.total}
                capped={d.capped}
                shown={d.items.length}
                onPage={setPage}
              />
            </Card>
          )
        }
      </DashboardQueryBoundary>
    </div>
  );
}

export function MediaInfoPage() {
  const { nzb } = useSearch({ from: '/dashboard/media-info' });
  const summary = useMediaInfoSummary();
  const live = useMediaInfoLive();
  const [view, setView] = React.useState<View>('files');
  React.useEffect(() => {
    if (nzb) setView('files');
  }, [nzb]);

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-4">
      <div>
        <h2>Media info</h2>
        <p className="text-[--muted]">
          The tracks inside played files, probed here or read from other
          sources, so clients see real audio and subtitle lists.
        </p>
      </div>
      <StatusAlert summary={summary.data} live={live.data} />
      <DashboardQueryBoundary
        query={summary}
        errorTitle="Failed to load media info"
      >
        {(s) => <SummaryTiles summary={s} />}
      </DashboardQueryBoundary>
      {live.data && (
        <LiveQueue live={live.data} version={summary.data?.ffprobe.version} />
      )}
      <ViewToggle value={view} onChange={setView} />
      {view === 'files' ? (
        <ProbedFiles
          nzb={nzb}
          origins={summary.data?.stored.byOrigin.map((s) => s.origin) ?? EMPTY}
        />
      ) : (
        <Attempts />
      )}
    </PageWrapper>
  );
}

const EMPTY: string[] = [];
