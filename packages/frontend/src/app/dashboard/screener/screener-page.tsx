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
import { Combobox } from '@/components/ui/combobox';
import { TextInput } from '@/components/ui/text-input';
import { Textarea } from '@/components/ui/textarea';
import { parseDuration, formatDuration } from '@/lib/format';
import { cn } from '@/components/ui/core/styling';
import {
  useScreener,
  useAddRemoteSource,
  useUpdateSource,
  useRemoveSource,
  useRefreshSource,
  useImportList,
  useGitHubSync,
  useSetGitHubSync,
  useRunGitHubSync,
  useKnownBackbones,
  useSetScreenerSettings,
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

  const [refreshEvery, setRefreshEvery] = React.useState(() =>
    formatDuration(source.refreshSeconds)
  );

  const saveRefresh = () => {
    const ms = parseDuration(refreshEvery);
    if (ms == null) {
      toast.error('Enter a valid interval, e.g. 6h or 2d.');
      setRefreshEvery(formatDuration(source.refreshSeconds));
      return;
    }
    // Match the API's accepted range (1s–30d) and canonicalise the field
    // (e.g. "24h" -> "1d") so the user sees exactly what was stored.
    const seconds = Math.min(2592000, Math.max(1, Math.round(ms / 1000)));
    setRefreshEvery(formatDuration(seconds));
    if (seconds === source.refreshSeconds) return;
    update
      .mutateAsync({ id: source.id, refreshSeconds: seconds })
      .catch((e) => {
        toast.error(errMsg(e));
        setRefreshEvery(formatDuration(source.refreshSeconds));
      });
  };

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
      {source.url && (
        <div className="text-xs text-[--muted] break-all font-mono">
          {source.url}
        </div>
      )}
      <ConfirmationDialog {...confirmClear} />
      {!isLocal && <ConfirmationDialog {...confirmRemove} />}

      {!isLocal && (
        <div className="flex flex-wrap items-end gap-4">
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
          {source.kind === 'remote' && (
            <div className="w-32">
              <TextInput
                size="sm"
                label="Refresh every"
                value={refreshEvery}
                disabled={busy}
                onValueChange={setRefreshEvery}
                onBlur={saveRefresh}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </div>
          )}
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
  const [refreshEvery, setRefreshEvery] = React.useState('1d');
  const add = useAddRemoteSource();

  const refreshSeconds = React.useMemo(() => {
    const ms = parseDuration(refreshEvery);
    return ms == null ? null : Math.round(ms / 1000);
  }, [refreshEvery]);

  const submit = async () => {
    if (refreshSeconds == null) {
      toast.error('Enter a valid refresh interval, e.g. 6h or 2d.');
      return;
    }
    try {
      const data = await add.mutateAsync({ url: url.trim(), name: name.trim() || undefined, trust, refreshSeconds });
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
            <TextInput
              label="Refresh every"
              value={refreshEvery}
              onValueChange={setRefreshEvery}
              placeholder="1d"
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

function ScopeCard() {
  const query = useScreener();
  const known = useKnownBackbones();
  const save = useSetScreenerSettings();
  const settings = query.data?.settings;
  const [text, setText] = React.useState('');

  if (!settings) return null;

  const trusted = settings.trustedBackbones ?? [];
  const knownDomains = known.data ?? [];
  const typed = text.trim().toLowerCase();
  // Options MUST include every selected value: the combobox renders its chips by
  // looking selected values up in options, so anything missing here silently
  // disappears. Order: an "Add …" entry for a new typed domain, then the current
  // selections (incl. custom-typed ones), then the known backbones. Deduped.
  const seen = new Set<string>();
  const options: { label: string; value: string }[] = [];
  const addOption = (value: string, label?: string) => {
    if (value && !seen.has(value)) {
      seen.add(value);
      options.push({ label: label ?? value, value });
    }
  };
  if (typed && !knownDomains.includes(typed) && !trusted.includes(typed)) {
    addOption(typed, `Add "${typed}"`);
  }
  trusted.forEach((d) => addOption(d));
  knownDomains.forEach((d) => addOption(d));

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Backbone scope</h3>
          <p className="text-sm text-[--muted]">
            Only apply verdicts recorded on a backbone this instance uses, so a
            release that is dead on another backbone cannot hide one that still
            works for you.
          </p>
        </div>
        <Switch
          label="Enabled"
          value={settings.backboneScope}
          onValueChange={(v) => save.mutate({ backboneScope: v })}
        />
      </div>
      <Combobox
        label="Trusted backbones"
        help="Also apply verdicts from these provider domains under scope, for a reseller that shares your backbone. Pick one this instance has seen, or type a domain."
        emptyMessage="No backbones recorded yet. Type a domain to add one."
        placeholder="Select or type a domain..."
        multiple
        options={options}
        value={trusted}
        onValueChange={(v) => {
          // The combobox fires this on mount too; skip the redundant save.
          const same =
            v.length === trusted.length && v.every((d) => trusted.includes(d));
          if (!same) save.mutate({ trustedBackbones: v });
        }}
        onTextChange={setText}
        disabled={!settings.backboneScope}
      />
    </Card>
  );
}

function GitHubSyncCard() {
  const query = useGitHubSync();
  const save = useSetGitHubSync();
  const run = useRunGitHubSync();
  const cfg = query.data;

  const [owner, setOwner] = React.useState('');
  const [repo, setRepo] = React.useState('');
  const [branch, setBranch] = React.useState('main');
  const [path, setPath] = React.useState('screener.ndjson');
  const [format, setFormat] = React.useState<'native' | 'davex'>('native');
  const [scope, setScope] = React.useState<'local' | 'all'>('local');
  const [token, setToken] = React.useState('');
  const [enabled, setEnabled] = React.useState(false);
  const [intervalEvery, setIntervalEvery] = React.useState('');

  // Seed the form once from the stored config; don't clobber edits on refetch.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (!cfg || seeded.current) return;
    seeded.current = true;
    setOwner(cfg.owner);
    setRepo(cfg.repo);
    setBranch(cfg.branch);
    setPath(cfg.path);
    setFormat(cfg.format);
    setScope(cfg.scope);
    setEnabled(cfg.enabled);
    setIntervalEvery(
      cfg.intervalSeconds > 0 ? formatDuration(cfg.intervalSeconds) : ''
    );
  }, [cfg]);

  // Blank = manual (0); null = unparseable (blocks save).
  const intervalSeconds = React.useMemo(() => {
    const t = intervalEvery.trim();
    if (t === '') return 0;
    const ms = parseDuration(t);
    return ms == null ? null : Math.round(ms / 1000);
  }, [intervalEvery]);

  const draft = () => ({
    owner: owner.trim(),
    repo: repo.trim(),
    branch: branch.trim(),
    path: path.trim(),
    format,
    scope,
    enabled,
    intervalSeconds: intervalSeconds ?? 0,
    ...(token ? { token } : {}),
  });

  const onSave = async () => {
    if (intervalSeconds == null) {
      toast.error('Enter a valid auto-sync interval (e.g. 6h) or leave it blank.');
      return;
    }
    try {
      await save.mutateAsync(draft());
      setToken('');
      toast.success('GitHub sync settings saved.');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const onRun = async () => {
    if (intervalSeconds == null) {
      toast.error('Enter a valid auto-sync interval (e.g. 6h) or leave it blank.');
      return;
    }
    try {
      await save.mutateAsync(draft());
      setToken('');
      const data = await run.mutateAsync();
      const status = (data as { status?: string }).status ?? 'ok';
      toast[status.startsWith('error') ? 'error' : 'success'](
        `Sync: ${status}`
      );
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Remove a stored PAT (the API clears it on an explicit empty token).
  const onClearToken = async () => {
    try {
      await save.mutateAsync({ token: '' });
      setToken('');
      toast.success('Stored GitHub token cleared.');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">GitHub sync</h3>
          <p className="text-sm text-[--muted]">
            Publish your list to a repo so others can subscribe to its raw URL.
          </p>
        </div>
        <Switch label="Enabled" value={enabled} onValueChange={setEnabled} />
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[140px]">
          <TextInput label="Owner" value={owner} onValueChange={setOwner} placeholder="my-user" />
        </div>
        <div className="flex-1 min-w-[140px]">
          <TextInput label="Repo" value={repo} onValueChange={setRepo} placeholder="screener-lists" />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[120px]">
          <TextInput label="Branch" value={branch} onValueChange={setBranch} placeholder="main" />
        </div>
        <div className="flex-1 min-w-[160px]">
          <TextInput label="File path" value={path} onValueChange={setPath} placeholder="screener.ndjson" />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[140px]">
          <Select
            label="Format"
            value={format}
            options={[
              { value: 'native', label: 'native' },
              { value: 'davex', label: 'davex (warden)' },
            ]}
            onValueChange={(v) => setFormat(v as 'native' | 'davex')}
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <Select
            label="Scope"
            value={scope}
            options={[
              { value: 'local', label: 'local only' },
              { value: 'all', label: 'all sources' },
            ]}
            onValueChange={(v) => setScope(v as 'local' | 'all')}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <TextInput
            label="Auto-sync interval"
            value={intervalEvery}
            onValueChange={setIntervalEvery}
            placeholder="6h (blank = manual)"
          />
        </div>
        <p className="text-sm text-[--muted] pb-2">
          {intervalSeconds == null
            ? 'Enter a duration like 6h or 2d, or leave blank for manual.'
            : intervalSeconds > 0
              ? `Publishes automatically every ${formatDuration(intervalSeconds)}.`
              : 'Manual only. Set an interval above to auto-publish on a schedule.'}
        </p>
      </div>
      <TextInput
        label="Personal access token"
        type="password"
        value={token}
        onValueChange={setToken}
        placeholder={cfg?.hasToken ? '•••••••• (stored)' : 'ghp_…'}
      />
      {cfg?.hasToken && (
        <Button
          size="sm"
          intent="alert-subtle"
          loading={save.isPending}
          onClick={onClearToken}
        >
          Clear stored token
        </Button>
      )}
      {cfg?.rawUrl && (
        <p className="text-sm text-[--muted] break-all">
          Raw URL: <span className="text-[--foreground]">{cfg.rawUrl}</span>
        </p>
      )}
      {cfg?.lastStatus && (
        <p
          className={cn(
            'text-sm',
            cfg.lastStatus.startsWith('error') ? 'text-red-500' : 'text-[--muted]'
          )}
        >
          Last sync: {cfg.lastStatus} · {ago(cfg.lastSyncAt ?? 0)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          intent="primary-outline"
          loading={save.isPending}
          disabled={!cfg}
          onClick={onSave}
        >
          Save
        </Button>
        <Button
          intent="primary"
          leftIcon={<BiRefresh />}
          loading={run.isPending}
          disabled={!cfg || !owner.trim() || !repo.trim()}
          onClick={onRun}
        >
          Sync now
        </Button>
      </div>
    </Card>
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

      <ScopeCard />
      <GitHubSyncCard />
    </PageWrapper>
  );
}
