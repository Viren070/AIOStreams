import React from 'react';
import { toast } from 'sonner';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import {
  BiBlock,
  BiCheckShield,
  BiPlus,
  BiSearch,
  BiTrash,
} from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import {
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationTrigger,
  pageWindow,
} from '@/components/ui/pagination';
import { cn } from '@/components/ui/core/styling';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/utils/clipboard';
import {
  Badge,
  KIND_BADGE,
  VERDICT_BADGE,
  VERDICTS,
  formatUnix,
  useBlocklistSnapshot,
  useInvalidateBlocklist,
  type AggregatedEntry,
  type EntriesPage,
  type Snapshot,
  type Verdict,
} from './shared';

export function BlocklistEntriesPage() {
  const snapshotQuery = useBlocklistSnapshot();
  const invalidate = useInvalidateBlocklist();

  return (
    <DashboardQueryBoundary
      query={snapshotQuery}
      errorTitle="Failed to load the blocklist"
    >
      {(snapshot) => (
        <EntriesView snapshot={snapshot} invalidate={invalidate} />
      )}
    </DashboardQueryBoundary>
  );
}

function EntriesView({
  snapshot,
  invalidate,
}: {
  snapshot: Snapshot;
  invalidate: () => void;
}) {
  const [search, setSearch] = React.useState('');
  const [sourceId, setSourceId] = React.useState('');
  const [verdict, setVerdict] = React.useState('');
  const [kind, setKind] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [markOpen, setMarkOpen] = React.useState(false);
  const [backbonesFor, setBackbonesFor] = React.useState<AggregatedEntry>();

  const entriesQuery = useQuery({
    queryKey: [
      'dashboard',
      'blocklist',
      'entries',
      { search, sourceId, verdict, kind, page },
    ],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (search.trim()) params.set('search', search.trim());
      if (sourceId) params.set('source', sourceId);
      if (verdict) params.set('verdict', verdict);
      if (kind) params.set('kind', kind);
      return api<EntriesPage>(`/dashboard/blocklist/entries?${params}`);
    },
    // Keep the current page rendered while the next one loads, so paging
    // doesn't collapse the table and jump the scroll position to the top.
    placeholderData: keepPreviousData,
  });

  const unmark = useMutation({
    mutationFn: (key: string) =>
      api('POST /dashboard/blocklist/unmark', { body: { key } }),
    onSuccess: () => {
      toast.success('Release allowed on this instance');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const removeLocal = useMutation({
    mutationFn: (key: string) =>
      api(`DELETE /dashboard/blocklist/entries?key=${encodeURIComponent(key)}`),
    onSuccess: () => {
      toast.success('Verdict removed');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const clearOverride = useMutation({
    mutationFn: (key?: string) =>
      api(
        `DELETE /dashboard/blocklist/overrides${key ? `?key=${encodeURIComponent(key)}` : ''}`
      ),
    onSuccess: (_, key) => {
      toast.success(key ? 'Override cleared' : 'All overrides cleared');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const confirmClearOverrides = useConfirmationDialog({
    title: 'Clear all overrides',
    description: `Re-block every release this instance has allowed (${snapshot.counts.overrides} override${snapshot.counts.overrides === 1 ? '' : 's'}). Their remote verdicts start filtering again.`,
    actionText: 'Clear all',
    actionIntent: 'alert-subtle',
    onConfirm: () => clearOverride.mutate(undefined),
  });

  const data = entriesQuery.data;
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  const ANY = '__any__';
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-end">
        <TextInput
          leftIcon={<BiSearch />}
          placeholder="Search keys…"
          value={search}
          onValueChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          className="w-64"
        />
        <Select
          options={[
            { label: 'All sources', value: ANY },
            ...snapshot.sources.map((s) => ({ label: s.name, value: s.id })),
          ]}
          value={sourceId || ANY}
          onValueChange={(v) => {
            setSourceId(v === ANY ? '' : v);
            setPage(1);
          }}
        />
        <Select
          options={[
            { label: 'All verdicts', value: ANY },
            ...VERDICTS.map((v) => ({ label: v, value: v })),
          ]}
          value={verdict || ANY}
          onValueChange={(v) => {
            setVerdict(v === ANY ? '' : v);
            setPage(1);
          }}
        />
        <Select
          options={[
            { label: 'All kinds', value: ANY },
            { label: 'usenet', value: 'usenet' },
            { label: 'torrent', value: 'torrent' },
          ]}
          value={kind || ANY}
          onValueChange={(v) => {
            setKind(v === ANY ? '' : v);
            setPage(1);
          }}
        />
        <div className="flex-1" />
        {snapshot.counts.overrides > 0 && (
          <Button
            size="sm"
            intent="gray-outline"
            loading={
              clearOverride.isPending && clearOverride.variables === undefined
            }
            onClick={confirmClearOverrides.open}
            title="Overrides suppress remote verdicts for releases this instance proved working"
          >
            Clear all overrides ({snapshot.counts.overrides})
          </Button>
        )}
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<BiPlus />}
          onClick={() => setMarkOpen(true)}
        >
          Mark a release
        </Button>
      </div>

      <DashboardQueryBoundary
        query={entriesQuery}
        errorTitle="Failed to load entries"
      >
        {(page_) => (
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[--muted] text-xs uppercase bg-[--subtle]/40">
                  <tr className="text-left">
                    <th className="p-3">Key</th>
                    <th className="p-3">Kind</th>
                    <th className="p-3">Verdict</th>
                    <th className="p-3">Sources</th>
                    <th className="p-3">Backbones</th>
                    <th className="p-3">Last seen</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {page_.entries.length === 0 && (
                    <tr>
                      <td
                        className="p-6 text-center text-[--muted]"
                        colSpan={7}
                      >
                        No entries
                      </td>
                    </tr>
                  )}
                  {page_.entries.map((entry) => (
                    <tr
                      key={entry.key}
                      className="border-t border-[--border]/50 hover:bg-[--subtle]/30"
                    >
                      <td
                        className="p-3 font-mono text-xs max-w-[260px] truncate cursor-pointer"
                        title={`${entry.key} (click to copy)`}
                        onClick={() =>
                          void copyToClipboard(entry.key, {
                            onSuccess: () => toast.success('Key copied'),
                            onError: () => toast.error('Copy failed'),
                          })
                        }
                      >
                        {entry.key}
                      </td>
                      <td className="p-3">
                        <Badge className={KIND_BADGE[entry.kind]}>
                          {entry.kind}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Badge className={VERDICT_BADGE[entry.verdict]}>
                            {entry.verdict}
                          </Badge>
                          {entry.overridden && (
                            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                              allowed
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td
                        className="p-3 text-xs max-w-[200px] truncate"
                        title={entry.sources
                          .map((s) => `${s.name} (${s.verdict}, ${s.trust})`)
                          .join('\n')}
                      >
                        {entry.sources.map((s) => s.name).join(', ')}
                      </td>
                      <td
                        className={cn(
                          'p-3 text-xs text-[--muted] max-w-[180px] truncate',
                          entry.backbones.length > 0 &&
                            'cursor-pointer underline decoration-dotted'
                        )}
                        title={
                          entry.backbones.length > 0
                            ? 'Click for the full backbone scope'
                            : undefined
                        }
                        onClick={() =>
                          entry.backbones.length > 0 && setBackbonesFor(entry)
                        }
                      >
                        {entry.backbones.join(', ') || 'everywhere'}
                      </td>
                      <td className="p-3 text-xs tabular-nums whitespace-nowrap">
                        {formatUnix(entry.lastAt)}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end">
                          {entry.overridden ? (
                            <Button
                              size="sm"
                              intent="gray-subtle"
                              leftIcon={<BiBlock />}
                              loading={
                                clearOverride.isPending &&
                                clearOverride.variables === entry.key
                              }
                              onClick={() => clearOverride.mutate(entry.key)}
                              title="Remove the override so these verdicts filter again"
                            >
                              Re-block
                            </Button>
                          ) : entry.sources.some((s) => s.id !== 'local') ? (
                            <Button
                              size="sm"
                              intent="gray-subtle"
                              leftIcon={<BiCheckShield />}
                              loading={
                                unmark.isPending &&
                                unmark.variables === entry.key
                              }
                              onClick={() => unmark.mutate(entry.key)}
                              title="Remove any local verdict and suppress the remote ones"
                            >
                              Allow
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              intent="gray-subtle"
                              leftIcon={<BiTrash />}
                              loading={
                                removeLocal.isPending &&
                                removeLocal.variables === entry.key
                              }
                              onClick={() => removeLocal.mutate(entry.key)}
                              title="Delete this instance's verdict"
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-t border-[--border]/50 text-xs text-[--muted]">
              <span className="tabular-nums">
                Showing{' '}
                {(page_.page - 1) * page_.pageSize +
                  (page_.entries.length > 0 ? 1 : 0)}
                –{Math.min(page_.page * page_.pageSize, page_.total)} of{' '}
                {page_.total}
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
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  />
                </Pagination>
              )}
            </div>
          </Card>
        )}
      </DashboardQueryBoundary>

      {backbonesFor && (
        <Modal
          open
          onOpenChange={(open) => !open && setBackbonesFor(undefined)}
          title="Backbone scope"
          description={backbonesFor.key}
        >
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs uppercase text-[--muted] mb-1">
                Backbones
              </div>
              <div>{backbonesFor.backbones.join(', ') || 'everywhere'}</div>
            </div>
            <div className="space-y-2">
              <div className="text-xs uppercase text-[--muted]">
                As recorded per source
              </div>
              {backbonesFor.sources.map((s) => (
                <div key={s.id} className="text-xs">
                  <span className="font-medium">{s.name}</span>{' '}
                  <span className="text-[--muted]">
                    ({s.verdict}, seen {s.n}×)
                  </span>
                  <div className="font-mono text-[--muted]">
                    {s.backbones.join(', ') || 'no scope (applies everywhere)'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      <MarkModal
        open={markOpen}
        onOpenChange={setMarkOpen}
        invalidate={invalidate}
      />

      <ConfirmationDialog {...confirmClearOverrides} />
    </div>
  );
}

function MarkModal({
  open,
  onOpenChange,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invalidate: () => void;
}) {
  const [key, setKey] = React.useState('');
  const [verdict, setVerdict] = React.useState<Verdict>('dead');

  const mark = useMutation({
    mutationFn: () =>
      api('POST /dashboard/blocklist/mark', {
        body: { releases: [[key.trim()]], verdict },
      }),
    onSuccess: () => {
      toast.success('Release marked');
      onOpenChange(false);
      setKey('');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Mark failed'),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Mark a release"
      description="Add a verdict to this instance's own list. Torrents are keyed btih:<infohash>, usenet releases wd1:<fingerprint> or nh1:<nzb content hash>."
    >
      <div className="space-y-3">
        <TextInput
          label="Release key"
          placeholder="btih:… or wd1:…"
          value={key}
          onValueChange={setKey}
        />
        <Select
          label="Verdict"
          options={VERDICTS.map((v) => ({ label: v, value: v }))}
          value={verdict}
          onValueChange={(v) => setVerdict(v as Verdict)}
        />
        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            intent="primary"
            loading={mark.isPending}
            disabled={!key.trim()}
            onClick={() => mark.mutate()}
          >
            Mark
          </Button>
        </div>
      </div>
    </Modal>
  );
}
