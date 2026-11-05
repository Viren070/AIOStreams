import React from 'react';
import { ListChecksIcon } from 'lucide-react';
import { Button } from '@aiostreams/ui/button';
import { Checkbox } from '@aiostreams/ui/checkbox';
import { Modal } from '@aiostreams/ui/modal';
import * as constants from '@aiostreams/core/src/utils/constants';
import type {
  TemplateUpdateChange,
  TemplateUpdatePlan,
} from '@/lib/templates/merge';

const SETTING_NAMES: Record<string, string> = {
  presets: 'Addons',
  sortCriteria: 'Sorting',
};

/** `excludedQualities` → "Excluded qualities". */
export function settingName(field: string): string {
  if (SETTING_NAMES[field]) return SETTING_NAMES[field];
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SECRET_KEY = /(api)?key$|token|password|secret|credential/i;

/** Secrets render masked, the same as the inputs that hold them. */
function isSecret(field: string): boolean {
  const detail = (
    constants.TOP_LEVEL_OPTION_DETAILS as Record<string, { type: string }>
  )[field];
  return detail?.type === 'password' || SECRET_KEY.test(field);
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/** Items missing from the other side, tinted as added or removed. */
export interface Highlight {
  others: string[];
  tone: 'added' | 'removed';
}

const TONES = {
  added: 'bg-green-500/15 text-green-300 ring-1 ring-green-500/40',
  removed: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/40 line-through',
};

function Tags({
  items,
  keys = items,
  highlight,
}: {
  items: string[];
  keys?: string[];
  highlight?: Highlight;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => {
        const differs = highlight && !highlight.others.includes(keys[i]);
        return (
          <span
            key={`${item}-${i}`}
            className={`text-xs px-2 py-0.5 rounded ${
              differs ? TONES[highlight!.tone] : 'bg-gray-700/50 text-gray-200'
            }`}
          >
            {item}
          </span>
        );
      })}
    </div>
  );
}

function sortLine(entry: any): string {
  const direction =
    entry?.direction === 'asc'
      ? 'low to high'
      : entry?.direction === 'desc'
        ? 'high to low'
        : '';
  return [settingName(String(entry.key)), direction && `(${direction})`]
    .filter(Boolean)
    .join(' ');
}

/** A setting's value as something a person can read. */
export function ValueView({
  field,
  value,
  highlight,
}: {
  field: string;
  value: unknown;
  highlight?: Highlight;
}) {
  if (isEmpty(value)) return <span className="text-gray-500">None</span>;
  if (isSecret(field)) return <span className="font-mono">••••••••</span>;
  if (typeof value === 'boolean') return <span>{value ? 'On' : 'Off'}</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;

  if (field === 'presets' && Array.isArray(value)) {
    return (
      <Tags
        items={value.map(
          (p: any) =>
            `${p?.options?.name || p?.type}${p?.enabled === false ? ' (off)' : ''}`
        )}
        keys={value.map((p: any) => String(p?.options?.name || p?.type))}
        highlight={highlight}
      />
    );
  }

  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object'))
      return <Tags items={value.map(String)} highlight={highlight} />;
    if (value.every((v: any) => v?.key))
      return (
        <ol className="list-decimal pl-5 space-y-0.5">
          {value.map((v: any, i) => (
            <li key={i}>{sortLine(v)}</li>
          ))}
        </ol>
      );
  }

  if (!Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => !isEmpty(v)
    );
    if (entries.length === 0)
      return <span className="text-gray-500">None</span>;
    return (
      <dl className="space-y-2">
        {entries.map(([key, v]) => (
          <div key={key}>
            <dt className="text-xs text-gray-400">{settingName(key)}</dt>
            <dd>
              <ValueView field={key} value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <pre className="text-xs whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Plain names for list items, so additions and removals can be spelled out. */
function listNames(field: string, value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (field === 'presets')
    return value.map((p: any) => String(p?.options?.name || p?.type));
  return value.every((v) => typeof v !== 'object') ? value.map(String) : null;
}

/** "The update adds SCR, TC and removes TS" for list settings. */
function ListDifference({
  field,
  mine,
  theirs,
}: {
  field: string;
  mine: unknown;
  theirs: unknown;
}) {
  const before = listNames(field, mine ?? []);
  const after = listNames(field, theirs ?? []);
  if (!before || !after) return null;
  const added = after.filter((v) => !before.includes(v));
  const removed = before.filter((v) => !after.includes(v));
  if (added.length === 0 && removed.length === 0) {
    const sameOrder = before.join('\u0000') === after.join('\u0000');
    return (
      <p className="text-sm text-gray-400">
        {sameOrder
          ? field === 'presets'
            ? 'Same addons, with some of their settings changed.'
            : 'Same items.'
          : 'Same items, in a different order.'}
      </p>
    );
  }
  return (
    <p className="text-sm text-gray-300">
      Compared with yours, the update’s version
      {added.length > 0 && <> adds {added.join(', ')}</>}
      {added.length > 0 && removed.length > 0 && ' and'}
      {removed.length > 0 && <> removes {removed.join(', ')}</>}.
    </p>
  );
}

function highlightFor(
  change: TemplateUpdateChange,
  side: 'mine' | 'theirs'
): Highlight | undefined {
  const others = listNames(
    change.field,
    (side === 'mine' ? change.theirs : change.mine) ?? []
  );
  if (!others) return undefined;
  return { others, tone: side === 'mine' ? 'removed' : 'added' };
}

interface UpdateSummaryProps {
  plan: TemplateUpdatePlan;
  keepMine: ReadonlySet<string>;
  setKeepMine: (field: string, keep: boolean) => void;
}

/** What a template update changes, what stays as the user has it, and why. */
export function UpdateSummary({
  plan,
  keepMine,
  setKeepMine,
}: UpdateSummaryProps) {
  const [details, setDetails] = React.useState<TemplateUpdateChange | null>(
    null
  );
  if (plan.changes.length === 0) return null;

  const kept = plan.changes.filter((c) => keepMine.has(c.field)).length;
  const taken = plan.changes.length - kept;
  const plural = (n: number) => (n === 1 ? 'setting' : 'settings');

  return (
    <div className="rounded-lg border border-gray-700/70 bg-gray-800/40 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-gray-500">
          <ListChecksIcon className="w-4 h-4" />
        </span>
        <span className="text-sm font-medium text-white">
          What this update does
        </span>
      </div>
      <p className="text-sm text-gray-300 mb-1">
        Takes {taken} {plural(taken)} from the update
        {kept > 0 ? ` and keeps ${kept} of yours` : ''}. Everything else stays
        as you have it.
      </p>
      {plan.conflicts.length > 0 && (
        <p className="text-xs text-gray-400 mb-3">
          {plan.hasBaseline
            ? 'Settings marked "You changed this" are ones you edited yourself. They stay as yours; untick one to take the update instead.'
            : 'This setup was applied before AIOStreams kept a copy of it, so it cannot tell your edits from the update. Tick any setting you want to keep as yours.'}
        </p>
      )}

      <ul className="divide-y divide-gray-700/60">
        {plan.changes.map((change) => {
          const keeping = keepMine.has(change.field);
          return (
            <li
              key={change.field}
              className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white">
                  {settingName(change.field)}
                </div>
                <div
                  className={
                    keeping ? 'text-xs text-brand-300' : 'text-xs text-gray-400'
                  }
                >
                  {keeping
                    ? 'You changed this · stays as yours'
                    : change.conflict
                      ? 'You changed this · will take the update'
                      : 'Will change'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetails(change)}
                className="text-xs text-gray-400 hover:text-white transition-colors shrink-0"
              >
                See details
              </button>
              {change.conflict && (
                <div className="shrink-0">
                  <Checkbox
                    size="sm"
                    label="Keep mine"
                    value={keeping}
                    onValueChange={(v) => setKeepMine(change.field, v === true)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Modal
        open={details !== null}
        onOpenChange={(open) => !open && setDetails(null)}
        title={details ? settingName(details.field) : ''}
        description={
          details && keepMine.has(details.field)
            ? 'You are keeping yours. The update’s version is shown for comparison.'
            : 'This setting changes to the update’s version.'
        }
        contentClass="max-w-3xl"
      >
        {details && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 text-sm text-gray-200">
              <div className="rounded-lg border border-gray-700/70 p-3">
                <div className="text-xs font-medium text-gray-400 mb-2">
                  Yours now
                </div>
                <ValueView
                  field={details.field}
                  value={details.mine}
                  highlight={highlightFor(details, 'mine')}
                />
              </div>
              <div className="rounded-lg border border-gray-700/70 p-3">
                <div className="text-xs font-medium text-gray-400 mb-2">
                  {keepMine.has(details.field)
                    ? 'The update’s version'
                    : 'After the update'}
                </div>
                <ValueView
                  field={details.field}
                  value={details.theirs}
                  highlight={highlightFor(details, 'theirs')}
                />
              </div>
            </div>
            <ListDifference
              field={details.field}
              mine={details.mine}
              theirs={details.theirs}
            />
            <div className="flex justify-end">
              <Button intent="gray-outline" onClick={() => setDetails(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
