import React from 'react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import {
  BiBlock,
  BiDownload,
  BiPencil,
  BiPlus,
  BiRefresh,
  BiTrash,
  BiUpload,
} from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { Button, IconButton, type ButtonProps } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TextInput } from '@/components/ui/text-input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { SimpleDropzone } from '@/components/ui/simple-dropzone';
import { cn } from '@/components/ui/core/styling';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { api } from '@/lib/api';
import {
  Badge,
  KIND_BADGE,
  TRUST_BADGE,
  TRUSTS,
  formatInterval,
  useBlocklistSnapshot,
  useInvalidateBlocklist,
  type BlocklistSource,
  type Snapshot,
  type Trust,
} from './shared';

type SourceMutationResult = Snapshot & { affected: number; failed: number };

// A single confirmation dialog is driven by whichever action set this spec.
type ConfirmSpec = {
  title: string;
  description: React.ReactNode;
  actionText: string;
  actionIntent: ButtonProps['intent'];
  onConfirm: () => void;
};

export function BlocklistSourcesPage() {
  const snapshotQuery = useBlocklistSnapshot();
  const invalidate = useInvalidateBlocklist();

  return (
    <DashboardQueryBoundary
      query={snapshotQuery}
      errorTitle="Failed to load the blocklist"
    >
      {(snapshot) => (
        <SourcesView snapshot={snapshot} invalidate={invalidate} />
      )}
    </DashboardQueryBoundary>
  );
}

function SourcesView({
  snapshot,
  invalidate,
}: {
  snapshot: Snapshot;
  invalidate: () => void;
}) {
  const [subscribeOpen, setSubscribeOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BlocklistSource>();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [batchEditOpen, setBatchEditOpen] = React.useState(false);
  const [confirmSpec, setConfirmSpec] = React.useState<ConfirmSpec | null>(
    null
  );

  const sources = snapshot.sources;
  const nonLocalSources = sources.filter((s) => s.id !== 'local');
  // Local is selectable; actions that don't apply to it (remove, refresh,
  // enable/disable) skip it on the server, so the returned counts stay honest.
  const allSelected =
    sources.length > 0 && sources.every((s) => selectedIds.has(s.id));

  // Clear selection when the source list changes (subscribe, import, delete)
  const sourcesKey = sources
    .map((s) => s.id)
    .sort()
    .join(',');
  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [sourcesKey]);

  const removeSources = useMutation({
    mutationFn: (ids: string[]) =>
      api<SourceMutationResult>('POST /dashboard/blocklist/sources/remove', {
        body: { ids },
      }),
    onSuccess: (result) => {
      toast.success(
        `Removed ${result.affected} source${result.affected === 1 ? '' : 's'}`
      );
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Remove failed'),
  });

  const clearSources = useMutation({
    mutationFn: (ids: string[]) =>
      api<SourceMutationResult>('POST /dashboard/blocklist/sources/clear', {
        body: { ids },
      }),
    onSuccess: (result) => {
      toast.success(
        `Cleared ${result.affected} source${result.affected === 1 ? '' : 's'}`
      );
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Clear failed'),
  });

  const refreshSources = useMutation({
    mutationFn: (ids: string[]) =>
      api<SourceMutationResult>('POST /dashboard/blocklist/sources/refresh', {
        body: { ids },
      }),
    onSuccess: (result) => {
      toast.success(
        `Refreshed ${result.affected} source${result.affected === 1 ? '' : 's'}`
      );
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Refresh failed'),
  });

  const patchSources = useMutation({
    mutationFn: (args: { ids: string[]; body: Record<string, unknown> }) =>
      api<SourceMutationResult>('PATCH /dashboard/blocklist/sources', {
        body: { ids: args.ids, ...args.body },
      }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.message ?? 'Update failed'),
  });

  // Batch actions clear the selection on success; row actions do not.
  const clearAfter = { onSuccess: () => setSelectedIds(new Set()) };

  const confirm = useConfirmationDialog({
    title: confirmSpec?.title ?? '',
    description: confirmSpec?.description,
    actionText: confirmSpec?.actionText,
    actionIntent: confirmSpec?.actionIntent,
    onConfirm: () => confirmSpec?.onConfirm(),
  });
  const askConfirm = (spec: ConfirmSpec) => {
    setConfirmSpec(spec);
    confirm.open();
  };

  const count = (n: number) => `${n} source${n === 1 ? '' : 's'}`;

  const askRemoveSource = (source: BlocklistSource) =>
    askConfirm({
      title: 'Remove source',
      description:
        'This removes the source and every entry it contributed. This cannot be undone.',
      actionText: 'Remove',
      actionIntent: 'alert-subtle',
      onConfirm: () => removeSources.mutate([source.id]),
    });

  const askClearSource = (source: BlocklistSource) =>
    askConfirm({
      title: 'Clear source entries',
      description:
        'This removes every entry this source contributed but keeps the source itself.',
      actionText: 'Clear',
      actionIntent: 'alert-subtle',
      onConfirm: () => clearSources.mutate([source.id]),
    });

  const askBatchRemove = () =>
    askConfirm({
      title: 'Remove selected sources',
      description: `${count(selectedIds.size)} selected: the source and every entry it contributed will be removed. This cannot be undone. The local source is skipped.`,
      actionText: 'Remove all',
      actionIntent: 'alert-subtle',
      onConfirm: () => removeSources.mutate([...selectedIds], clearAfter),
    });

  const askBatchClear = () =>
    askConfirm({
      title: 'Clear entries from selected sources',
      description: `${count(selectedIds.size)} selected: entries are removed but the sources themselves are kept.`,
      actionText: 'Clear all',
      actionIntent: 'alert-subtle',
      onConfirm: () => clearSources.mutate([...selectedIds], clearAfter),
    });

  const askBatchRefresh = () =>
    askConfirm({
      title: 'Refresh selected sources',
      description: `${count(selectedIds.size)} selected: refetch their lists from their remote URLs now.`,
      actionText: 'Refresh all',
      actionIntent: 'primary-subtle',
      onConfirm: () => refreshSources.mutate([...selectedIds], clearAfter),
    });

  const askRemoveAllNonLocal = () =>
    askConfirm({
      title: 'Remove all non-local sources',
      description: `Remove every source except this instance's own list (${count(nonLocalSources.length)}). This cannot be undone.`,
      actionText: 'Remove all',
      actionIntent: 'alert-subtle',
      onConfirm: () =>
        removeSources.mutate(
          nonLocalSources.map((s) => s.id),
          clearAfter
        ),
    });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (checked: boolean | 'indeterminate') =>
    setSelectedIds(
      checked === true ? new Set(sources.map((s) => s.id)) : new Set()
    );

  const hasRemoteSelected = [...selectedIds].some(
    (id) => sources.find((s) => s.id === id)?.kind === 'remote'
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center min-h-9">
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<BiPlus />}
          onClick={() => setSubscribeOpen(true)}
        >
          Subscribe to a list
        </Button>
        <Button
          size="sm"
          intent="gray-outline"
          leftIcon={<BiUpload />}
          onClick={() => setImportOpen(true)}
        >
          Import
        </Button>
        <Button
          size="sm"
          intent="gray-outline"
          leftIcon={<BiDownload />}
          onClick={() => setExportOpen(true)}
        >
          Export
        </Button>
        <div className="relative flex flex-1 gap-2 items-center">
          <div
            className={cn(
              'flex flex-1 gap-2 items-center',
              selectedIds.size === 0 && 'invisible'
            )}
          >
            <span className="text-sm font-medium tabular-nums text-[--muted]">
              {selectedIds.size} selected
            </span>
            <div className="flex-1" />
            <IconButton
              size="sm"
              intent="gray-subtle"
              icon={<BiRefresh />}
              aria-label="Refresh selected"
              title="Refresh selected"
              loading={refreshSources.isPending}
              onClick={askBatchRefresh}
              disabled={!hasRemoteSelected}
            />
            <IconButton
              size="sm"
              intent="gray-subtle"
              icon={<BiPencil />}
              aria-label="Edit selected"
              title="Edit selected"
              onClick={() => setBatchEditOpen(true)}
            />
            <IconButton
              size="sm"
              intent="gray-subtle"
              icon={<BiBlock />}
              aria-label="Clear entries of selected"
              title="Clear entries of selected"
              loading={clearSources.isPending}
              onClick={askBatchClear}
            />
            <IconButton
              size="sm"
              intent="alert-subtle"
              icon={<BiTrash />}
              aria-label="Remove selected"
              title="Remove selected"
              loading={removeSources.isPending}
              onClick={askBatchRemove}
            />
          </div>
          {selectedIds.size === 0 && nonLocalSources.length > 0 && (
            <Button
              // hideTextOnSmallScreen
              size="sm"
              intent="alert-subtle"
              leftIcon={<BiTrash />}
              title="Remove all sources except the local one"
              loading={removeSources.isPending}
              onClick={askRemoveAllNonLocal}
              className="absolute right-0"
            >
              Remove all
            </Button>
          )}
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[--muted] text-xs uppercase bg-[--subtle]/40">
              <tr className="text-left">
                <th className="p-3 w-10">
                  {sources.length > 0 && (
                    <Checkbox
                      value={allSelected}
                      onValueChange={selectAll}
                      aria-label="Select all"
                    />
                  )}
                </th>
                <th className="p-3">Name</th>
                <th className="p-3">Kind</th>
                <th className="p-3">Trust</th>
                <th className="p-3">Refresh</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Entries</th>
                <th className="p-3">Enabled</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.sources.map((source) => (
                <tr
                  key={source.id}
                  className={cn(
                    'border-t border-[--border]/50',
                    selectedIds.has(source.id)
                      ? 'bg-[--accent]/5'
                      : 'hover:bg-[--subtle]/30'
                  )}
                >
                  <td className="p-3">
                    <Checkbox
                      value={selectedIds.has(source.id)}
                      onValueChange={() => toggleSelect(source.id)}
                      aria-label={`Select ${source.name}`}
                    />
                  </td>
                  <td className="p-3 font-medium">{source.name}</td>
                  <td className="p-3">
                    <Badge className={KIND_BADGE[source.kind]}>
                      {source.kind}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <Badge className={TRUST_BADGE[source.trust]}>
                      {source.trust}
                    </Badge>
                  </td>
                  <td className="p-3 tabular-nums">
                    {source.kind === 'remote'
                      ? formatInterval(source.refreshSeconds)
                      : '\u2014'}
                  </td>
                  <td
                    className="p-3 text-xs text-[--muted] max-w-[220px] truncate"
                    title={source.status ?? undefined}
                  >
                    {source.status ?? '\u2014'}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    <div>{source.count}</div>
                    {source.count > 0 && (
                      <div
                        className="text-xs text-[--muted]"
                        title="Entries no other source lists"
                      >
                        {source.uniqueCount} unique
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {source.kind === 'local' ? (
                      '\u2014'
                    ) : (
                      <Switch
                        value={source.enabled}
                        onValueChange={(enabled) =>
                          patchSources.mutate({
                            ids: [source.id],
                            body: { enabled },
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      {source.kind === 'remote' && (
                        <IconButton
                          size="sm"
                          intent="gray-subtle"
                          icon={<BiRefresh />}
                          aria-label="Refresh now"
                          loading={
                            refreshSources.isPending &&
                            refreshSources.variables?.length === 1 &&
                            refreshSources.variables[0] === source.id
                          }
                          onClick={() => refreshSources.mutate([source.id])}
                        />
                      )}
                      {source.kind !== 'local' && (
                        <IconButton
                          size="sm"
                          intent="gray-subtle"
                          icon={<BiPencil />}
                          aria-label="Edit source"
                          onClick={() => setEditing(source)}
                        />
                      )}
                      <IconButton
                        size="sm"
                        intent="gray-subtle"
                        icon={<BiBlock />}
                        aria-label="Clear entries"
                        loading={
                          clearSources.isPending &&
                          clearSources.variables?.length === 1 &&
                          clearSources.variables[0] === source.id
                        }
                        onClick={() => askClearSource(source)}
                      />
                      {source.kind !== 'local' && (
                        <IconButton
                          size="sm"
                          intent="alert-subtle"
                          icon={<BiTrash />}
                          aria-label="Remove source"
                          loading={
                            removeSources.isPending &&
                            removeSources.variables?.length === 1 &&
                            removeSources.variables[0] === source.id
                          }
                          onClick={() => askRemoveSource(source)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <SubscribeModal
        open={subscribeOpen}
        onOpenChange={setSubscribeOpen}
        invalidate={invalidate}
      />
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        invalidate={invalidate}
      />
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} />
      {editing && (
        <EditSourceModal
          source={editing}
          onClose={() => setEditing(undefined)}
          invalidate={invalidate}
        />
      )}
      {batchEditOpen && (
        <BatchEditSourceModal
          selectedIds={[...selectedIds]}
          sources={sources}
          onSave={(patch) =>
            patchSources.mutate(
              { ids: [...selectedIds], body: patch },
              {
                onSuccess: (result) => {
                  toast.success(
                    `Updated ${result.affected} source${result.affected === 1 ? '' : 's'}`
                  );
                  setSelectedIds(new Set());
                  setBatchEditOpen(false);
                },
              }
            )
          }
          loading={patchSources.isPending}
          onClose={() => setBatchEditOpen(false)}
        />
      )}
      <ConfirmationDialog {...confirm} />
    </div>
  );
}

function EditSourceModal({
  source,
  onClose,
  invalidate,
}: {
  source: BlocklistSource;
  onClose: () => void;
  invalidate: () => void;
}) {
  const [name, setName] = React.useState(source.name);
  const [url, setUrl] = React.useState('');
  const [trust, setTrust] = React.useState<Trust>(source.trust);
  const [refreshHours, setRefreshHours] = React.useState(
    Math.max(1, Math.round(source.refreshSeconds / 3600))
  );

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: name.trim() || source.name,
        trust,
      };
      if (source.kind === 'remote') {
        body.refreshSeconds = Math.round(refreshHours * 3600);
        if (url.trim()) body.url = url.trim();
      }
      return api('PATCH /dashboard/blocklist/sources', {
        body: { ids: [source.id], ...body },
      });
    },
    onSuccess: () => {
      toast.success('Source updated');
      onClose();
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Update failed'),
  });

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Edit "${source.name}"`}
    >
      <div className="space-y-3">
        <TextInput label="Name" value={name} onValueChange={setName} />
        {source.kind === 'remote' && (
          <TextInput
            label="URL"
            placeholder="(unchanged)"
            value={url}
            onValueChange={setUrl}
            help={
              source.url
                ? `Current: ${source.url}`
                : 'Leave blank to keep the current URL'
            }
          />
        )}
        <Select
          label="Trust"
          options={TRUSTS.map((t) => ({ label: t, value: t }))}
          value={trust}
          onValueChange={(v) => setTrust(v as Trust)}
          help="full filters on its own; corroborate needs the quorum; observe never filters"
        />
        {source.kind === 'remote' && (
          <NumberInput
            label="Refresh (hours)"
            value={refreshHours}
            min={1}
            max={720}
            onValueChange={(v) => setRefreshHours(v || 24)}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            intent="primary"
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SubscribeModal({
  open,
  onOpenChange,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invalidate: () => void;
}) {
  const [input, setInput] = React.useState('');
  const [trust, setTrust] = React.useState<Trust>('full');
  const [refreshHours, setRefreshHours] = React.useState(24);

  const urlCount = input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')).length;

  const subscribe = useMutation({
    mutationFn: () =>
      api<{ import: { added: number; skipped: number; errors: string[] } }>(
        'POST /dashboard/blocklist/sources/remote',
        {
          body: {
            input,
            trust,
            refreshSeconds: Math.round(refreshHours * 3600),
          },
        }
      ),
    onSuccess: ({ import: result }) => {
      const parts = [`${result.added} added`];
      if (result.skipped) parts.push(`${result.skipped} already present`);
      if (result.errors.length) parts.push(`${result.errors.length} failed`);
      toast.success(parts.join(', '));
      onOpenChange(false);
      setInput('');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Subscribe failed'),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Subscribe to blocklists"
      description="Any URL serving a blocklist or Warden NDJSON list, e.g. another instance's /blocklist/export. One URL per line."
    >
      <div className="space-y-3">
        <Textarea
          label="List URL(s)"
          placeholder="https://example.com/blocklist/export"
          rows={5}
          value={input}
          onValueChange={setInput}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Trust"
            options={TRUSTS.map((t) => ({ label: t, value: t }))}
            value={trust}
            onValueChange={(v) => setTrust(v as Trust)}
            help="full filters on its own; corroborate needs the quorum; observe never filters"
          />
          <NumberInput
            label="Refresh (hours)"
            value={refreshHours}
            min={1}
            max={720}
            onValueChange={(v) => setRefreshHours(v || 24)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            intent="primary"
            loading={subscribe.isPending}
            disabled={urlCount === 0}
            onClick={() => subscribe.mutate()}
          >
            {urlCount > 1 ? `Subscribe (${urlCount})` : 'Subscribe'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const LIST_ACCEPT = {
  'application/x-ndjson': ['.ndjson'],
  'application/json': ['.json'],
  'application/gzip': ['.gz'],
  'text/plain': ['.txt'],
} as const;

function ImportModal({
  open,
  onOpenChange,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invalidate: () => void;
}) {
  const [name, setName] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const body = await file.arrayBuffer();
      const params = new URLSearchParams();
      if (name.trim()) params.set('name', name.trim());
      const res = await fetch(
        `/api/v1/dashboard/blocklist/import?${params.toString()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
        }
      );
      const json = await res.json().catch(() => undefined);
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success('List imported');
      onOpenChange(false);
      setFile(null);
      setName('');
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Import a blocklist"
      description="Upload an NDJSON list (native or Warden format, .gz supported). Imports become their own source and never merge into your local list."
    >
      <div className="space-y-3">
        <TextInput
          label="Name (optional)"
          placeholder={`Import ${new Date().toISOString().slice(0, 10)}`}
          value={name}
          onValueChange={setName}
        />
        <SimpleDropzone
          accept={LIST_ACCEPT}
          className="min-h-[120px] w-full"
          dropzoneText="Drop a list file here, or click to choose"
          onValueChange={(files) => setFile(files[0] ?? null)}
          onDropRejected={(rejections) => {
            const names = rejections.map((r) => r.file.name);
            toast.error(
              names.length === 1
                ? `"${names[0]}" isn't a supported list file`
                : 'Drop a single .ndjson, .json, .gz or .txt file'
            );
          }}
        />
        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            intent="primary"
            loading={busy}
            disabled={!file}
            onClick={doImport}
          >
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ExportModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [wardenCompatible, setWardenCompatible] = React.useState(false);
  const [scope, setScope] = React.useState<'local' | 'all'>('local');

  const download = () => {
    const format = wardenCompatible ? 'warden' : 'native';
    const a = document.createElement('a');
    a.href = `/api/v1/dashboard/blocklist/export?format=${format}&scope=${scope}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Export the blocklist"
      description="Download the list as NDJSON, ready to be imported or subscribed to by another instance."
    >
      <div className="space-y-3">
        <Select
          label="Scope"
          options={[
            { label: "This instance's own verdicts", value: 'local' },
            { label: 'Everything (all sources, deduplicated)', value: 'all' },
          ]}
          value={scope}
          onValueChange={(v) => setScope(v as 'local' | 'all')}
        />
        <Switch
          label="Warden-compatible format"
          value={wardenCompatible}
          onValueChange={setWardenCompatible}
          help="For davex. Carries only dead usenet fingerprints; content-hash and torrent entries are left out."
        />
        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button intent="primary" leftIcon={<BiDownload />} onClick={download}>
            Download
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BatchEditSourceModal({
  selectedIds,
  sources,
  onSave,
  loading,
  onClose,
}: {
  selectedIds: string[];
  sources: BlocklistSource[];
  onSave: (body: Record<string, unknown>) => void;
  loading: boolean;
  onClose: () => void;
}) {
  const selected = sources.filter((s) => selectedIds.includes(s.id));
  const hasRemote = selected.some((s) => s.kind === 'remote');
  const [trust, setTrust] = React.useState<Trust | ''>('');
  const [refreshHours, setRefreshHours] = React.useState(24);
  const [refreshChanged, setRefreshChanged] = React.useState(false);
  const [enabled, setEnabled] = React.useState<boolean | ''>('');

  const buildPatch = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (trust) body.trust = trust;
    if (hasRemote && refreshChanged && refreshHours > 0) {
      body.refreshSeconds = Math.round(refreshHours * 3600);
    }
    if (enabled !== '') body.enabled = enabled;
    return body;
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Edit ${selectedIds.length} source${selectedIds.length === 1 ? '' : 's'}`}
      description="Set common fields for all selected sources. Blank fields are left unchanged."
    >
      <div className="space-y-3">
        <Select
          label="Trust"
          options={[
            { label: 'Leave unchanged', value: '' },
            ...TRUSTS.map((t) => ({ label: t, value: t })),
          ]}
          value={trust}
          onValueChange={(v) => setTrust(v as Trust | '')}
          help="full filters on its own; corroborate needs the quorum; observe never filters"
        />
        {hasRemote && (
          <NumberInput
            label="Refresh (hours)"
            value={refreshHours}
            min={1}
            max={720}
            onValueChange={(v) => {
              setRefreshHours(v || 24);
              setRefreshChanged(true);
            }}
            help="Only applies to remote sources"
          />
        )}
        <Select
          label="Enabled"
          options={[
            { label: 'Leave unchanged', value: '' },
            { label: 'Enable', value: 'true' },
            { label: 'Disable', value: 'false' },
          ]}
          value={enabled === '' ? '' : String(enabled)}
          onValueChange={(v) => setEnabled(v === '' ? '' : v === 'true')}
          help="Enable or disable the source. The local source cannot be disabled."
        />
        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            intent="primary"
            loading={loading}
            disabled={Object.keys(buildPatch()).length === 0}
            onClick={() => onSave(buildPatch())}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
