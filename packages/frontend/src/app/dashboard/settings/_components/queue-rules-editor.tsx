import React from 'react';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/loading-spinner';
import { cn } from '@/components/ui/core/styling';
import {
  useQueueCleanupRules,
  useSaveQueueCleanupRules,
  type QueueCleanupAction,
  type QueueCleanupRule,
} from '../queries';
import { useSettingsPanelField } from './settings-panels';

const ACTIONS: { value: QueueCleanupAction; label: string; help: string }[] = [
  {
    value: 'blocklist_search',
    label: 'Replace',
    help: 'Blocklist the release and search for another',
  },
  {
    value: 'blocklist',
    label: 'Blocklist',
    help: 'Blocklist it, but do not search again',
  },
  {
    value: 'import',
    label: 'Import',
    help: 'Push the import through by hand',
  },
  {
    value: 'remove',
    label: 'Remove',
    help: 'Just clear the queue entry',
  },
];

/** Client-side editable rule row. */
type Draft = Pick<QueueCleanupRule, 'id' | 'enabled' | 'action'>;

function toDraft(rule: QueueCleanupRule): Draft {
  return { id: rule.id, enabled: rule.enabled, action: rule.action };
}

/**
 * What to do about each reason Sonarr/Radarr give for refusing an import.
 * The matchers are not editable (they track phrases the arrs emit); only
 * whether a reason is acted on, and which action it gets, is the user's.
 */
export function QueueRulesEditor() {
  const query = useQueueCleanupRules();
  const save = useSaveQueueCleanupRules();
  const catalogue = query.data?.rules;

  const {
    value: drafts,
    setValue: setDrafts,
    seed,
  } = useSettingsPanelField<Draft[]>('arr.queueCleanup.rules', {
    save: async (value) => {
      const res = await save.mutateAsync(value as Draft[]);
      const on = res.rules.filter((r) => r.enabled).length;
      return {
        message: `${on} queue cleanup rule${on === 1 ? '' : 's'}`,
        value: res.rules.map(toDraft),
      };
    },
  });

  React.useEffect(() => {
    if (drafts === undefined && catalogue) seed(catalogue.map(toDraft));
  }, [catalogue, drafts, seed]);

  if (query.isLoading || drafts === undefined) {
    return (
      <Card className="p-6 flex justify-center">
        <Spinner className="w-6 h-6" />
      </Card>
    );
  }
  if (query.isError || !catalogue) {
    return (
      <Card className="p-6 text-sm text-red-400">
        Failed to load the queue cleanup rules.
      </Card>
    );
  }

  const patch = (id: string, next: Partial<Draft>) =>
    setDrafts(drafts.map((d) => (d.id === id ? { ...d, ...next } : d)));

  return (
    <Card className="p-4 space-y-4">
      <div>
        <p className="font-semibold">Queue cleanup rules</p>
        <p className="text-sm text-[--muted]">
          When an arr cannot import one of our downloads it says why. Each
          reason below gets one of four responses. Only downloads AIOStreams
          handed over are ever touched.
        </p>
      </div>

      <div className="space-y-2">
        {drafts.map((draft) => {
          const rule = catalogue.find((r) => r.id === draft.id);
          if (!rule) return null;
          return (
            <div
              key={draft.id}
              className={cn(
                'flex flex-col gap-2 rounded-[--radius] border border-[--border] p-3',
                'sm:flex-row sm:items-center sm:justify-between',
                !draft.enabled && 'opacity-60'
              )}
            >
              <div className="flex items-start gap-3 min-w-0">
                <Switch
                  value={draft.enabled}
                  onValueChange={(v) => patch(draft.id, { enabled: v })}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{rule.label}</p>
                  <p className="text-xs text-[--muted] truncate">
                    “{rule.phrase}”
                  </p>
                  {rule.note && (
                    <p className="text-xs text-[--muted] mt-0.5">{rule.note}</p>
                  )}
                </div>
              </div>
              <div className="sm:w-48 shrink-0">
                <Select
                  value={draft.action}
                  disabled={!draft.enabled}
                  options={ACTIONS.map((a) => ({
                    value: a.value,
                    label: a.label,
                  }))}
                  onValueChange={(v) =>
                    patch(draft.id, { action: v as QueueCleanupAction })
                  }
                  help={ACTIONS.find((a) => a.value === draft.action)?.help}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
