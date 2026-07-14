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
   * Cascade rank and grouping key. Lower = tried first; providers that share a
   * priority form one load-balanced group (they split load by free capacity
   * instead of strictly cascading). Kept as contiguous 1-based group indices by
   * {@link normalize}, so the value the user sees is always 1, 2, 3…
   */
  priority: number;
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
    priority: p.priority,
  };
}

/**
 * Canonicalise the draft list: order by tier (backups always after primaries)
 * then priority, and renumber priorities to contiguous 1-based group indices so
 * providers sharing a number stay one adjacent, load-balanced group. Run after
 * every structural edit so the list, the bracket rendering and the save payload
 * all read from the same normalised shape. Backup tiers are assumed already
 * consistent per group (the handlers keep them so); this only orders + renumbers.
 */
function normalize(drafts: Draft[]): Draft[] {
  const sorted = drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const tier = (a.d.isBackup ? 1 : 0) - (b.d.isBackup ? 1 : 0);
      if (tier !== 0) return tier;
      if (a.d.priority !== b.d.priority) return a.d.priority - b.d.priority;
      return a.i - b.i;
    })
    .map(({ d }) => d);
  let groupNo = 0;
  let prevPriority: number | null = null;
  let prevTier: boolean | null = null;
  return sorted.map((d) => {
    if (d.priority !== prevPriority || d.isBackup !== prevTier) {
      groupNo++;
      prevPriority = d.priority;
      prevTier = d.isBackup;
    }
    return { ...d, priority: groupNo };
  });
}

/** Group consecutive drafts that share a priority (input must be normalised). */
function groupRuns(drafts: Draft[]): Draft[][] {
  const runs: Draft[][] = [];
  for (const d of drafts) {
    const last = runs[runs.length - 1];
    if (last && last[0].priority === d.priority) last.push(d);
    else runs.push([d]);
  }
  return runs;
}

/** Build the editor's ordered, grouped draft list from the saved providers. */
function draftsFromProviders(providers: MaskedProvider[]): Draft[] {
  return normalize(providers.map(fromMasked));
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
    priority: 1,
  };
}

/** Build the API payload for one draft (priority + backup tier are stored directly). */
function toPayload(d: Draft) {
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
    priority: d.priority,
    isBackup: d.isBackup || undefined,
    enabled: d.enabled,
  };
}

export function ProviderEditor({ providers }: { providers: MaskedProvider[] }) {
  const [drafts, setDrafts] = React.useState<Draft[]>(() =>
    draftsFromProviders(providers)
  );
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
    setDrafts((ds) => normalize(ds.filter((d) => d.id !== id)));

  const add = () =>
    setDrafts((ds) =>
      normalize([
        ...ds,
        {
          ...emptyDraft(),
          priority:
            (ds.length ? Math.max(...ds.map((d) => d.priority)) : 0) + 1,
        },
      ])
    );

  // Set a provider's priority to a typed value. Matching another provider's
  // number joins its group (and adopts that group's backup tier).
  const setPriority = (id: string, value: number) =>
    setDrafts((ds) => {
      const n = Math.max(1, Math.round(value) || 1);
      return normalize(
        ds.map((d) => {
          if (d.id !== id) return d;
          const joinTier = ds.find(
            (o) => o.id !== id && o.priority === n
          )?.isBackup;
          return { ...d, priority: n, isBackup: joinTier ?? d.isBackup };
        })
      );
    });

  // Up arrow: merge this provider into the group directly above it (priorities
  // are contiguous, so that group is `priority - 1`), adopting its backup tier.
  const groupUp = (id: string) =>
    setDrafts((ds) => {
      const cur = ds.find((d) => d.id === id);
      if (!cur || cur.priority <= 1) return ds;
      const targetPriority = cur.priority - 1;
      const targetTier =
        ds.find((d) => d.priority === targetPriority)?.isBackup ?? cur.isBackup;
      return normalize(
        ds.map((d) =>
          d.id === id
            ? { ...d, priority: targetPriority, isBackup: targetTier }
            : d
        )
      );
    });

  // Down arrow: split this provider out of its group into its own priority just
  // below it (the +0.5 sorts it after its old group; normalize re-integers it).
  const ungroup = (id: string) =>
    setDrafts((ds) => {
      const cur = ds.find((d) => d.id === id);
      if (!cur || ds.filter((d) => d.priority === cur.priority).length <= 1)
        return ds;
      return normalize(
        ds.map((d) => (d.id === id ? { ...d, priority: d.priority + 0.5 } : d))
      );
    });

  // Backup toggle is a group control: flip the whole priority group's tier.
  const setBackup = (id: string, value: boolean) =>
    setDrafts((ds) => {
      const cur = ds.find((d) => d.id === id);
      if (!cur) return ds;
      return normalize(
        ds.map((d) =>
          d.priority === cur.priority ? { ...d, isBackup: value } : d
        )
      );
    });

  const runTest = async (d: Draft) => {
    setTests((t) => ({ ...t, [d.id]: 'pending' }));
    try {
      const result = await test.mutateAsync(
        toPayload(d) as Record<string, unknown>
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
      await save.mutateAsync(drafts.map(toPayload));
      toast.success('Providers saved.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to save providers');
    }
  };

  const groups = groupRuns(drafts);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">NNTP providers</h3>
          <p className="text-xs text-[--muted]">
            Lower priority numbers are tried first. Give two providers the same
            priority to put them in one load-balanced group (shown bracketed) so
            they split load by free capacity instead of one sitting idle as
            failover — the up arrow groups a provider with the one above, the
            down arrow splits it back out. Mark metered block accounts as
            backups (the toggle applies to the whole group) so they’re only used
            when a primary misses an article.
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
        {groups.map((group) => (
          <div key={group[0].id} className="space-y-px">
            {group.map((d, gi) => (
              <ProviderRow
                key={d.id}
                draft={d}
                grouped={group.length > 1}
                isGroupHead={gi === 0}
                isGroupTail={gi === group.length - 1}
                canGroupUp={d.priority > 1}
                canUngroup={group.length > 1}
                testResult={tests[d.id]}
                speedResult={speeds[d.id]}
                canSpeedTest={savedIds.has(d.id)}
                onChange={(patch) => update(d.id, patch)}
                onSetPriority={(v) => setPriority(d.id, v)}
                onGroupUp={() => groupUp(d.id)}
                onUngroup={() => ungroup(d.id)}
                onSetBackup={(v) => setBackup(d.id, v)}
                onRemove={() => remove(d.id)}
                onTest={() => runTest(d)}
                onSpeedTest={() => runSpeed(d)}
              />
            ))}
          </div>
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
    result.connections != null
      ? `${result.connections} conn${
          result.pipelineDepth && result.pipelineDepth > 1
            ? ` × depth ${result.pipelineDepth}`
            : ''
        }`
      : undefined;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Pill intent="success">
        <BiTachometer /> {formatSpeed(result.bytesPerSec ?? 0)}
      </Pill>
      {cfg ? (
        <span
          className="text-[10px] text-[--muted]"
          title={`Fanned out across ${result.connections} connections, pipeline depth ${result.pipelineDepth ?? 1}`}
        >
          {cfg}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Priority number input. Commits on blur (not per keystroke) so typing a
 * multi-digit value doesn't re-sort the list mid-edit; the displayed value is
 * reset whenever the normalised priority changes externally (via the key).
 */
function PriorityField({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const latest = React.useRef(value);
  React.useEffect(() => {
    latest.current = value;
  }, [value]);
  return (
    <div onBlur={() => latest.current !== value && onCommit(latest.current)}>
      <NumberInput
        key={value}
        defaultValue={value}
        min={1}
        hideControls
        size="sm"
        className="w-16 text-center tabular-nums"
        aria-label="Priority"
        onValueChange={(n) => {
          latest.current = Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
        }}
      />
    </div>
  );
}

function ProviderRow({
  draft: d,
  grouped,
  isGroupHead,
  isGroupTail,
  canGroupUp,
  canUngroup,
  testResult,
  speedResult,
  canSpeedTest,
  onChange,
  onSetPriority,
  onGroupUp,
  onUngroup,
  onSetBackup,
  onRemove,
  onTest,
  onSpeedTest,
}: {
  draft: Draft;
  /** Part of a multi-provider load-balanced group (shares its priority). */
  grouped: boolean;
  /** First / last row of its group — drives the `[` bracket corner rounding. */
  isGroupHead: boolean;
  isGroupTail: boolean;
  /** There is a group above to merge into (up arrow). */
  canGroupUp: boolean;
  /** This row is in a group and can be split back out (down arrow). */
  canUngroup: boolean;
  testResult?: ProviderTestResult | 'pending';
  speedResult?: ProviderSpeedTestResult | 'pending';
  canSpeedTest: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onSetPriority: (v: number) => void;
  onGroupUp: () => void;
  onUngroup: () => void;
  onSetBackup: (v: boolean) => void;
  onRemove: () => void;
  onTest: () => void;
  onSpeedTest: () => void;
}) {
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
        // Accent + bracket the left edge of grouped rows so a load-balanced
        // group reads as one block: rounded only at the head's top and the
        // tail's bottom, forming a continuous `[`.
        grouped && 'border-l-2 border-l-[--brand]',
        grouped && !isGroupHead && 'rounded-t-none',
        grouped && !isGroupTail && 'rounded-b-none'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-1">
          <Tooltip
            trigger={
              <IconButton
                size="xs"
                intent="gray-subtle"
                icon={<BiChevronUp />}
                disabled={!canGroupUp}
                onClick={onGroupUp}
                aria-label="Group with provider above"
              />
            }
          >
            Group with the provider above
          </Tooltip>
          <PriorityField value={d.priority} onCommit={onSetPriority} />
          <Tooltip
            trigger={
              <IconButton
                size="xs"
                intent="gray-subtle"
                icon={<BiChevronDown />}
                disabled={!canUngroup}
                onClick={onUngroup}
                aria-label="Split out of group"
              />
            }
          >
            Split out into its own priority
          </Tooltip>
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[180px]">
              <span className="font-medium text-sm">
                {d.name || d.host || 'New provider'}
              </span>
              {d.isBackup && <Pill intent="warning">backup</Pill>}
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
              moreHelp="How many requests can be waiting on each connection at once. 1 (the default) sends one request at a time. Higher values (e.g. 4–8) can reach full speed with far fewer connections — especially useful when the provider's server is far away — and automatically fall back to 1 if the provider doesn't support it."
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
            <Switch
              value={d.isBackup}
              onValueChange={onSetBackup}
              label="Backup"
              moreHelp={
                grouped
                  ? 'Applies to the whole group — backup providers are only used when a download is missing pieces on your main providers.'
                  : 'Only used when a download is missing pieces on your main providers — ideal for metered block accounts.'
              }
              side="right"
            />
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
