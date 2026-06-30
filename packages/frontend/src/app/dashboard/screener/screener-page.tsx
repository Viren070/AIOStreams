import React from 'react';
import { toast } from 'sonner';
import {
  BiCloudDownload,
  BiImport,
  BiExport,
  BiRefresh,
  BiTrash,
  BiEraser,
} from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import {
  useConfirmationDialog,
  ConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/select';
import { TextInput } from '@/components/ui/text-input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { cn } from '@/components/ui/core/styling';
import {
  useScreener,
  useAddRemoteSource,
  useUpdateSource,
  useRemoveSource,
  useRefreshSource,
  useImportList,
  exportUrl,
  type ScreenerSource,
  type Trust,
} from './queries';

const TRUST_OPTIONS = [
  { value: 'full', label: 'full · filters on its own' },
  { value: 'corroborate', label: 'corroborate · needs agreement' },
  { value: 'observe', label: 'observe · never filters' },
];

function ago(sec: number): string {
  if (!sec) return 'never';
  const d = Date.now() / 1000 - sec;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

function KindBadge({ kind }: { kind: ScreenerSource['kind'] }) {
  const label = kind === 'local' ? 'Local' : kind === 'remote' ? 'Remote' : 'Imported';
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        kind === 'local' && 'bg-brand/15 text-brand',
        kind === 'remote' && 'bg-[--subtle] text-[--muted]',
        kind === 'imported' && 'border border-[--border] text-[--muted]'
      )}
    >
      {label}
    </span>
  );
}

function SourceRow({ source }: { source: ScreenerSource }) {
  const isLocal = source.kind === 'local';
  const update = useUpdateSource();
  const remove = useRemoveSource();
  const refresh = useRefreshSource();
  const busy = update.isPending || remove.isPending || refresh.isPending;
  const statusErr = (source.status ?? '').startsWith('error');

  const onRefresh = async () => {
    try {
      const data = await refresh.mutateAsync(source.id);
      const s = (data as { status?: string }).status ?? 'ok';
      toast[s.startsWith('error') ? 'error' : 'success'](`Refresh: ${s}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const onRemove = async (clear: boolean) => {
    try {
      await remove.mutateAsync({ id: source.id, clear });
      toast.success(clear ? `Cleared “${source.name}”.` : `Removed “${source.name}”.`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const confirmClear = useConfirmationDialog({
    title: 'Clear source',
    description: `Remove all ${source.count} entries from “${source.name}”? This can’t be undone.`,
    actionText: 'Clear',
    actionIntent: 'alert-subtle',
    onConfirm: () => void onRemove(true),
  });
  const confirmRemove = useConfirmationDialog({
    title: 'Remove source',
    description: `Remove “${source.name}” and all its entries? This can’t be undone.`,
    actionText: 'Remove',
    actionIntent: 'alert-subtle',
    onConfirm: () => void onRemove(false),
  });

  return (
    <Card className={cn('p-4 space-y-3', !source.enabled && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{source.name}</span>
            <KindBadge kind={source.kind} />
          </div>
          {source.url && (
            <div className="text-xs text-[--muted] truncate font-mono">{source.url}</div>
          )}
          <div className="text-xs text-[--muted] mt-1">
            {source.count.toLocaleString()} entries
            {source.kind === 'remote' && (
              <>
                {' · '}
                <span className={cn(statusErr && 'text-[--alert]')}>
                  updated {ago(source.lastUpdated)}
                  {source.status ? ` · ${source.status}` : ''}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {source.kind === 'remote' && (
            <Button
              size="sm"
              intent="primary-outline"
              disabled={busy}
              leftIcon={<BiRefresh />}
              onClick={onRefresh}
            >
              Refresh
            </Button>
          )}
          <Button
            size="sm"
            intent="warning-subtle"
            disabled={busy || source.count === 0}
            leftIcon={<BiEraser />}
            onClick={() => confirmClear.open()}
          >
            Clear
          </Button>
          {!isLocal && (
            <Button
              size="sm"
              intent="alert-subtle"
              disabled={busy}
              leftIcon={<BiTrash />}
              onClick={() => confirmRemove.open()}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <ConfirmationDialog {...confirmClear} />
      {!isLocal && <ConfirmationDialog {...confirmRemove} />}

      {!isLocal && (
        <div className="flex flex-wrap items-center gap-4">
          <div className="w-64">
            <Select
              size="sm"
              value={source.trust}
              options={TRUST_OPTIONS}
              disabled={busy}
              onValueChange={(v) =>
                update
                  .mutateAsync({ id: source.id, trust: v as Trust })
                  .catch((e) => toast.error(errMsg(e)))
              }
            />
          </div>
          <Switch
            label="Enabled"
            value={source.enabled}
            disabled={busy}
            onValueChange={(v) =>
              update
                .mutateAsync({ id: source.id, enabled: v })
                .catch((e) => toast.error(errMsg(e)))
            }
          />
        </div>
      )}
      {isLocal && (
        <div className="text-xs text-[--muted]">
          Trust: full · always on. Fills in automatically from this instance.
        </div>
      )}
    </Card>
  );
}

function AddRemoteModal() {
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [trust, setTrust] = React.useState<Trust>('corroborate');
  const [refreshHours, setRefreshHours] = React.useState(24);
  const add = useAddRemoteSource();

  const submit = async () => {
    try {
      const data = await add.mutateAsync({ url: url.trim(), name: name.trim() || undefined, trust, refreshHours });
      const status = (data as { status?: string }).status ?? 'added';
      toast[status.startsWith('error') ? 'error' : 'success'](`Remote list: ${status}`);
      setOpen(false);
      setUrl('');
      setName('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Add a remote list"
      trigger={<Button intent="primary" leftIcon={<BiCloudDownload />}>Add remote list</Button>}
    >
      <div className="space-y-4">
        <TextInput
          label="List URL"
          value={url}
          onValueChange={setUrl}
          placeholder="https://raw.githubusercontent.com/…/screener.ndjson.gz"
        />
        <TextInput
          label="Name (optional)"
          value={name}
          onValueChange={setName}
          placeholder="Community list"
        />
        <div className="flex gap-4">
          <div className="flex-1">
            <Select
              label="Trust"
              value={trust}
              options={TRUST_OPTIONS}
              onValueChange={(v) => setTrust(v as Trust)}
            />
          </div>
          <div className="w-32">
            <NumberInput
              label="Refresh (h)"
              value={refreshHours}
              min={1}
              max={720}
              onValueChange={(n) => setRefreshHours(n || 24)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button intent="primary-outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button intent="primary" loading={add.isPending} disabled={!url.trim()} onClick={submit}>
            Add &amp; fetch
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal() {
  const [open, setOpen] = React.useState(false);
  const [content, setContent] = React.useState('');
  const [target, setTarget] = React.useState<'merge' | 'separate'>('separate');
  const [name, setName] = React.useState('');
  const [trust, setTrust] = React.useState<Trust>('corroborate');
  const importList = useImportList();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Drop any previously loaded text up front so a failed read can't leave
    // stale content behind to be submitted.
    setContent('');
    try {
      const isGz =
        file.name.toLowerCase().endsWith('.gz') ||
        file.type === 'application/gzip';
      // Decompress .gz (e.g. an nzbdavex export) client-side before sending the
      // plain NDJSON text the import endpoint expects.
      const text = isGz
        ? await new Response(
            file.stream().pipeThrough(new DecompressionStream('gzip'))
          ).text()
        : await file.text();
      setContent(text);
    } catch {
      toast.error('Could not read that file.');
    }
  };

  const submit = async () => {
    try {
      const data = await importList.mutateAsync({
        content,
        target,
        name: name.trim() || undefined,
        trust,
      });
      const { added, invalid } = data as { added: number; invalid: number };
      toast.success(
        `Imported ${added.toLocaleString()} entr${added === 1 ? 'y' : 'ies'}${invalid ? ` · ${invalid} skipped` : ''}.`
      );
      setOpen(false);
      setContent('');
      setName('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Import a list"
      trigger={<Button intent="primary-outline" leftIcon={<BiImport />}>Import</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-[--muted]">
          Paste an NDJSON list (aiostreams or nzbdavex/warden format) or choose a file.
        </p>
        <Textarea
          label="Entries"
          value={content}
          onValueChange={setContent}
          rows={6}
          placeholder={'{"k":"btih:…","v":"dead","n":1,"at":1719705600}'}
        />
        <input
          type="file"
          aria-label="Choose a list file to import"
          accept=".ndjson,.json,.txt,.gz"
          onChange={onFile}
          className="text-sm text-[--muted]"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            intent={target === 'separate' ? 'primary' : 'primary-outline'}
            onClick={() => setTarget('separate')}
          >
            Keep as a source
          </Button>
          <Button
            size="sm"
            intent={target === 'merge' ? 'primary' : 'primary-outline'}
            onClick={() => setTarget('merge')}
          >
            Merge into local
          </Button>
        </div>
        {target === 'separate' && (
          <div className="flex gap-4">
            <div className="flex-1">
              <TextInput label="Name" value={name} onValueChange={setName} placeholder="Imported list" />
            </div>
            <div className="w-44">
              <Select
                label="Trust"
                value={trust}
                options={TRUST_OPTIONS}
                onValueChange={(v) => setTrust(v as Trust)}
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button intent="primary-outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button intent="primary" loading={importList.isPending} disabled={!content.trim()} onClick={submit}>
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ExportModal() {
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<'local' | 'all'>('local');
  const [format, setFormat] = React.useState<'native' | 'davex'>('native');

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Export"
      trigger={<Button intent="primary-outline" leftIcon={<BiExport />}>Export</Button>}
    >
      <div className="space-y-4">
        <Select
          label="What to export"
          value={scope}
          options={[
            { value: 'local', label: 'My list only (clean, shareable)' },
            { value: 'all', label: 'Everything (all sources)' },
          ]}
          onValueChange={(v) => setScope(v as 'local' | 'all')}
        />
        <Select
          label="Format"
          value={format}
          options={[
            { value: 'native', label: 'aiostreams (all source types)' },
            { value: 'davex', label: 'nzbdavex / warden (dead usenet only)' },
          ]}
          onValueChange={(v) => setFormat(v as 'native' | 'davex')}
        />
        <div className="flex justify-end gap-2">
          <Button intent="primary-outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            intent="primary"
            leftIcon={<BiExport />}
            onClick={() => {
              window.location.href = exportUrl(scope, format, true);
              setOpen(false);
            }}
          >
            Download
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ScreenerPage() {
  const query = useScreener();

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Screener</h2>
          <p className="text-[--muted]">
            {query.data
              ? `${query.data.counts.total.toLocaleString()} entries across ${query.data.sources.length} source${query.data.sources.length === 1 ? '' : 's'}`
              : 'Community-shared filter of dead, fake, and mislabeled releases'}
          </p>
        </div>
        <div className="flex gap-2">
          <AddRemoteModal />
          <ImportModal />
          <ExportModal />
        </div>
      </div>

      <DashboardQueryBoundary query={query} errorTitle="Failed to load Screener">
        {(data) => (
          <div className="space-y-3">
            {data.sources.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </div>
        )}
      </DashboardQueryBoundary>
    </PageWrapper>
  );
}
