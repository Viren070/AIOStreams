import React from 'react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import {
  BiBlock,
  BiCopy,
  BiDownload,
  BiPencil,
  BiPlus,
  BiRefresh,
  BiShareAlt,
  BiTrash,
  BiUpload,
} from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { SimpleDropzone } from '@/components/ui/simple-dropzone';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/utils/clipboard';
import { useStatus } from '@/context/status';
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
  const [shareOpen, setShareOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BlocklistSource>();
  const [pendingDelete, setPendingDelete] = React.useState<BlocklistSource>();
  const [pendingClear, setPendingClear] = React.useState<BlocklistSource>();

  const patchSource = useMutation({
    mutationFn: (args: { id: string; body: Record<string, unknown> }) =>
      api(`PATCH /dashboard/blocklist/sources/${args.id}`, { body: args.body }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? 'Update failed'),
  });

  const refreshSource = useMutation({
    mutationFn: (id: string) =>
      api(`POST /dashboard/blocklist/sources/${id}/refresh`, { body: {} }),
    onSuccess: () => {
      toast.success('Source refreshed');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Refresh failed'),
  });

  const deleteSource = useMutation({
    mutationFn: (id: string) =>
      api(`DELETE /dashboard/blocklist/sources/${id}`),
    onSuccess: () => {
      toast.success('Source removed');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Delete failed'),
  });

  const clearSource = useMutation({
    mutationFn: (id: string) =>
      api(`POST /dashboard/blocklist/sources/${id}/clear`, { body: {} }),
    onSuccess: () => {
      toast.success('Source cleared');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Clear failed'),
  });

  const confirmDelete = useConfirmationDialog({
    title: 'Remove source',
    description:
      'This removes the source and every entry it contributed. This cannot be undone.',
    actionText: 'Remove',
    actionIntent: 'alert-subtle',
    onConfirm: () => pendingDelete && deleteSource.mutate(pendingDelete.id),
  });

  const confirmClear = useConfirmationDialog({
    title: 'Clear source entries',
    description:
      'This removes every entry this source contributed but keeps the source itself.',
    actionText: 'Clear',
    actionIntent: 'alert-subtle',
    onConfirm: () => pendingClear && clearSource.mutate(pendingClear.id),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
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
        <Button
          size="sm"
          intent="gray-outline"
          leftIcon={<BiShareAlt />}
          onClick={() => setShareOpen(true)}
        >
          Share this list
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[--muted] text-xs uppercase bg-[--subtle]/40">
              <tr className="text-left">
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
                  className="border-t border-[--border]/50 hover:bg-[--subtle]/30"
                >
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
                      : '—'}
                  </td>
                  <td
                    className="p-3 text-xs text-[--muted] max-w-[220px] truncate"
                    title={source.status ?? undefined}
                  >
                    {source.status ?? '—'}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {source.count}
                  </td>
                  <td className="p-3">
                    {source.kind === 'local' ? (
                      '—'
                    ) : (
                      <Switch
                        value={source.enabled}
                        onValueChange={(enabled) =>
                          patchSource.mutate({
                            id: source.id,
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
                            refreshSource.isPending &&
                            refreshSource.variables === source.id
                          }
                          onClick={() => refreshSource.mutate(source.id)}
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
                        onClick={() => {
                          setPendingClear(source);
                          confirmClear.open();
                        }}
                      />
                      {source.kind !== 'local' && (
                        <IconButton
                          size="sm"
                          intent="alert-subtle"
                          icon={<BiTrash />}
                          aria-label="Remove source"
                          onClick={() => {
                            setPendingDelete(source);
                            confirmDelete.open();
                          }}
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
      <ShareModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        settings={snapshot.settings}
      />
      {editing && (
        <EditSourceModal
          source={editing}
          onClose={() => setEditing(undefined)}
          invalidate={invalidate}
        />
      )}
      <ConfirmationDialog {...confirmDelete} />
      <ConfirmationDialog {...confirmClear} />
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
      return api(`PATCH /dashboard/blocklist/sources/${source.id}`, { body });
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
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [trust, setTrust] = React.useState<Trust>('full');
  const [refreshHours, setRefreshHours] = React.useState(24);

  const subscribe = useMutation({
    mutationFn: () =>
      api('POST /dashboard/blocklist/sources/remote', {
        body: {
          url: url.trim(),
          name: name.trim() || undefined,
          trust,
          refreshSeconds: Math.round(refreshHours * 3600),
        },
      }),
    onSuccess: () => {
      toast.success('Subscribed');
      onOpenChange(false);
      setUrl('');
      setName('');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Subscribe failed'),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Subscribe to a blocklist"
      description="Any URL serving a blocklist or Warden NDJSON list, e.g. another instance's /blocklist/export."
    >
      <div className="space-y-3">
        <TextInput
          label="URL"
          placeholder="https://example.com/blocklist/export"
          value={url}
          onValueChange={setUrl}
        />
        <TextInput
          label="Name (optional)"
          placeholder="Community list"
          value={name}
          onValueChange={setName}
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
            disabled={!url.trim()}
            onClick={() => subscribe.mutate()}
          >
            Subscribe
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
            { label: 'This instance’s own verdicts', value: 'local' },
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

function ShareModal({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Snapshot['settings'];
}) {
  const { status } = useStatus();
  const [scope, setScope] = React.useState<'local' | 'all'>('local');
  const [wardenCompatible, setWardenCompatible] = React.useState(false);

  const baseUrl = status?.settings?.baseUrl || window.location.origin;
  const params = new URLSearchParams();
  if (settings.publicExportPassword) {
    params.set('key', settings.publicExportPassword);
  }
  if (scope === 'all') params.set('scope', 'all');
  if (wardenCompatible) params.set('format', 'warden');
  const query = params.toString();
  const url = `${baseUrl}/blocklist/export${query ? `?${query}` : ''}`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Share this list"
      description="Other instances can subscribe to this URL and stay in sync as your list changes."
    >
      {settings.publicExport ? (
        <div className="space-y-3">
          <Select
            label="Scope"
            options={[
              { label: 'This instance’s own verdicts', value: 'local' },
              ...(settings.publicExportScope === 'all'
                ? [
                    {
                      label: 'Everything (all sources, deduplicated)',
                      value: 'all',
                    },
                  ]
                : []),
            ]}
            value={scope}
            onValueChange={(v) => setScope(v as 'local' | 'all')}
            help={
              settings.publicExportScope === 'all'
                ? undefined
                : 'This instance only publishes its own verdicts; the scope can be raised under Settings → Release Blocklist.'
            }
          />
          <Switch
            label="Warden-compatible format"
            value={wardenCompatible}
            onValueChange={setWardenCompatible}
            help="For davex. Carries only dead usenet fingerprints; content-hash and torrent entries are left out."
          />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[--muted] ml-1">
              Subscribe URL
            </label>
            <div className="flex items-center gap-2">
              <TextInput
                type="text"
                readOnly
                value={url}
                className="flex-1 font-mono text-sm bg-black/20"
                onClick={(e) => e.currentTarget.select()}
              />
              <Button
                intent="primary"
                className="shrink-0 px-3"
                aria-label="Copy subscribe URL"
                onClick={() =>
                  copyToClipboard(url, {
                    onSuccess: () => toast.success('Copied to clipboard'),
                    onError: () => toast.error('Failed to copy'),
                  })
                }
              >
                <BiCopy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[--muted]">
          Public sharing is disabled on this instance. Enable the public export
          endpoint under Settings → Release Blocklist to get a shareable URL.
        </p>
      )}
    </Modal>
  );
}
