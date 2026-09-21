import React from 'react';
import { toast } from 'sonner';
import { BiSearch, BiTrash } from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { TextInput } from '@/components/ui/text-input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationTrigger,
  pageWindow,
} from '@/components/ui/pagination';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { cn } from '@/components/ui/core/styling';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { formatBytes, formatClock } from '@/lib/format';
import {
  useDeleteStreamHistory,
  useStreamHistory,
  type StreamEndReason,
  type StreamTransport,
} from './queries';
import {
  ClientIpPill,
  Pill,
  TransportBadge,
  displayUser,
  relativeTime,
} from './_components/shared';

const PAGE_SIZE = 50;

/**
 * How a watch ended. `idle` is the ordinary ending and gets no badge; the tone
 * separates being cut off (red) from being interrupted (amber).
 */
const END_REASONS: Record<
  StreamEndReason,
  { label: string; className?: string }
> = {
  idle: { label: 'Finished' },
  stopped: {
    label: 'Stopped',
    className: 'border-orange-400/40 bg-orange-500/10 text-orange-300',
  },
  banned: {
    label: 'Blocked',
    className: 'border-red-400/40 bg-red-500/10 text-red-200',
  },
  limit: {
    label: 'Limit reached',
    className: 'border-red-400/40 bg-red-500/10 text-red-200',
  },
  error: {
    label: 'Error',
    className: 'border-red-400/40 bg-red-500/10 text-red-200',
  },
  stale: {
    label: 'Interrupted',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
};

const TRANSPORT_OPTIONS = [
  { label: 'All types', value: 'all' },
  { label: 'Usenet', value: 'usenet' },
  { label: 'Proxy', value: 'proxy' },
];

/**
 * Finished watches, newest first. Rows are append-only: re-watching a title
 * adds a row rather than editing the old one.
 */
export function StreamsHistoryPage() {
  const [transport, setTransport] = React.useState<StreamTransport | 'all'>(
    'all'
  );
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [transport, search]);

  const query = useStreamHistory({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    transport: transport === 'all' ? '' : transport,
    search,
  });
  const remove = useDeleteStreamHistory();

  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const allOnPageSelected =
    entries.length > 0 && entries.every((e) => selected.has(e.id));

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) for (const e of entries) next.delete(e.id);
      else for (const e of entries) next.add(e.id);
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const run = (ids: string[] | undefined, label: string) =>
    remove
      .mutateAsync(ids)
      .then((res) => {
        toast.success(`${label} (${res.deleted})`);
        setSelected(new Set());
        setPage(1);
      })
      .catch((e: any) => toast.error(e?.message ?? 'Failed to delete'));

  const confirmClearAll = useConfirmationDialog({
    title: 'Clear stream history',
    description: `Delete all ${total} finished stream${total === 1 ? '' : 's'}. Bandwidth totals are stored separately and are not affected.`,
    actionText: 'Clear all',
    actionIntent: 'alert-subtle',
    onConfirm: () => void run(undefined, 'History cleared'),
  });

  const confirmClearSelected = useConfirmationDialog({
    title: 'Delete selected streams',
    description: `Delete ${selected.size} stream${selected.size === 1 ? '' : 's'} from the history. Bandwidth totals are not affected.`,
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: () => void run([...selected], 'Deleted'),
  });

  const hasSelection = selected.size > 0;

  return (
    <div className="space-y-4">
      {/* One fixed-height toolbar: the selection state swaps the label and the
          count in place rather than revealing a second bar that would shove
          the table down. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TextInput
          leftIcon={<BiSearch />}
          placeholder="Search title or URL…"
          value={search}
          onValueChange={setSearch}
          fieldClass="sm:flex-1 sm:min-w-0"
        />
        <Select
          value={transport}
          options={TRANSPORT_OPTIONS}
          onValueChange={(v) => setTransport(v as StreamTransport | 'all')}
          fieldClass="sm:w-40 sm:shrink-0"
        />
        <div className="flex items-center justify-between gap-2 sm:shrink-0">
          <span className="text-xs tabular-nums text-[--muted]">
            {hasSelection
              ? `${selected.size} selected`
              : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`}
          </span>
          <Button
            size="sm"
            intent="alert-subtle"
            leftIcon={<BiTrash />}
            loading={remove.isPending}
            disabled={total === 0 && !hasSelection}
            onClick={() =>
              hasSelection
                ? confirmClearSelected.open()
                : confirmClearAll.open()
            }
          >
            {hasSelection ? 'Delete selected' : 'Clear all'}
          </Button>
        </div>
      </div>

      <DashboardQueryBoundary
        query={query}
        errorTitle="Failed to load stream history"
      >
        {() =>
          entries.length === 0 ? (
            <Card className="p-8">
              <p className="text-center text-sm text-[--muted]">
                No finished streams
                {search || transport !== 'all' ? ' match this filter' : ' yet'}.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[--subtle]/40 text-xs uppercase text-[--muted]">
                    <tr className="text-left">
                      <th className="w-10 p-3">
                        <Checkbox
                          value={allOnPageSelected}
                          onValueChange={toggleAllOnPage}
                          aria-label="Select all on this page"
                        />
                      </th>
                      <th className="p-3">Stream</th>
                      <th className="p-3">User</th>
                      <th className="p-3 text-right">Served</th>
                      <th className="p-3 text-right">Reqs</th>
                      <th className="p-3 text-right">Duration</th>
                      <th className="p-3">Ended</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const reason = e.endReason
                        ? END_REASONS[e.endReason]
                        : undefined;
                      const isSelected = selected.has(e.id);
                      return (
                        <tr
                          key={e.id}
                          className={cn(
                            'border-t border-[--border]/50 hover:bg-[--subtle]/30',
                            isSelected && 'bg-brand/[0.06]'
                          )}
                        >
                          <td className="p-3">
                            <Checkbox
                              value={isSelected}
                              onValueChange={() => toggleOne(e.id)}
                              aria-label="Select stream"
                            />
                          </td>
                          <td className="max-w-[420px] p-3">
                            <div className="flex items-center gap-2">
                              <TransportBadge transport={e.transport} />
                              <span
                                className="truncate"
                                title={
                                  e.filename || e.displayUrl || e.targetKey
                                }
                              >
                                {e.filename || e.displayUrl || e.targetKey}
                              </span>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span>{displayUser(e.username)}</span>
                              {e.clientIp && <ClientIpPill ip={e.clientIp} />}
                            </div>
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {formatBytes(e.bytesServed)}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {e.requests}
                          </td>
                          <td className="p-3 text-right tabular-nums text-[--muted]">
                            {formatClock(
                              (e.endedAt ?? e.lastSeenAt) - e.startedAt
                            )}
                          </td>
                          <td className="p-3 text-xs text-[--muted]">
                            <div className="flex items-center gap-2">
                              {e.endedAt && (
                                <span className="whitespace-nowrap">
                                  {relativeTime(e.endedAt)}
                                </span>
                              )}
                              {reason?.className && (
                                <Pill className={reason.className}>
                                  {reason.label}
                                </Pill>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[--border]/50 p-3 text-xs text-[--muted]">
                <span className="tabular-nums">
                  Showing {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, total)} of {total}
                </span>
                {totalPages > 1 && (
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
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                    />
                  </Pagination>
                )}
              </div>
            </Card>
          )
        }
      </DashboardQueryBoundary>

      <ConfirmationDialog {...confirmClearAll} />
      <ConfirmationDialog {...confirmClearSelected} />
    </div>
  );
}
