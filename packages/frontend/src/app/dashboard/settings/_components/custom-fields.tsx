import React from 'react';
import { useController, useFormContext } from 'react-hook-form';
import { BiPlus, BiTrash } from 'react-icons/bi';
import { TextInput } from '@/components/ui/text-input';
import { NumberInput } from '@/components/ui/number-input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button, IconButton } from '@/components/ui/button';
import { BasicField } from '@/components/ui/basic-field';
import { parseDuration, formatDurationMs } from '@/lib/format';
import type { SettingsUiHint } from '../queries';
/** Sentinel value that signals "clear this secret" on save. */
export const SECRET_CLEAR_SENTINEL = '\x00CLEAR\x00';

interface CommonProps {
  name: string;
  label: string;
  help?: string;
  disabled?: boolean;
  secretSet?: boolean;
}

type MapValueKind = NonNullable<SettingsUiHint['mapValueKind']>;

/** Layout hint controlling key vs value column widths in `KeyValueListField`. */
export type KvWidth = 'equal' | 'wide-key' | 'wide-value';

/**
 * `Field.KeyValueList` — generic editor for the map / list helper schemas
 * (cacheTtlMap, userAgentMap, addonProxyConfigMap, …). One reusable custom
 * field, schema-driven via `valueKind`. Round-trips the exact object/array
 * shape the config pipeline expects, so no server-side adaptation is needed.
 *
 * Implementation note: render-state (`rows`) is held *locally* rather than
 * derived directly from `field.value`. The committed RHF value strips empty
 * keys so the user's view of "an empty new row I'm about to type into"
 * disagreed with the form value, which made the [+] button appear to do
 * nothing. With local state, adding a row appends `['', default]` immediately
 * and only the non-empty pairs are pushed back to RHF on each change.
 */
export function KeyValueListField({
  name,
  label,
  help,
  disabled,
  valueKind = 'string',
  width = 'equal',
  min = 0,
}: CommonProps & { valueKind?: MapValueKind; width?: KvWidth; min?: number }) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });

  // Snapshot of the current RHF value, used to seed/resync local rows.
  const fromField = React.useCallback((): Array<[string, unknown]> => {
    const v = field.value;
    if (v && typeof v === 'object' && !Array.isArray(v))
      return Object.entries(v);
    return [];
  }, [field.value]);

  const [rows, setRows] = React.useState<Array<[string, unknown]>>(fromField);

  // Resync only when the upstream value structurally differs from what we
  // would produce — covers form `reset` after save, but never clobbers an
  // in-progress empty row the user just added.
  React.useEffect(() => {
    const incoming = fromField();
    const projected: Record<string, unknown> = {};
    for (const [k, v] of rows) if (k) projected[k] = v;
    const incomingObj: Record<string, unknown> = Object.fromEntries(incoming);
    if (JSON.stringify(projected) !== JSON.stringify(incomingObj)) {
      setRows(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.value]);

  const commit = (next: Array<[string, unknown]>) => {
    setRows(next);
    const obj: Record<string, unknown> = {};
    for (const [k, val] of next) if (k) obj[k] = val;
    field.onChange(obj);
  };

  const setRow = (i: number, k: string, val: unknown) => {
    commit(
      rows.map((r, idx) => (idx === i ? ([k, val] as [string, unknown]) : r))
    );
  };

  const defaultVal = (): unknown =>
    valueKind === 'boolean' ? false : valueKind === 'number' ? 0 : '';

  const keyClass =
    width === 'wide-key'
      ? 'basis-2/3 grow shrink-0'
      : width === 'wide-value'
        ? 'basis-1/3 grow shrink-0'
        : 'basis-1/2 grow shrink-0';
  const valClass =
    width === 'wide-value'
      ? 'basis-2/3 grow shrink-0'
      : width === 'wide-key'
        ? 'basis-1/3 grow shrink-0'
        : 'basis-1/2 grow shrink-0';

  return (
    <BasicField label={label} help={help}>
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-xs text-[--muted] italic">No entries.</p>
        )}
        {rows.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-2">
            <TextInput
              placeholder="key"
              value={k}
              disabled={disabled}
              onValueChange={(nk) => setRow(i, nk, v)}
              className={keyClass}
            />
            <span className="text-[--muted]">=</span>
            <div className={valClass}>
              {valueKind === 'boolean' ? (
                <Switch
                  value={Boolean(v)}
                  disabled={disabled}
                  onValueChange={(nv) => setRow(i, k, nv)}
                />
              ) : valueKind === 'number' ? (
                <NumberInput
                  value={typeof v === 'number' ? v : Number(v) || 0}
                  disabled={disabled}
                  onValueChange={(nv) => setRow(i, k, nv)}
                  min={min}
                />
              ) : (
                <TextInput
                  placeholder="value"
                  value={v == null ? '' : String(v)}
                  disabled={disabled}
                  onValueChange={(nv) => {
                    let parsed: unknown = nv;
                    if (valueKind === 'numberOrBool') {
                      if (nv === 'true') parsed = true;
                      else if (nv === 'false') parsed = false;
                      else if (/^\d+$/.test(nv)) parsed = Number(nv);
                    }
                    setRow(i, k, parsed);
                  }}
                />
              )}
            </div>
            <IconButton
              size="sm"
              intent="alert-subtle"
              icon={<BiTrash />}
              disabled={disabled}
              onClick={() => commit(rows.filter((_, idx) => idx !== i))}
              aria-label="Remove entry"
            />
          </div>
        ))}
        <IconButton
          size="sm"
          intent="primary-subtle"
          rounded
          icon={<BiPlus />}
          disabled={disabled}
          onClick={() => commit([...rows, ['', defaultVal()]])}
          aria-label="Add entry"
        />
      </div>
    </BasicField>
  );
}

/** Editor for `string[]` config fields. Local rendering state mirrors the
 * KeyValueListField pattern so that an empty new row added via the [+] button
 * persists in the UI even though we don't push purely-empty values back to
 * RHF (most consumers treat `''` as "remove me"). */
export function StringListField({ name, label, help, disabled }: CommonProps) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });

  const fromField = React.useCallback(
    (): string[] => (Array.isArray(field.value) ? [...field.value] : []),
    [field.value]
  );

  const [rows, setRows] = React.useState<string[]>(fromField);

  React.useEffect(() => {
    const incoming = fromField();
    if (JSON.stringify(rows) !== JSON.stringify(incoming)) {
      setRows(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.value]);

  const commit = (next: string[]) => {
    setRows(next);
    field.onChange(next);
  };

  return (
    <BasicField label={label} help={help}>
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-xs text-[--muted] italic">No entries.</p>
        )}
        {rows.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <TextInput
              value={v}
              disabled={disabled}
              onValueChange={(nv) =>
                commit(rows.map((r, idx) => (idx === i ? nv : r)))
              }
              className="flex-1"
            />
            <IconButton
              size="sm"
              intent="alert-subtle"
              icon={<BiTrash />}
              disabled={disabled}
              onClick={() => commit(rows.filter((_, idx) => idx !== i))}
              aria-label="Remove"
            />
          </div>
        ))}
        <IconButton
          size="sm"
          intent="primary-subtle"
          rounded
          icon={<BiPlus />}
          disabled={disabled}
          onClick={() => commit([...rows, ''])}
          aria-label="Add"
        />
      </div>
    </BasicField>
  );
}

/**
 * Editor for `boolOrList` config fields (helper schema accepts `true | false |
 * string[]`). Renders a switch that toggles between the boolean value and a
 * `StringListField`-style editor — far more usable than the raw JSON textarea
 * we previously fell back to for these fields.
 */
export function BoolOrListField({ name, label, help, disabled }: CommonProps) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  const value = field.value;
  const isList = Array.isArray(value);
  const isBool = typeof value === 'boolean';

  // Local-only "show list editor" toggle: when the value is `false`, the user
  // can still flip into list mode without committing an empty list yet.
  const [listMode, setListMode] = React.useState<boolean>(isList);
  React.useEffect(() => {
    if (isList) setListMode(true);
  }, [isList]);

  return (
    <BasicField label={label} help={help}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            value={isList ? true : Boolean(value)}
            disabled={disabled}
            onValueChange={(nv) => {
              if (listMode) {
                // List mode: switch toggles between [] and false.
                field.onChange(nv ? (isList ? value : []) : false);
              } else {
                field.onChange(nv);
              }
            }}
          />
          <button
            type="button"
            disabled={disabled}
            className="text-xs text-[--muted] underline-offset-2 hover:underline"
            onClick={() => {
              const next = !listMode;
              setListMode(next);
              // Switching modes coerces the value so the schema sees the right
              // shape on the next save.
              if (next && !isList) field.onChange([]);
              if (!next && isList) field.onChange(value.length > 0);
            }}
          >
            {listMode ? 'Use simple toggle' : 'Use allow-list'}
          </button>
        </div>
        {listMode && (
          <StringListField
            name={name}
            label=""
            help={undefined}
            disabled={disabled || !Array.isArray(field.value)}
          />
        )}
        {!listMode && isBool && (
          <p className="text-xs text-[--muted]">
            {value ? 'Enabled for everything.' : 'Disabled.'}
          </p>
        )}
      </div>
    </BasicField>
  );
}

/**
 * DurationField stores whole SECONDS (the backend's unit for config
 * durations). Display/parse delegate to the shared millisecond helpers in
 * `lib/format` (the single decimal-aware duration implementation), converting
 * at the seconds⇄ms boundary.
 */
function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '';
  if (totalSeconds === 0) return '0s';
  return formatDurationMs(Math.round(totalSeconds) * 1000);
}

/**
 * Parse a friendly duration string to whole seconds. A bare integer is taken
 * as seconds (config unit); unit strings (`30m`, `1h`, `1.5h`) go through the
 * shared ms parser. Returns `null` for unparseable input so the field can
 * surface a validation error without committing a bad value.
 */
function parseDurationToSeconds(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (/^-?\d+$/.test(t)) return Number(t); // bare integer = seconds
  if (!/[a-z]/i.test(t)) return null; // bare non-integer without a unit = invalid
  const ms = parseDuration(t);
  return ms == null ? null : Math.round(ms / 1000);
}

/**
 * Editor for duration config fields (`ui.kind === 'duration'`). The committed
 * value stays the numeric second-count the backend stores (so the dirty diff
 * and env-locked logic in `settings-page` keep working and there is no
 * `NumberInput` 0-coercion), while the input shows/accepts a friendly string
 * like `1d` or `30m`.
 */
export function DurationField({ name, label, help, disabled }: CommonProps) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  const numeric =
    typeof field.value === 'number'
      ? field.value
      : Number(field.value ?? 0) || 0;

  const [text, setText] = React.useState(() => formatDuration(numeric));
  const [err, setErr] = React.useState<string | null>(null);

  // Resync when the form is reset / value changes upstream, unless the
  // current text already represents the same value (avoids clobbering input).
  React.useEffect(() => {
    if (parseDurationToSeconds(text) !== numeric) {
      setText(formatDuration(numeric));
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeric]);

  return (
    <BasicField label={label} help={help} error={err ?? undefined}>
      <TextInput
        value={text}
        disabled={disabled}
        placeholder='e.g. "30m", "1h", "1d"'
        onValueChange={(v) => {
          setText(v);
          const secs = parseDurationToSeconds(v);
          if (secs == null) {
            setErr('Invalid duration. Use e.g. 30s, 5m, 1h, 1d, 2w.');
          } else {
            setErr(null);
            field.onChange(secs);
          }
        }}
      />
    </BasicField>
  );
}

/** Editor for free-form long strings (e.g. multi-line env-style credentials). */
export function MultilineStringField({
  name,
  label,
  help,
  disabled,
  secretSet,
}: CommonProps) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  const isClearing = field.value === SECRET_CLEAR_SENTINEL;
  const effectiveHelp = isClearing
    ? `${help ? help + ' · ' : ''}Will be cleared on save.`
    : help;
  return (
    <BasicField label={label} help={effectiveHelp}>
      {secretSet && (
        <div className="flex justify-end mb-1">
          <Button
            size="sm"
            intent={isClearing ? 'gray-subtle' : 'alert-subtle'}
            leftIcon={<BiTrash />}
            onClick={() =>
              field.onChange(isClearing ? '' : SECRET_CLEAR_SENTINEL)
            }
            disabled={disabled}
          >
            {isClearing ? 'Cancel clear' : 'Clear value'}
          </Button>
        </div>
      )}
      <Textarea
        value={isClearing ? '' : field.value == null ? '' : String(field.value)}
        disabled={disabled || isClearing}
        placeholder={
          isClearing
            ? '(will be cleared on save)'
            : secretSet
              ? '(value set — type to replace)'
              : undefined
        }
        rows={6}
        className="font-mono text-xs"
        onValueChange={(v) => field.onChange(v)}
      />
    </BasicField>
  );
}

const SIZE_UNITS: Array<[string, number]> = [
  ['GB', 1_000_000_000],
  ['MB', 1_000_000],
  ['KB', 1_000],
  ['B', 1],
];

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes === 0) return '0B';
  for (const [unit, factor] of SIZE_UNITS) {
    if (bytes >= factor) {
      const val = bytes / factor;
      return `${Number.isInteger(val) ? val : val.toFixed(1)}${unit}`;
    }
  }
  return `${bytes}B`;
}

function parseSizeToBytes(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([kmg]?b)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'b').toLowerCase();
  const mult: Record<string, number> = {
    b: 1,
    kb: 1_000,
    mb: 1_000_000,
    gb: 1_000_000_000,
  };
  return Math.floor(n * mult[unit]);
}

/**
 * Editor for byte-size config fields (`ui.kind === 'size'`). Shows/accepts
 * human-readable strings like `20MB` or `1.5GB` while storing numeric bytes.
 */
export function SizeField({ name, label, help, disabled }: CommonProps) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  const numeric =
    typeof field.value === 'number'
      ? field.value
      : Number(field.value ?? 0) || 0;

  const [text, setText] = React.useState(() => formatSize(numeric));
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (parseSizeToBytes(text) !== numeric) {
      setText(formatSize(numeric));
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeric]);

  return (
    <BasicField label={label} help={help} error={err ?? undefined}>
      <TextInput
        value={text}
        disabled={disabled}
        placeholder='e.g. "20MB", "1GB", "500KB"'
        onValueChange={(v) => {
          setText(v);
          const bytes = parseSizeToBytes(v);
          if (bytes == null) {
            setErr('Invalid size. Use e.g. 500KB, 20MB, 1GB.');
          } else {
            setErr(null);
            field.onChange(bytes);
          }
        }}
      />
    </BasicField>
  );
}

/** Fallback JSON editor for `boolOrList` / unstructured (`json`) fields. */
export function JsonField({ name, label, help, disabled }: CommonProps) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  const [text, setText] = React.useState(() =>
    JSON.stringify(field.value ?? null, null, 2)
  );
  const [err, setErr] = React.useState<string | null>(null);

  // Re-sync when the form is reset externally.
  React.useEffect(() => {
    setText(JSON.stringify(field.value ?? null, null, 2));
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.value]);

  return (
    <BasicField label={label} help={help} error={err ?? undefined}>
      <Textarea
        value={text}
        disabled={disabled}
        rows={4}
        className="font-mono text-xs"
        onValueChange={(v) => {
          setText(v);
          try {
            field.onChange(JSON.parse(v));
            setErr(null);
          } catch {
            setErr('Invalid JSON');
          }
        }}
      />
    </BasicField>
  );
}
