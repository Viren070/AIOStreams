import React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { BasicField } from '@/components/ui/basic-field';
import {
  useResetUsenetStats,
  type UsenetStatsResetResult,
  type UsenetStatsResetTarget,
} from '../queries';
import { formatBytes, formatCompact } from '@/lib/format';

export interface ResetStatsTarget {
  target: UsenetStatsResetTarget;
  /** Provider id or indexer label; omit for every row of that kind. */
  id?: string;
  /** Human name for the dialog copy, e.g. "Eweka" or "All providers". */
  label: string;
}

const HOUR_MS = 3_600_000;

function hourFloor(ts: number): number {
  return ts - (ts % HOUR_MS);
}

/**
 * Rollups are hourly, so a range is a count of hour buckets. A speed test that
 * just ran is confined to the current one, which is what "Just this hour"
 * undoes.
 */
const RANGES: { value: string; label: string; hours?: number }[] = [
  { value: 'all', label: 'All recorded history' },
  { value: '1h', label: 'Just this hour', hours: 1 },
  { value: '24h', label: 'Last 24 hours', hours: 24 },
  { value: '7d', label: 'Last 7 days', hours: 24 * 7 },
];

function sinceMsFor(range: string): number | undefined {
  const hours = RANGES.find((r) => r.value === range)?.hours;
  // Floored, since `now - hours` would clip the current bucket and reach into
  // an older one.
  return hours === undefined
    ? undefined
    : hourFloor(Date.now()) - (hours - 1) * HOUR_MS;
}

function impactOf(
  target: UsenetStatsResetTarget,
  r: UsenetStatsResetResult
): string {
  const rows = r.providerRows + r.indexerRows;
  if (rows === 0) return 'Nothing recorded in this range.';
  const detail: string[] = [];
  if (target !== 'indexers' && r.providerRows > 0) {
    detail.push(
      `${formatBytes(r.providerBytes)}, ${formatCompact(r.providerArticles)} articles`
    );
  }
  if (target !== 'providers' && r.indexerRows > 0) {
    detail.push(`${formatCompact(r.indexerGrabs)} grabs`);
  }
  const plural = rows === 1 ? 'row' : 'rows';
  return `Removes ${formatCompact(rows)} hourly ${plural}${
    detail.length ? ` (${detail.join(' · ')})` : ''
  }.`;
}

/**
 * Confirm wiping recorded usenet stats, previewing the exact damage with a dry
 * run first: an all-time reset is otherwise an unbounded delete with no undo.
 */
export function ResetStatsModal({
  target,
  onClose,
}: {
  target: ResetStatsTarget | null;
  onClose: () => void;
}) {
  const [range, setRange] = React.useState('all');
  const [preview, setPreview] = React.useState<UsenetStatsResetResult | null>(
    null
  );
  const previewer = useResetUsenetStats();
  const commit = useResetUsenetStats();

  React.useEffect(() => {
    if (target) setRange('all');
  }, [target]);

  // Stale responses are dropped so a slow request cannot overwrite the numbers
  // for a range the operator has since moved on from.
  React.useEffect(() => {
    if (!target) return;
    let current = true;
    setPreview(null);
    previewer
      .mutateAsync({
        target: target.target,
        id: target.id,
        sinceMs: sinceMsFor(range),
        dryRun: true,
      })
      .then((r) => {
        if (current) setPreview(r);
      })
      .catch(() => {
        /* the impact line just stays unknown */
      });
    return () => {
      current = false;
    };
  }, [target?.target, target?.id, range]);

  if (!target) return null;

  const submit = async () => {
    try {
      const r = await commit.mutateAsync({
        target: target.target,
        id: target.id,
        sinceMs: sinceMsFor(range),
      });
      const rows = r.providerRows + r.indexerRows;
      toast.success(
        rows === 0
          ? 'Nothing to reset'
          : `Reset ${formatCompact(rows)} hourly row${rows === 1 ? '' : 's'}`
      );
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to reset stats');
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Reset stats — ${target.label}`}
    >
      <div className="space-y-4">
        <p className="text-sm text-[--muted]">
          Deletes the recorded history for{' '}
          <span className="text-[--foreground]">{target.label}</span>. Charts
          and totals are rebuilt from what is left, and this cannot be undone.
        </p>

        <BasicField label="Range">
          <Select
            value={range}
            onValueChange={setRange}
            options={RANGES.map((r) => ({ label: r.label, value: r.value }))}
          />
        </BasicField>

        <p className="text-sm tabular-nums">
          {preview ? (
            impactOf(target.target, preview)
          ) : (
            <span className="text-[--muted]">Checking what this removes…</span>
          )}
        </p>

        <div className="flex justify-end gap-2">
          <Button intent="gray-outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            intent="alert"
            loading={commit.isPending}
            disabled={preview?.providerRows === 0 && preview?.indexerRows === 0}
            onClick={submit}
          >
            Reset stats
          </Button>
        </div>
      </div>
    </Modal>
  );
}
