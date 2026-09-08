import React from 'react';
import { toast } from 'sonner';
import type { QueryKey } from '@tanstack/react-query';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip } from '@/components/ui/tooltip';
import { Alert } from '@/components/ui/alert';
import {
  useResetSettings,
  type ManagedSettingsKey,
  type SettingsKey,
} from '../queries';
import { humanise } from '../tabs.config';

const SECRET_PREVIEW = '••••••';

function previewValue(v: unknown, secret: boolean): string {
  if (secret) return SECRET_PREVIEW;
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '""' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const json = JSON.stringify(v);
    return json.length > 60 ? json.slice(0, 57) + '…' : json;
  } catch {
    return String(v);
  }
}

/**
 * One resettable key. Editor-managed keys carry no `preview`: their values
 * never reach the browser, so all the server reports is that one differs.
 */
interface ResetRow {
  key: string;
  label: string;
  source: SettingsKey['source'];
  requiresRestart: boolean;
  preview?: { from: string; to: string };
}

/**
 * Whether resetting would actually change anything. A stored row already
 * holding the default is resettable in the mechanical sense (there is a row
 * to delete), but listing it as `false → false` is noise, and the server
 * skips it as `already-default` anyway. Secrets never round-trip, so
 * `secretSet` is the only evidence available for those.
 */
function changesSomething(k: SettingsKey): boolean {
  if (k.secret) return k.secretSet;
  return JSON.stringify(k.value) !== JSON.stringify(k.default);
}

function toRow(k: SettingsKey): ResetRow {
  return {
    key: k.key,
    label: k.label,
    source: k.source,
    requiresRestart: k.requiresRestart,
    preview: {
      from: previewValue(k.value, k.secret),
      to: previewValue(k.default, k.secret),
    },
  };
}

interface GroupedRows {
  subsection: string;
  rows: ResetRow[];
}

function groupRows(rows: ResetRow[]): GroupedRows[] {
  const bySection = new Map<string, Map<string, ResetRow[]>>();
  for (const r of rows) {
    const parts = r.key.split('.');
    const section = parts[0];
    const sub = parts.slice(1, -1).join('.');
    if (!bySection.has(section)) bySection.set(section, new Map());
    const subs = bySection.get(section)!;
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub)!.push(r);
  }
  const out: GroupedRows[] = [];
  for (const [section, subs] of bySection) {
    for (const [sub, list] of subs) {
      const path = sub ? `${section}.${sub}` : section;
      const heading = path.split('.').map(humanise).join(' › ');
      out.push({ subsection: heading, rows: list });
    }
  }
  return out;
}

/**
 * Modal for resetting one or more keys back to env/default. Lists every
 * `database`-source key in the scope that still differs from its default;
 * env-locked and already-default keys are surfaced as counts so the numbers
 * add up.
 */
export function ResetSettingsModal({
  open,
  onOpenChange,
  scope,
  scopeLabel,
  keys,
  managed,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: 'section' | 'all';
  scopeLabel: string;
  keys: SettingsKey[];
  /** Keys owned by a bespoke editor (rules, instances) in the same scope. */
  managed?: ManagedSettingsKey[];
  /** Query keys to refetch after a reset (scoped callers pass their own). */
  invalidate?: QueryKey[];
}) {
  const { mutateAsync, isPending } = useResetSettings(invalidate);

  // Only DB-sourced keys that would actually change are offered; the rest are
  // counted for the heads-up note.
  const resettable = React.useMemo<ResetRow[]>(
    () => [
      ...keys
        .filter((k) => k.source === 'database' && changesSomething(k))
        .map(toRow),
      ...(managed ?? [])
        .filter((m) => m.source === 'database' && !m.isDefault)
        .map((m) => ({
          key: m.key,
          label: m.label,
          source: m.source,
          requiresRestart: m.requiresRestart,
        })),
    ],
    [keys, managed]
  );
  const envLockedCount = React.useMemo(
    () =>
      keys.filter((k) => k.source === 'environment').length +
      (managed ?? []).filter((m) => m.source === 'environment').length,
    [keys, managed]
  );
  const atDefaultCount = React.useMemo(
    () =>
      keys.filter((k) => k.source === 'database' && !changesSomething(k))
        .length +
      (managed ?? []).filter((m) => m.source === 'database' && m.isDefault)
        .length,
    [keys, managed]
  );

  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Re-seed the selection whenever the modal opens or its scope changes so
  // closing-and-reopening always starts with everything checked.
  React.useEffect(() => {
    if (open) setSelected(new Set(resettable.map((r) => r.key)));
  }, [open, resettable]);

  const groups = React.useMemo(() => groupRows(resettable), [resettable]);
  const allChecked =
    selected.size === resettable.length && resettable.length > 0;
  const someChecked = selected.size > 0 && !allChecked;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // Functional updater so the underlying Checkbox's stale-closure
  // `onValueChange` (it `useCallback`s with []) still sees current state.
  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === resettable.length
        ? new Set()
        : new Set(resettable.map((r) => r.key))
    );
  };

  const onConfirm = async () => {
    if (selected.size === 0) return;
    try {
      const res = await mutateAsync([...selected]);
      toast.success(
        `Reset ${res.reset.length} setting${res.reset.length === 1 ? '' : 's'}.`
      );
      const otherSkips = res.skipped.filter(
        (s) => s.reason !== 'already-default'
      );
      if (otherSkips.length) {
        toast.warning(
          `${otherSkips.length} could not be reset (env-locked or unknown).`
        );
      }
      if (res.requiresRestart) {
        toast.warning('Some changes require a restart to take effect.', {
          duration: 8000,
        });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to reset settings');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        scope === 'all'
          ? 'Reset all settings'
          : `Reset settings in ${scopeLabel}`
      }
      description={
        resettable.length === 0
          ? 'Nothing to reset - every key in this scope already holds its default or is pinned by an env variable.'
          : 'Selected keys will revert to their environment value (if set) or built-in default. This cannot be undone.'
      }
      contentClass="max-w-2xl"
      footer={
        <>
          <Button
            intent="gray-outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            intent="alert-subtle"
            onClick={onConfirm}
            loading={isPending}
            disabled={isPending || selected.size === 0}
          >
            {selected.size === 0
              ? 'Nothing selected'
              : `Reset ${selected.size} ${selected.size === 1 ? 'key' : 'keys'}`}
          </Button>
        </>
      }
    >
      {resettable.length > 0 && (
        <div className="space-y-3">
          {(envLockedCount > 0 || atDefaultCount > 0) && (
            <Alert
              intent="info"
              description={
                <>
                  {envLockedCount > 0 && (
                    <>
                      {envLockedCount} key{envLockedCount === 1 ? '' : 's'} in
                      this scope {envLockedCount === 1 ? 'is' : 'are'} pinned by
                      environment variables and won&apos;t change.{' '}
                    </>
                  )}
                  {atDefaultCount > 0 && (
                    <>
                      {atDefaultCount} already{' '}
                      {atDefaultCount === 1 ? 'holds' : 'hold'} the default
                      value, so {atDefaultCount === 1 ? 'it is' : 'they are'}{' '}
                      not listed.
                    </>
                  )}
                </>
              }
              isClosable={false}
            />
          )}

          <div className="flex items-center justify-between border-b border-[--border] pb-2">
            <Checkbox
              label={
                allChecked
                  ? `All ${resettable.length} selected`
                  : someChecked
                    ? `${selected.size} of ${resettable.length} selected`
                    : 'Select all'
              }
              value={allChecked ? true : someChecked ? 'indeterminate' : false}
              onValueChange={toggleAll}
            />
          </div>

          <div className="max-h-[50vh] overflow-y-auto space-y-4 pr-1">
            {groups.map((g) => (
              <div key={g.subsection}>
                <div className="text-xs font-semibold text-[--muted] uppercase tracking-wide mb-1.5">
                  {g.subsection}
                </div>
                <ul className="space-y-1">
                  {g.rows.map((r) => {
                    const checked = selected.has(r.key);
                    return (
                      <li
                        key={r.key}
                        className="flex items-start gap-3 py-1.5 px-2 rounded-md hover:bg-[--subtle] transition-colors"
                      >
                        <div className="pt-0.5">
                          <Checkbox
                            value={checked}
                            onValueChange={() => toggle(r.key)}
                          />
                        </div>
                        <button
                          type="button"
                          className="flex-1 text-left min-w-0"
                          onClick={() => toggle(r.key)}
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                            <span className="font-medium break-words">
                              {r.label}
                            </span>
                            <code className="text-xs text-[--muted] break-all min-w-0">
                              {r.key}
                            </code>
                          </div>
                          <div className="text-xs text-[--muted] break-all mt-0.5 min-w-0">
                            {r.preview ? (
                              <>
                                <span className="font-mono">
                                  {r.preview.from}
                                </span>
                                <span className="mx-1.5">→</span>
                                <span className="font-mono">
                                  {r.preview.to}
                                </span>
                              </>
                            ) : (
                              <span className="italic">
                                edited below; resetting restores the built-in
                                defaults
                              </span>
                            )}
                          </div>
                        </button>
                        {r.requiresRestart && (
                          <Tooltip
                            trigger={
                              <span className="text-[10px] uppercase tracking-wide text-orange-400 font-semibold mt-0.5">
                                restart
                              </span>
                            }
                          >
                            Requires a restart to take effect
                          </Tooltip>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
