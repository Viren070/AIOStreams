import React from 'react';
import { toast } from 'sonner';
import {
  BiTrash,
  BiPlay,
  BiDownload,
  BiFolderOpen,
  BiPlus,
  BiLinkAlt,
  BiInfoCircle,
  BiExport,
  BiSelectMultiple,
  BiCheckboxChecked,
  BiCheckbox,
  BiX,
  BiSearch,
  BiGridAlt,
  BiListUl,
  BiSortUp,
  BiSortDown,
  BiCloudUpload,
  BiBlock,
  BiRefresh,
  BiDotsVerticalRounded,
} from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { SimpleDropzone } from '@/components/ui/simple-dropzone';
import {
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationTrigger,
  pageWindow,
} from '@/components/ui/pagination';
import { cn } from '@/components/ui/core/styling';
import { useDebounce } from '@/hooks/debounce';
import { useMediaQuery } from '@/hooks/media-query';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import {
  useUsenetLibrary,
  useUsenetLibraryStream,
  useBlockRelease,
  useRequeueEntries,
  useDeleteLibraryEntry,
  useDeleteAllLibraryEntries,
  useAddNzb,
  useUploadNzb,
  usePlayUrl,
  usenetNzbExportUrl,
  releaseBlocklistKeys,
  type LibraryEntry,
  type LibraryStatus,
  type LibrarySort,
  type LibrarySortDir,
} from './queries';
import { NzbBrowser } from './_components/nzb-browser';
import { EntryInfoModal } from './_components/entry-info-modal';
import { SettingsPageHeader } from '../settings/_components/settings-card';
import { formatBytes } from '@/lib/format';

const STATUS_STYLE: Record<LibraryStatus, string> = {
  queued: 'bg-[--subtle] text-[--muted]',
  inspecting: 'bg-amber-500/15 text-amber-500',
  available: 'bg-emerald-500/15 text-emerald-500',
  degraded: 'bg-orange-500/15 text-orange-500',
  failed: 'bg-red-500/15 text-red-500',
};

/** Status filter options for the Select (single-select; "all" clears it). */
const STATUS_OPTIONS: { value: LibraryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'inspecting', label: 'Inspecting' },
  { value: 'available', label: 'Available' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'failed', label: 'Failed' },
];

/** Sort criteria — direction is chosen separately via the toggle button. */
const SORT_FIELD_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: 'activity', label: 'Recent activity' },
  { value: 'added', label: 'Date added' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
];

/** The natural default direction for each criterion (e.g. names read A–Z). */
const DEFAULT_SORT_DIR: Record<LibrarySort, LibrarySortDir> = {
  activity: 'desc',
  added: 'desc',
  name: 'asc',
  size: 'desc',
};

type LibraryView = 'grid' | 'list';

/** Entries rendered per page (clean for the 2- and 3-column grids). */
const PAGE_SIZE = 15;

const VIEW_STORAGE_KEY = 'usenet.library.view';

function loadView(): LibraryView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Combined two-icon segmented control for the grid/list layout choice. */
function ViewToggle({
  value,
  onChange,
}: {
  value: LibraryView;
  onChange: (v: LibraryView) => void;
}) {
  const item = (v: LibraryView, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={value === v}
      onClick={() => onChange(v)}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded text-lg transition-colors',
        value === v
          ? 'bg-brand/10 text-brand'
          : 'text-[--muted] hover:text-[--foreground]'
      )}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex h-10 items-center gap-0.5 rounded-md border border-[--border] p-0.5">
      {item('grid', <BiGridAlt />, 'Grid view')}
      {item('list', <BiListUl />, 'List view')}
    </div>
  );
}

function StatusPill({ status }: { status: LibraryStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_STYLE[status]
      )}
    >
      {status}
    </span>
  );
}

const NZB_ACCEPT = {
  'application/x-nzb': ['.nzb'],
  'application/xml': ['.nzb'],
  'text/xml': ['.nzb'],
} as const;

/**
 * Add NZBs: a full-width dropzone for .nzb files, with an attached URL field +
 * Add button below it. Imported NZBs land in the library list / active imports
 * — the dropzone doesn't keep its own duplicate queue.
 */
function AddNzb() {
  const [url, setUrl] = React.useState('');
  const [progress, setProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const add = useAddNzb();
  const upload = useUploadNzb();

  const reportEntry = (entry: { status: string; failReason?: string }) => {
    // The add now returns as soon as the entry is queued; inspection runs in the
    // background and the library list polls it through to available/failed.
    if (entry.status === 'failed') {
      toast.error(entry.failReason ?? 'Import failed');
    } else {
      toast.success('NZB queued');
    }
  };

  const onFiles = async (files: File[]) => {
    setProgress({ done: 0, total: files.length });
    let done = 0;
    // Import concurrently (bounded) so multiple drops are clearly all in-flight.
    await Promise.all(
      files.map(async (file) => {
        try {
          const entry = await upload.mutateAsync({ file, name: file.name });
          reportEntry(entry);
        } catch (e: any) {
          toast.error(`${file.name}: ${e?.message ?? 'upload failed'}`);
        } finally {
          done += 1;
          setProgress({ done, total: files.length });
        }
      })
    );
    setProgress(null);
  };

  const submitUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    add
      .mutateAsync({ url: trimmed })
      .then((entry) => {
        reportEntry(entry);
        if (entry.status !== 'failed') setUrl('');
      })
      .catch((e: any) => toast.error(e?.message ?? 'Failed to add NZB'));
  };

  return (
    <Card className="p-4 space-y-3">
      <SettingsPageHeader
        title="Add NZB"
        description="Import .nzb files or paste a URL"
        icon={BiCloudUpload}
        size="md"
      />
      <SimpleDropzone
        accept={NZB_ACCEPT}
        multiple
        className="min-h-[120px] w-full"
        dropzoneText="Drop .nzb files here, or click to choose"
        onValueChange={(files) => {
          if (files.length) void onFiles(files);
        }}
        onDropRejected={(rejections) => {
          const names = rejections.map((r) => r.file.name);
          toast.error(
            names.length === 1
              ? `"${names[0]}" isn't a .nzb file`
              : `${names.length} files skipped, only .nzb files are supported`
          );
        }}
      />
      {progress && (
        <p className="text-xs text-[--muted]">
          Importing {progress.done}/{progress.total}…
        </p>
      )}
      {/* Attached URL field + Add button (one input group). */}
      <div className="flex items-stretch">
        <TextInput
          leftIcon={<BiLinkAlt />}
          placeholder="…or add by URL: https://…/file.nzb"
          value={url}
          onValueChange={setUrl}
          onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
          className="flex-1 rounded-r-none"
        />
        <Button
          intent="primary"
          leftIcon={<BiPlus />}
          loading={add.isPending}
          onClick={submitUrl}
          disabled={!url.trim()}
          className="rounded-l-none shrink-0"
        >
          Add
        </Button>
      </div>
    </Card>
  );
}

/**
 * The per-entry action cluster, shared by the grid card and the list row:
 * browse/preview/download/delete stay on the row, the rest sit in an overflow
 * menu. Owns the per-entry playback/export handlers.
 */
function EntryActions({
  entry: e,
  onBrowse,
  onInfo,
  onBlock,
  onRequeue,
  onDelete,
}: {
  entry: LibraryEntry;
  onBrowse: (e: LibraryEntry) => void;
  onInfo: (e: LibraryEntry) => void;
  onBlock: (e: LibraryEntry) => void;
  onRequeue: (hashes: string[]) => void;
  onDelete: (hash: string) => void;
}) {
  const playUrl = usePlayUrl();
  // Degraded entries are playable: known holes are zero-filled at playback.
  const available = e.status === 'available' || e.status === 'degraded';
  const multiFile = e.files.length > 1;
  // Per-file preview/download only makes sense for a single, available file.
  const canPlayOne = available && !multiFile;

  const action = (download: boolean) => {
    playUrl
      .mutateAsync({ hash: e.nzbHash, download })
      .then((res) => window.open(res.url, '_blank'))
      .catch((err: any) => toast.error(err?.message ?? 'No playable source'));
  };

  const exportNzb = () => {
    const a = document.createElement('a');
    a.href = usenetNzbExportUrl(e.nzbHash);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const blocklistKeys = releaseBlocklistKeys(e);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        intent="gray-outline"
        leftIcon={<BiFolderOpen />}
        onClick={() => onBrowse(e)}
      >
        Browse
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <Tooltip
          trigger={
            <IconButton
              size="sm"
              intent="primary-subtle"
              icon={<BiPlay />}
              aria-label="Preview"
              disabled={!canPlayOne}
              onClick={() => action(false)}
            />
          }
        >
          {multiFile ? 'Browse to pick a file' : 'Preview'}
        </Tooltip>
        <Tooltip
          trigger={
            <IconButton
              size="sm"
              intent="gray-subtle"
              icon={<BiDownload />}
              aria-label="Download"
              disabled={!canPlayOne}
              onClick={() => action(true)}
            />
          }
        >
          {multiFile ? 'Browse to pick a file' : 'Download'}
        </Tooltip>
        <DropdownMenu
          align="end"
          trigger={
            <IconButton
              size="sm"
              intent="gray-subtle"
              icon={<BiDotsVerticalRounded />}
              aria-label="More actions"
            />
          }
        >
          <DropdownMenuItem onSelect={() => onInfo(e)}>
            <BiInfoCircle />
            Details
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onRequeue([e.nzbHash])}
            disabled={!e.nzbUrl}
          >
            <BiRefresh />
            {e.nzbUrl ? 'Requeue import' : 'No source NZB to re-import'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportNzb}>
            <BiExport />
            Export NZB
          </DropdownMenuItem>
          {blocklistKeys.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onBlock(e)}
                disabled={e.blocked}
              >
                <BiBlock />
                {e.blocked ? 'Already blocked' : 'Block release'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenu>
        <Tooltip
          trigger={
            <IconButton
              size="sm"
              intent="alert-subtle"
              icon={<BiTrash />}
              aria-label="Delete entry"
              onClick={() => onDelete(e.nzbHash)}
            />
          }
        >
          Delete
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * One library entry. `view='grid'` renders a slim vertical card; `view='list'`
 * renders a full-width horizontal row. Both share {@link EntryActions} and the
 * same select-mode behaviour (the whole card/row toggles selection).
 */
function EntryCard({
  entry,
  view,
  selectMode,
  selected,
  onToggleSelect,
  onBrowse,
  onInfo,
  onBlock,
  onRequeue,
  onDelete,
}: {
  entry: LibraryEntry;
  view: LibraryView;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (e: LibraryEntry, value: boolean) => void;
  onBrowse: (e: LibraryEntry) => void;
  onInfo: (e: LibraryEntry) => void;
  onBlock: (e: LibraryEntry) => void;
  onRequeue: (hashes: string[]) => void;
  onDelete: (hash: string) => void;
}) {
  const e = entry;
  const displayName = e.name || e.nzbHash;
  const meta = (
    <>
      <span>{formatBytes(e.size)}</span>
      <span>
        {e.files.length} file{e.files.length === 1 ? '' : 's'}
      </span>
    </>
  );
  const cardClass = cn(
    // Transition both the hover background and the selection ring (a box-shadow,
    // which `transition-colors` alone would not animate) so the highlight fades
    // in/out instead of snapping.
    'transition-[background-color,box-shadow] duration-200',
    // In select mode the whole card is the toggle (no checkbox); a selected
    // card highlights. `ring-inset` keeps the ring inside the card box so it
    // isn't clipped by the tab content at the grid edges. Kept subtle (thin,
    // dimmed ring + barely-there fill) so it reads as selected, not alarming.
    selectMode && 'cursor-pointer hover:bg-[--subtle]/30',
    selected && 'ring-1 ring-inset ring-brand/60 bg-brand/[0.06]'
  );
  const onCardClick = selectMode
    ? () => onToggleSelect(e, !selected)
    : undefined;

  if (view === 'list') {
    return (
      <Card className={cn(cardClass, 'p-3')} onClick={onCardClick}>
        {/* All cells are direct children of one `items-center` row, so the
            status pill sits centred alongside the name and actions rather than
            riding high on the first text line. */}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <span className="block font-medium text-sm break-all line-clamp-1">
              {displayName}
            </span>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[--muted]">
              {meta}
              {e.status === 'failed' && e.failReason && (
                <span className="text-red-500" title={e.errorCode}>
                  {e.failReason}
                </span>
              )}
            </div>
          </div>
          <StatusPill status={e.status} />
          {!selectMode && (
            <div className="shrink-0">
              <EntryActions
                entry={e}
                onBrowse={onBrowse}
                onInfo={onInfo}
                onBlock={onBlock}
                onRequeue={onRequeue}
                onDelete={onDelete}
              />
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(cardClass, 'flex flex-col h-full p-3 sm:p-4')}
      onClick={onCardClick}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          {/* Clamp long release names so they don't overflow; the full name
              shows on hover. The tooltip content is portaled (see Tooltip), so
              it never becomes an in-flow sibling that stretches the card. */}
          <Tooltip
            trigger={
              <span className="min-w-0 flex-1 font-medium text-sm break-all line-clamp-2">
                {displayName}
              </span>
            }
          >
            {displayName}
          </Tooltip>
          <StatusPill status={e.status} />
        </div>
        {e.status === 'failed' && e.failReason && (
          <p className="text-xs text-red-500 mt-0.5" title={e.errorCode}>
            {e.failReason}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[--muted]">
          {meta}
        </div>
      </div>

      {/* Actions hidden in select mode (the whole card toggles selection).
          `mt-auto` pins them to the card bottom so they don't float when a
          neighbour's long error message stretches the grid row. */}
      {!selectMode && (
        <div className="mt-auto pt-3">
          <EntryActions
            entry={e}
            onBrowse={onBrowse}
            onInfo={onInfo}
            onBlock={onBlock}
            onRequeue={onRequeue}
            onDelete={onDelete}
          />
        </div>
      )}
    </Card>
  );
}

/**
 * The Library tab: add (dropzone + URL), a status filter, and a responsive
 * entry grid with per-entry browse/preview/download/info/requeue/block/delete
 * plus a multi-select mode that requeues, blocks or deletes in bulk. The list is kept
 * live via the SSE library stream (see {@link useUsenetLibraryStream}), so
 * imports appear and transition in place without polling.
 */
export function UsenetLibraryPage() {
  // Push-based freshness: refetch the library on any server-side change.
  useUsenetLibraryStream();
  const [status, setStatus] = React.useState<LibraryStatus | 'all'>('all');
  const [searchInput, setSearchInput] = React.useState('');
  const search = useDebounce(searchInput, 300);
  const [browse, setBrowse] = React.useState<LibraryEntry | null>(null);
  const [info, setInfo] = React.useState<LibraryEntry | null>(null);
  const [selectMode, setSelectMode] = React.useState(false);
  // Keyed by hash, but the entry is kept too: a selection can span pages, and
  // blocking needs each entry's release keys, which the hash alone can't give
  // for entries no longer in `entries`.
  const [selected, setSelected] = React.useState<Map<string, LibraryEntry>>(
    new Map()
  );
  const [view, setView] = React.useState<LibraryView>(loadView);
  // On phones the list-view card has no room for the filename (it collapses to
  // one character per line), so force the grid layout there — which is itself a
  // single full-width column below `sm` — and hide the now-pointless toggle.
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const effectiveView: LibraryView = isDesktop ? view : 'grid';
  const [sortField, setSortField] = React.useState<LibrarySort>('activity');
  const [sortDir, setSortDir] = React.useState<LibrarySortDir>('desc');
  const [page, setPage] = React.useState(1);

  // Picking a criterion resets to its natural direction (newest/largest/A–Z);
  // the toggle then flips it. Keeps "Name" defaulting to A–Z, "Size" to largest.
  const onSortFieldChange = (field: LibrarySort) => {
    setSortField(field);
    setSortDir(DEFAULT_SORT_DIR[field]);
  };

  // Reset to the first page whenever the filter, search or sort changes, so the
  // user can't be stranded on an out-of-range page of a now-smaller result set.
  React.useEffect(() => setPage(1), [status, search, sortField, sortDir]);

  const setViewPersisted = (v: LibraryView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore storage failures (private mode, quota) */
    }
  };

  const query = useUsenetLibrary({
    statuses: status === 'all' ? [] : [status],
    search,
    sort: sortField,
    dir: sortDir,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const del = useDeleteLibraryEntry();
  const delAll = useDeleteAllLibraryEntries();
  const block = useBlockRelease();
  const requeue = useRequeueEntries();
  const pending = React.useRef<string[]>([]);
  const [blockTargets, setBlockTargets] = React.useState<LibraryEntry[]>([]);

  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Clamp the page if the total shrank (e.g. after deletions).
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const confirm = useConfirmationDialog({
    title: 'Delete library entries',
    description:
      'Remove the selected NZB(s) from the library/history. Failed entries are retried on the next request.',
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: () => {
      const hashes = pending.current;
      if (hashes.length === 0) return;
      Promise.allSettled(hashes.map((h) => del.mutateAsync(h))).then(
        (results) => {
          const failed = results.filter((r) => r.status === 'rejected').length;
          if (failed)
            toast.error(
              `${failed} entr${failed === 1 ? 'y' : 'ies'} failed to delete`
            );
          else
            toast.success(
              hashes.length === 1 ? 'Entry deleted' : 'Entries deleted'
            );
          exitSelect();
        }
      );
    },
  });

  const confirmDeleteAll = useConfirmationDialog({
    title: 'Delete all library entries',
    description:
      'This will remove every entry from the library, including active imports. This action cannot be undone.',
    actionText: 'Delete all',
    actionIntent: 'alert-subtle',
    onConfirm: () => {
      delAll
        .mutateAsync(undefined)
        .then(() => {
          toast.success('Library cleared');
          exitSelect();
        })
        .catch((e: any) => {
          toast.error(e?.message ?? 'Failed to clear library');
        });
    },
  });

  const blockCount = blockTargets.length;
  const confirmBlock = useConfirmationDialog({
    title: blockCount > 1 ? 'Block releases' : 'Block release',
    description:
      blockCount > 1
        ? `Mark ${blockCount} releases as dead on this instance's release blocklist? Their streams stop appearing in results; undo from the Blocklist page.`
        : `Mark "${blockTargets[0]?.name ?? blockTargets[0]?.nzbHash ?? ''}" as dead on this instance's release blocklist? Its streams stop appearing in results; undo from the Blocklist page.`,
    actionText: 'Block',
    actionIntent: 'alert-subtle',
    onConfirm: () => {
      if (blockCount === 0) return;
      block
        .mutateAsync(blockTargets)
        .then(() => {
          toast.success(
            blockCount === 1
              ? 'Release blocked'
              : `${blockCount} releases blocked`
          );
          exitSelect();
        })
        .catch((err: any) => toast.error(err?.message ?? 'Block failed'));
    },
  });

  const onBlock = (entry: LibraryEntry) => {
    setBlockTargets([entry]);
    confirmBlock.open();
  };

  // Entries the search never gave a release key and whose hash isn't a content
  // hash have nothing to block under; blocking them is a no-op, so they are
  // dropped from the batch rather than silently counted.
  const onBlockSelected = () => {
    const targets = [...selected.values()].filter(
      (e) => releaseBlocklistKeys(e).length > 0
    );
    if (targets.length === 0) {
      toast.error('None of the selected entries can be blocked');
      return;
    }
    setBlockTargets(targets);
    confirmBlock.open();
  };

  const onRequeue = (hashes: string[]) => {
    if (hashes.length === 0) return;
    requeue
      .mutateAsync(hashes)
      .then((res) => {
        if (res.requeued === 0) {
          toast.error(res.error ?? 'Requeue failed');
          return;
        }
        if (res.failed > 0) {
          toast.warning(
            `${res.requeued} requeued, ${res.failed} failed: ${res.error ?? ''}`
          );
        } else {
          toast.success(
            res.requeued === 1
              ? 'Entry requeued'
              : `${res.requeued} entries requeued`
          );
        }
        exitSelect();
      })
      .catch((err: any) => toast.error(err?.message ?? 'Requeue failed'));
  };

  const onDelete = (hash: string) => {
    pending.current = [hash];
    confirm.open();
  };

  const onDeleteSelected = () => {
    if (selected.size === 0) return;
    pending.current = [...selected.keys()];
    confirm.open();
  };

  const toggleSelect = (entry: LibraryEntry, value: boolean) =>
    setSelected((s) => {
      const next = new Map(s);
      if (value) next.set(entry.nzbHash, entry);
      else next.delete(entry.nzbHash);
      return next;
    });

  // Page-aware: "all selected" means every entry on the current page is
  // selected (selection can also include entries from other pages).
  const allSelected =
    entries.length > 0 && entries.every((e) => selected.has(e.nzbHash));
  const toggleSelectAll = () =>
    setSelected((s) => {
      const next = new Map(s);
      if (allSelected) for (const e of entries) next.delete(e.nzbHash);
      else for (const e of entries) next.set(e.nzbHash, e);
      return next;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Map());
  };

  return (
    <div className="space-y-4 overflow-x-hidden">
      <AddNzb />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <TextInput
          leftIcon={<BiSearch />}
          placeholder="Search by name…"
          value={searchInput}
          onValueChange={setSearchInput}
          fieldClass="lg:flex-1 lg:min-w-0"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:shrink-0">
          <Select
            value={status}
            options={STATUS_OPTIONS}
            onValueChange={(v) => setStatus(v as LibraryStatus | 'all')}
            fieldClass="sm:w-36 sm:flex-auto lg:flex-none"
          />
          {/* Sort criterion + a direction toggle (asc/desc). */}
          <div className="flex items-stretch gap-2 sm:flex-auto lg:flex-none">
            <Select
              value={sortField}
              options={SORT_FIELD_OPTIONS}
              onValueChange={(v) => onSortFieldChange(v as LibrarySort)}
              fieldClass="sm:w-40 sm:flex-auto lg:flex-none"
            />
            <Tooltip
              trigger={
                <IconButton
                  size="md"
                  intent="gray-outline"
                  icon={sortDir === 'asc' ? <BiSortUp /> : <BiSortDown />}
                  aria-label={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                  onClick={() =>
                    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                  }
                />
              }
            >
              {sortDir === 'asc' ? 'Ascending' : 'Descending'}
            </Tooltip>
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-start sm:shrink-0">
            <div className="hidden sm:block">
              <ViewToggle value={view} onChange={setViewPersisted} />
            </div>
            <div className="flex items-center gap-1.5">
              {selectMode ? (
                <>
                  <span className="text-xs text-[--muted] tabular-nums">
                    {selected.size} selected
                  </span>
                  <Tooltip
                    trigger={
                      <IconButton
                        size="md"
                        intent="gray-subtle"
                        icon={
                          allSelected ? <BiCheckbox /> : <BiCheckboxChecked />
                        }
                        aria-label={
                          allSelected ? 'Clear selection' : 'Select all'
                        }
                        disabled={entries.length === 0}
                        onClick={toggleSelectAll}
                      />
                    }
                  >
                    {allSelected ? 'Clear selection' : 'Select all'}
                  </Tooltip>
                  <Tooltip
                    trigger={
                      <IconButton
                        size="md"
                        intent="gray-subtle"
                        icon={<BiRefresh />}
                        aria-label="Requeue selected"
                        loading={requeue.isPending}
                        disabled={selected.size === 0}
                        onClick={() => onRequeue([...selected.keys()])}
                      />
                    }
                  >
                    Requeue selected
                  </Tooltip>
                  <Tooltip
                    trigger={
                      <IconButton
                        size="md"
                        intent="gray-subtle"
                        icon={<BiBlock />}
                        aria-label="Block selected"
                        loading={block.isPending}
                        disabled={selected.size === 0}
                        onClick={onBlockSelected}
                      />
                    }
                  >
                    Block selected releases
                  </Tooltip>
                  <Tooltip
                    trigger={
                      <IconButton
                        size="md"
                        intent="alert-subtle"
                        icon={<BiTrash />}
                        aria-label="Delete selected"
                        disabled={selected.size === 0}
                        onClick={onDeleteSelected}
                      />
                    }
                  >
                    Delete selected
                  </Tooltip>
                  <Tooltip
                    trigger={
                      <IconButton
                        size="md"
                        intent="gray-outline"
                        icon={<BiX />}
                        aria-label="Done selecting"
                        onClick={exitSelect}
                      />
                    }
                  >
                    Done
                  </Tooltip>
                </>
              ) : (
                <>
                  <Tooltip
                    trigger={
                      <IconButton
                        size="md"
                        intent="alert-subtle"
                        icon={<BiTrash />}
                        aria-label="Delete all entries"
                        loading={delAll.isPending}
                        onClick={confirmDeleteAll.open}
                      />
                    }
                  >
                    Delete all
                  </Tooltip>
                  <Tooltip
                    trigger={
                      <IconButton
                        size="md"
                        intent="gray-outline"
                        icon={<BiSelectMultiple />}
                        aria-label="Select entries"
                        disabled={entries.length === 0}
                        onClick={() => setSelectMode(true)}
                      />
                    }
                  >
                    Select
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <DashboardQueryBoundary query={query} errorTitle="Failed to load library">
        {(d) =>
          d.entries.length === 0 ? (
            <Card className="p-6 text-center text-sm text-[--muted]">
              {search.trim()
                ? 'No entries match your search.'
                : 'No entries for this filter.'}
            </Card>
          ) : (
            <div
              className={cn(
                effectiveView === 'grid'
                  ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5'
                  : 'flex flex-col gap-2'
              )}
            >
              {d.entries.map((e) => (
                <EntryCard
                  key={e.nzbHash}
                  entry={e}
                  view={effectiveView}
                  selectMode={selectMode}
                  selected={selected.has(e.nzbHash)}
                  onToggleSelect={toggleSelect}
                  onBrowse={setBrowse}
                  onInfo={setInfo}
                  onBlock={onBlock}
                  onRequeue={onRequeue}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )
        }
      </DashboardQueryBoundary>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[--muted] tabular-nums">
            Showing {(page - 1) * PAGE_SIZE + (entries.length > 0 ? 1 : 0)}–
            {Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <Pagination>
            <PaginationTrigger
              direction="previous"
              isDisabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            />
            {pageWindow(page, totalPages).map((p, i) =>
              p === '…' ? (
                <PaginationEllipsis key={`e${i}`} />
              ) : (
                <PaginationItem
                  key={p}
                  value={p}
                  data-selected={p === page}
                  onClick={() => setPage(p)}
                />
              )
            )}
            <PaginationTrigger
              direction="next"
              isDisabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          </Pagination>
        </div>
      )}

      <NzbBrowser
        hash={browse?.nzbHash ?? null}
        name={browse?.name}
        open={browse !== null}
        onOpenChange={(o) => !o && setBrowse(null)}
      />
      <EntryInfoModal
        entry={info}
        open={info !== null}
        onOpenChange={(o) => !o && setInfo(null)}
      />
      <ConfirmationDialog {...confirm} />
      <ConfirmationDialog {...confirmDeleteAll} />
      <ConfirmationDialog {...confirmBlock} />
    </div>
  );
}
