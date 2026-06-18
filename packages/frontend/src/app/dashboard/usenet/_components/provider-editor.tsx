import React from 'react';
import { toast } from 'sonner';
import {
  BiPlus,
  BiTrash,
  BiChevronUp,
  BiChevronDown,
  BiCheckCircle,
  BiErrorCircle,
  BiTestTube,
  BiTachometer,
} from 'react-icons/bi';
import { LuPower, LuPowerOff } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { Card } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { NumberInput } from '@/components/ui/number-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Switch } from '@/components/ui/switch';
import { BasicField } from '@/components/ui/basic-field';
import { cn } from '@/components/ui/core/styling';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import {
  PROVIDER_SECRET_MASK,
  useSaveProviders,
  useTestProvider,
  useSpeedTestProvider,
  type MaskedProvider,
  type ProviderTestResult,
  type ProviderSpeedTestResult,
} from '../queries';
import { formatSpeed } from '@/lib/format';

/** Client-side editable provider row. */
interface Draft {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  tlsSkipVerify: boolean;
  username: string;
  /** Empty string means "unchanged" when {@link Draft.hasPassword}. */
  password: string;
  hasPassword: boolean;
  maxConnections: number;
  /** NNTP pipeline depth (in-flight commands per connection); 1 = off. */
  pipelineDepth: number;
  isBackup: boolean;
  enabled: boolean;
  /**
   * Link this row into the load-balanced group of the row above it (shares the
   * group head's priority + backup tier). Always treated as `false` for row 0.
   * A maximal run of consecutive linked rows is one group whose providers split
   * load by free capacity instead of strictly cascading.
   */
  groupedWithAbove: boolean;
}

/** Small status pill (no Badge primitive exists in the UI kit). */
function Pill({
  intent,
  children,
}: {
  intent: 'success' | 'alert' | 'warning';
  children: React.ReactNode;
}) {
  const styles = {
    success: 'bg-emerald-500/15 text-emerald-500',
    alert: 'bg-red-500/15 text-red-500',
    warning: 'bg-orange-500/15 text-orange-500',
  }[intent];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        styles
      )}
    >
      {children}
    </span>
  );
}

function makeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `p_${Math.random().toString(36).slice(2)}`
  );
}

function fromMasked(p: MaskedProvider): Draft {
  return {
    id: p.id,
    name: p.name ?? '',
    host: p.host,
    port: p.port,
    tls: p.tls,
    tlsSkipVerify: p.tlsSkipVerify ?? false,
    username: p.username ?? '',
    password: '',
    hasPassword: p.hasPassword,
    maxConnections: p.maxConnections,
    pipelineDepth: p.pipelineDepth ?? 1,
    isBackup: p.isBackup ?? false,
    enabled: p.enabled !== false,
    // Reconstructed by {@link draftsFromProviders} from adjacent priorities.
    groupedWithAbove: false,
  };
}

/**
 * Build the editor's ordered draft list from the saved providers, reconstructing
 * load-balanced groups: providers are ordered by tier then priority, and a row is
 * linked to the one above it when they share the same priority AND backup tier
 * (i.e. they were saved as one group). Legacy configs with all-distinct
 * priorities reconstruct as no groups (each provider its own cascade step).
 */
function draftsFromProviders(providers: MaskedProvider[]): Draft[] {
  const ordered = providers
    .map((p, originalIndex) => ({ p, originalIndex }))
    .sort((a, b) => {
      const tier = (a.p.isBackup ? 1 : 0) - (b.p.isBackup ? 1 : 0);
      if (tier !== 0) return tier;
      if (a.p.priority !== b.p.priority) return a.p.priority - b.p.priority;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ p }) => p);
  return ordered.map((p, i) => {
    const prev = ordered[i - 1];
    const groupedWithAbove =
      i > 0 && prev.priority === p.priority && !!prev.isBackup === !!p.isBackup;
    return { ...fromMasked(p), groupedWithAbove };
  });
}

/**
 * Resolve each draft's effective `{ priority, isBackup }` from the grouping. A
 * group head opens a new priority and owns the group's backup tier; linked rows
 * inherit both, so equal priorities reach the engine (which load-balances them)
 * and a group never straddles the primary/backup split.
 */
function deriveGroups(
  drafts: Draft[]
): { priority: number; isBackup: boolean }[] {
  let priority = -1;
  let headIsBackup = false;
  return drafts.map((d, i) => {
    const linked = i > 0 && d.groupedWithAbove;
    if (!linked) {
      priority++;
      headIsBackup = d.isBackup;
    }
    return { priority, isBackup: headIsBackup };
  });
}

function emptyDraft(): Draft {
  return {
    id: makeId(),
    name: '',
    host: '',
    port: 563,
    tls: true,
    tlsSkipVerify: false,
    username: '',
    password: '',
    hasPassword: false,
    maxConnections: 10,
    pipelineDepth: 1,
    isBackup: false,
    enabled: true,
    groupedWithAbove: false,
  };
}

/**
 * Build the API payload for one draft. Priority and backup tier are group-derived
 * (see {@link deriveGroups}), not the raw row index, so linked rows share a
 * priority and the engine load-balances them.
 */
function toPayload(d: Draft, group: { priority: number; isBackup: boolean }) {
  const password = d.password
    ? d.password
    : d.hasPassword
      ? PROVIDER_SECRET_MASK
      : undefined;
  return {
    id: d.id,
    name: d.name || undefined,
    host: d.host.trim(),
    port: d.port,
    tls: d.tls,
    tlsSkipVerify: d.tlsSkipVerify || undefined,
    username: d.username || undefined,
    password,
    maxConnections: d.maxConnections,
    pipelineDepth: d.pipelineDepth > 1 ? d.pipelineDepth : undefined,
    priority: group.priority,
    isBackup: group.isBackup || undefined,
    enabled: d.enabled,
  };
}

export function ProviderEditor({ providers }: { providers: MaskedProvider[] }) {
  const [drafts, setDrafts] = React.useState<Draft[]>(() =>
    draftsFromProviders(providers)
  );
  // Effective priority + backup tier per row, derived from the grouping. Drives
  // the save payload, the connection test, and the per-row inherited-tier UI.
  const groups = React.useMemo(() => deriveGroups(drafts), [drafts]);
  const [tests, setTests] = React.useState<
    Record<string, ProviderTestResult | 'pending'>
  >({});
  const [speeds, setSpeeds] = React.useState<
    Record<string, ProviderSpeedTestResult | 'pending'>
  >({});
  const save = useSaveProviders();
  const test = useTestProvider();
  const speedTest = useSpeedTestProvider();
  // Only providers already persisted server-side can be speed-tested (the test
  // fetches articles via the saved connection config, resolved by id).
  const savedIds = React.useMemo(
    () => new Set(providers.map((p) => p.id)),
    [providers]
  );

  // Re-seed from server whenever the upstream list identity changes (after save
  // or refetch). Compared structurally so in-progress edits aren't clobbered by
  // a background refetch that returns the same data.
  const serverKey = React.useMemo(() => JSON.stringify(providers), [providers]);
  const seededKey = React.useRef(serverKey);
  React.useEffect(() => {
    if (serverKey !== seededKey.current) {
      seededKey.current = serverKey;
      setDrafts(draftsFromProviders(providers));
      setTests({});
      setSpeeds({});
    }
  }, [serverKey, providers]);

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const remove = (id: string) =>
    setDrafts((ds) => {
      const idx = ds.findIndex((d) => d.id === id);
      if (idx === -1) return ds;
      const removedWasHead = idx === 0 || !ds[idx].groupedWithAbove;
      const next = ds.filter((d) => d.id !== id);
      // Removing a group head would silently merge its members into the group
      // above; promote the first orphan to its own head instead.
      if (removedWasHead && next[idx]?.groupedWithAbove) {
        next[idx] = { ...next[idx], groupedWithAbove: false };
      }
      return next;
    });

  const move = (index: number, dir: -1 | 1) =>
    setDrafts((ds) => {
      const next = [...ds];
      const target = index + dir;
      if (target < 0 || target >= next.length) return ds;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const add = () => setDrafts((ds) => [...ds, emptyDraft()]);

  const runTest = async (d: Draft, index: number) => {
    setTests((t) => ({ ...t, [d.id]: 'pending' }));
    try {
      const result = await test.mutateAsync(
        toPayload(d, groups[index]) as Record<string, unknown>
      );
      setTests((t) => ({ ...t, [d.id]: result }));
      if (result.ok) {
        toast.success(
          `${d.name || d.host}: connected in ${result.latencyMs}ms`
        );
      } else {
        toast.error(`${d.name || d.host}: ${result.error ?? 'failed'}`);
      }
    } catch (e: any) {
      const result = { ok: false, error: e?.message ?? 'failed' };
      setTests((t) => ({ ...t, [d.id]: result }));
      toast.error(`${d.name || d.host}: ${result.error}`);
    }
  };

  const runSpeed = async (d: Draft) => {
    setSpeeds((s) => ({ ...s, [d.id]: 'pending' }));
    try {
      const result = await speedTest.mutateAsync(d.id);
      setSpeeds((s) => ({ ...s, [d.id]: result }));
      if (result.ok) {
        toast.success(
          `${d.name || d.host}: ${formatSpeed(result.bytesPerSec ?? 0)}`
        );
      } else {
        toast.error(
          `${d.name || d.host}: ${result.error ?? 'speed test failed'}`
        );
      }
    } catch (e: any) {
      const result = { ok: false, error: e?.message ?? 'failed' };
      setSpeeds((s) => ({ ...s, [d.id]: result }));
      toast.error(`${d.name || d.host}: ${result.error}`);
    }
  };

  const onSave = async () => {
    // Validate the basics client-side for friendlier errors.
    for (const d of drafts) {
      if (!d.host.trim()) {
        toast.error('Every provider needs a host.');
        return;
      }
    }
    try {
      await save.mutateAsync(drafts.map((d, i) => toPayload(d, groups[i])));
      toast.success('Providers saved.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to save providers');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">NNTP providers</h3>
          <p className="text-xs text-[--muted]">
            Order sets priority — groups are tried top to bottom. Link providers
            into a group to share a priority so they split load by free capacity
            instead of one sitting idle as failover. Mark metered block accounts
            as backups so they're only used when a primary misses an article.
          </p>
        </div>
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<BiPlus />}
          onClick={add}
        >
          Add provider
        </Button>
      </div>

      {drafts.length === 0 && (
        <Card className="p-6 text-center text-sm text-[--muted]">
          No providers configured yet. Add your first NNTP account to start
          streaming.
        </Card>
      )}

      <div className="space-y-3">
        {drafts.map((d, i) => (
          <ProviderRow
            key={d.id}
            draft={d}
            index={i}
            count={drafts.length}
            linkedAbove={d.groupedWithAbove}
            linkedBelow={
              i < drafts.length - 1 && drafts[i + 1].groupedWithAbove
            }
            effectiveIsBackup={groups[i].isBackup}
            testResult={tests[d.id]}
            speedResult={speeds[d.id]}
            canSpeedTest={savedIds.has(d.id)}
            onChange={(patch) => update(d.id, patch)}
            onRemove={() => remove(d.id)}
            onMove={(dir) => move(i, dir)}
            onTest={() => runTest(d, i)}
            onSpeedTest={() => runSpeed(d)}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <Button intent="primary" loading={save.isPending} onClick={onSave}>
          Save providers
        </Button>
      </div>
    </div>
  );
}

function StateBadge({ result }: { result?: ProviderTestResult | 'pending' }) {
  if (result === 'pending')
    return <span className="text-xs text-[--muted]">testing…</span>;
  if (!result) return null;
  return result.ok ? (
    <Pill intent="success">
      <BiCheckCircle /> {result.latencyMs}ms
    </Pill>
  ) : (
    <Pill intent="alert">
      <BiErrorCircle /> {result.code ?? 'failed'}
    </Pill>
  );
}

function SpeedBadge({
  result,
}: {
  result?: ProviderSpeedTestResult | 'pending';
}) {
  if (result === 'pending')
    return <span className="text-xs text-[--muted]">speed testing…</span>;
  if (!result) return null;
  if (!result.ok)
    return (
      <Pill intent="warning">
        <BiErrorCircle /> {result.code ?? 'failed'}
      </Pill>
    );
  const cfg =
    result.connectionsPerStream != null
      ? `${result.connectionsPerStream}×${result.pipelineDepth ?? 1} conns, pf ${result.prefetchSegments ?? 0}`
      : undefined;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Pill intent="success">
        <BiTachometer /> {formatSpeed(result.bytesPerSec ?? 0)}
      </Pill>
      {cfg ? (
        <span
          className="text-[10px] text-[--muted]"
          title={`Tested at ${result.connectionsPerStream} connections/stream × pipeline depth ${result.pipelineDepth}, prefetch ${result.prefetchSegments} segments`}
        >
          {cfg}
        </span>
      ) : null}
    </span>
  );
}

function ProviderRow({
  draft: d,
  index,
  count,
  linkedAbove,
  linkedBelow,
  effectiveIsBackup,
  testResult,
  speedResult,
  canSpeedTest,
  onChange,
  onRemove,
  onMove,
  onTest,
  onSpeedTest,
}: {
  draft: Draft;
  index: number;
  count: number;
  /** This row is linked into the group above it. */
  linkedAbove: boolean;
  /** The row below is linked into this row's group (so this row is a group head). */
  linkedBelow: boolean;
  /** Backup tier resolved from the group (inherited from the head when linked). */
  effectiveIsBackup: boolean;
  testResult?: ProviderTestResult | 'pending';
  speedResult?: ProviderSpeedTestResult | 'pending';
  canSpeedTest: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onTest: () => void;
  onSpeedTest: () => void;
}) {
  // Part of a multi-provider load-balanced group (either linked above, or a head
  // with a linked row below).
  const grouped = linkedAbove || linkedBelow;
  const pending = testResult === 'pending';
  const speedPending = speedResult === 'pending';
  const confirmDelete = useConfirmationDialog({
    title: 'Delete provider?',
    description: (
      <>
        Are you sure you want to remove{' '}
        <strong>{d.name || d.host || 'this provider'}</strong>?
      </>
    ),
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: onRemove,
  });
  return (
    <Card
      className={cn(
        'p-4 transition-opacity duration-300',
        !d.enabled && 'opacity-60',
        // Accent the left edge of grouped rows so a load-balanced group reads as
        // one block (linked rows share the head's priority + backup tier).
        grouped && 'border-l-2 border-l-[--brand]'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center pt-1">
          <IconButton
            size="xs"
            intent="gray-subtle"
            icon={<BiChevronUp />}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Move up"
          />
          <span className="text-xs text-[--muted] tabular-nums my-0.5">
            #{index + 1}
          </span>
          <IconButton
            size="xs"
            intent="gray-subtle"
            icon={<BiChevronDown />}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            aria-label="Move down"
          />
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[180px]">
              <span className="font-medium text-sm">
                {d.name || d.host || 'New provider'}
              </span>
              {effectiveIsBackup && <Pill intent="warning">backup</Pill>}
              {grouped && <Pill intent="success">load-balanced</Pill>}
              <StateBadge result={testResult} />
              <SpeedBadge result={speedResult} />
            </div>
            <Tooltip
              trigger={
                <IconButton
                  size="sm"
                  intent="gray-subtle"
                  icon={<BiTestTube />}
                  onClick={onTest}
                  loading={pending}
                  disabled={!d.host || pending}
                  aria-label="Test provider"
                />
              }
            >
              Test connection
            </Tooltip>
            <Tooltip
              trigger={
                <IconButton
                  size="sm"
                  intent="gray-subtle"
                  icon={<BiTachometer />}
                  onClick={onSpeedTest}
                  loading={speedPending}
                  disabled={!canSpeedTest || speedPending}
                  aria-label="Speed test provider"
                />
              }
            >
              {canSpeedTest
                ? 'Speed test (downloads from your library)'
                : 'Save the provider first to speed test'}
            </Tooltip>
            <Tooltip
              trigger={
                <IconButton
                  size="sm"
                  intent={d.enabled ? 'success-subtle' : 'gray-subtle'}
                  icon={d.enabled ? <LuPower /> : <LuPowerOff />}
                  className="transition-colors duration-300"
                  onClick={() => onChange({ enabled: !d.enabled })}
                  aria-label={
                    d.enabled ? 'Disable provider' : 'Enable provider'
                  }
                />
              }
            >
              {d.enabled
                ? 'Enabled — click to disable'
                : 'Disabled — click to enable'}
            </Tooltip>
            <Tooltip
              trigger={
                <IconButton
                  size="sm"
                  intent="alert-subtle"
                  icon={<BiTrash />}
                  onClick={confirmDelete.open}
                  aria-label="Remove provider"
                />
              }
            >
              Remove provider
            </Tooltip>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <BasicField label="Name">
              <TextInput
                value={d.name}
                placeholder="Friendly name"
                onValueChange={(v) => onChange({ name: v })}
              />
            </BasicField>
            <BasicField label="Host" className="lg:col-span-2">
              <TextInput
                value={d.host}
                placeholder="news.example.com"
                onValueChange={(v) => onChange({ host: v })}
              />
            </BasicField>

            <BasicField label="Port">
              <NumberInput
                value={d.port}
                min={1}
                max={65535}
                hideControls
                onValueChange={(v) => onChange({ port: v || 0 })}
              />
            </BasicField>
            <BasicField label="Max connections">
              <NumberInput
                value={d.maxConnections}
                min={1}
                onValueChange={(v) => onChange({ maxConnections: v || 1 })}
              />
            </BasicField>
            <BasicField
              label="Pipeline depth"
              help="In-flight requests per connection (NNTP pipelining). 1 = off. Higher hides latency so fewer connections saturate a fast link; falls back to 1 if the provider mishandles it."
            >
              <NumberInput
                value={d.pipelineDepth}
                min={1}
                max={20}
                onValueChange={(v) =>
                  onChange({ pipelineDepth: Math.min(20, Math.max(1, v || 1)) })
                }
              />
            </BasicField>

            <BasicField label="Username">
              <TextInput
                value={d.username}
                autoComplete="off"
                onValueChange={(v) => onChange({ username: v })}
              />
            </BasicField>
            <BasicField label="Password" className="lg:col-span-2">
              <PasswordInput
                value={d.password}
                autoComplete="off"
                placeholder={d.hasPassword ? '•••••••• (unchanged)' : ''}
                onValueChange={(v) => onChange({ password: v })}
              />
            </BasicField>
          </div>

          {/* Toggles grouped together so they read as one set of options.
              (Enabled lives as the power icon button in the header row.) */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-[--border]/60 px-3 py-2.5">
            <Switch
              value={d.tls}
              onValueChange={(v) => onChange({ tls: v })}
              label="SSL/TLS"
              side="right"
            />
            {index > 0 && (
              <Switch
                value={d.groupedWithAbove}
                onValueChange={(v) => onChange({ groupedWithAbove: v })}
                label="Group with above"
                moreHelp="Share the priority of the provider above and split load across
                the group (instead of strict failover)."
                side="right"
              />
            )}
            {linkedAbove ? (
              <span className="text-xs text-[--muted]">
                Backup: {effectiveIsBackup ? 'on' : 'off'} (from group)
              </span>
            ) : (
              <Switch
                value={d.isBackup}
                onValueChange={(v) => onChange({ isBackup: v })}
                label="Backup"
                side="right"
              />
            )}
            <Switch
              value={d.tlsSkipVerify}
              onValueChange={(v) => onChange({ tlsSkipVerify: v })}
              label="Skip TLS verify"
              side="right"
            />
          </div>
        </div>
      </div>
      <ConfirmationDialog {...confirmDelete} />
    </Card>
  );
}
