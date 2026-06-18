import type { z } from 'zod';
import { runtimeSchemas } from './index.js';
import {
  seconds,
  secondsAllowingDisabled,
  byteSize,
} from './schema/helpers.js';
import {
  isRuntimeConfigField,
  RuntimeConfigUiOverride,
  type RuntimeConfigNode,
} from './types.js';

/**
 * Duration helper schemas
 */
const DURATION_SCHEMAS: ReadonlySet<unknown> = new Set([
  seconds,
  secondsAllowingDisabled,
]);

/**
 * Size helper schemas (human-readable byte sizes, e.g. "20MB")
 */
const SIZE_SCHEMAS: ReadonlySet<unknown> = new Set([byteSize]);

/**
 * UI rendering hint for a single config field, derived by introspecting the
 * field's zod schema. The dashboard Settings page uses this to pick a
 * `Field.*` component.
 */
export type SettingsUiKind =
  | 'boolean'
  | 'number'
  | 'string'
  | 'enum'
  | 'list' // string[]
  | 'map' // Record<string, string|number|boolean>
  | 'boolOrList' // boolean | string[]
  | 'duration' // human-friendly duration string ⇄ numeric seconds
  | 'size' // human-friendly byte size string ⇄ numeric bytes
  | 'json'; // anything we can't structure - raw JSON textarea

export interface SettingsUiHint {
  kind: SettingsUiKind;
  /** For `enum` - the allowed string values. */
  options?: string[];
  /** For `map` - the value cell kind. */
  mapValueKind?: 'string' | 'number' | 'boolean' | 'numberOrBool' | 'json';
  /** For `map` - column ratio (default `equal`). */
  mapWidth?: 'equal' | 'wide-key' | 'wide-value';
  /** For `string` - render as textarea. */
  multiline?: boolean;
  /** For `number` - minimum allowed value (default: 0). */
  min?: number;
  /** Hidden from the generic settings page (managed by a bespoke editor). */
  hidden?: boolean;
}

type AnyZod = z.ZodType & {
  _def?: {
    type?: string;
    typeName?: string;
    innerType?: AnyZod;
    options?: AnyZod[];
    entries?: Record<string, string | number>;
    values?: Array<string | number>;
    valueType?: AnyZod;
    element?: AnyZod;
    in?: AnyZod;
    out?: AnyZod;
  };
};

function def(s: AnyZod) {
  return s?._def ?? {};
}
function typeOf(s: AnyZod): string {
  const d = def(s);
  return d.type ?? d.typeName ?? 'unknown';
}

/** Strip optional/nullable/default/catch/readonly/pipe wrappers. */
function unwrap(s: AnyZod): AnyZod {
  let cur = s;
  for (let i = 0; i < 12 && cur; i++) {
    const t = typeOf(cur);
    const d = def(cur);
    if (
      (t === 'optional' ||
        t === 'nullable' ||
        t === 'default' ||
        t === 'catch' ||
        t === 'readonly' ||
        t === 'prefault') &&
      d.innerType
    ) {
      cur = d.innerType;
      continue;
    }
    // zod v4 pipe (used by .transform()) - prefer the input shape
    if (t === 'pipe' && (d.in || d.out)) {
      cur = (d.in as AnyZod) ?? (d.out as AnyZod);
      continue;
    }
    break;
  }
  return cur;
}

function recordValueKind(rec: AnyZod): SettingsUiHint['mapValueKind'] {
  const vt = unwrap(def(rec).valueType as AnyZod);
  const t = vt ? typeOf(vt) : 'unknown';
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'union') {
    const opts = (def(vt).options ?? []).map((o) => typeOf(unwrap(o)));
    if (opts.includes('number') && opts.includes('boolean'))
      return 'numberOrBool';
    if (opts.every((o) => o === 'number')) return 'number';
    if (opts.every((o) => o === 'string')) return 'string';
  }
  return 'json';
}

function classify(schema: AnyZod): SettingsUiHint {
  const s = unwrap(schema);
  const t = typeOf(s);

  if (t === 'boolean') return { kind: 'boolean' };
  if (t === 'number' || t === 'int' || t === 'bigint')
    return { kind: 'number' };
  if (t === 'string') return { kind: 'string' };

  if (t === 'enum') {
    const entries = def(s).entries;
    const values = def(s).values;
    const options = entries
      ? Object.values(entries).map(String)
      : (values ?? []).map(String);
    return { kind: 'enum', options };
  }
  if (t === 'literal') {
    const v = def(s).values ?? [];
    return { kind: 'enum', options: v.map(String) };
  }

  if (t === 'array') {
    const el = unwrap(def(s).element as AnyZod);
    if (el && typeOf(el) === 'string') return { kind: 'list' };
    return { kind: 'json' };
  }

  if (t === 'record' || t === 'object') {
    return { kind: 'map', mapValueKind: recordValueKind(s) };
  }

  if (t === 'union') {
    const allOpts = (def(s).options ?? []).map((o) => unwrap(o));
    const opts = allOpts.filter(
      (o) => typeOf(o) !== 'null' && typeOf(o) !== 'undefined'
    );
    const kinds = (opts.length > 0 ? opts : allOpts).map((o) => typeOf(o));
    const hasBool = kinds.includes('boolean');
    const hasArray = kinds.includes('array');
    const hasRecord = kinds.includes('record') || kinds.includes('object');

    if (hasRecord) {
      const rec = opts.find(
        (o) => typeOf(o) === 'record' || typeOf(o) === 'object'
      )!;
      return { kind: 'map', mapValueKind: recordValueKind(rec) };
    }
    if (hasBool && hasArray) return { kind: 'boolOrList' };
    // string | array(string) union: env-coerced list fields (commaSeparatedList, urlOrUrlList, stringOrStringList, …)
    if (hasArray && !hasBool) {
      const arr = opts.find((o) => typeOf(o) === 'array');
      if (arr) {
        const el = unwrap(def(arr).element as AnyZod);
        if (el && typeOf(el) === 'string') return { kind: 'list' };
      }
    }
    if (kinds.every((k) => k === 'literal' || k === 'enum')) {
      const options: string[] = [];
      for (const o of opts) {
        const v = def(o).values ?? Object.values(def(o).entries ?? {});
        for (const x of v) options.push(String(x));
      }
      return { kind: 'enum', options };
    }
    // number|string (env-coerced numeric helpers) ⇒ number
    if (kinds.includes('number')) return { kind: 'number' };
    if (kinds.every((k) => k === 'string')) return { kind: 'string' };
  }

  return { kind: 'json' };
}

function* walk(
  node: Record<string, RuntimeConfigNode>,
  path: string[]
): Generator<{
  key: string;
  schema: z.ZodType;
  ui?: RuntimeConfigUiOverride;
}> {
  for (const [name, child] of Object.entries(node)) {
    const childPath = [...path, name];
    if (isRuntimeConfigField(child)) {
      yield {
        key: childPath.join('.'),
        schema: child.schema,
        ui: child.ui,
      };
    } else {
      yield* walk(child as Record<string, RuntimeConfigNode>, childPath);
    }
  }
}

let cache: Record<string, SettingsUiHint> | null = null;

/**
 * Returns a `{ [dottedKey]: SettingsUiHint }` map describing how each runtime
 * config field should be rendered.
 */
export function describeSettings(): Record<string, SettingsUiHint> {
  if (cache) return cache;
  const out: Record<string, SettingsUiHint> = {};
  for (const [section, tree] of Object.entries(runtimeSchemas)) {
    for (const { key, schema, ui } of walk(
      tree as Record<string, RuntimeConfigNode>,
      [section]
    )) {
      const hint: SettingsUiHint = DURATION_SCHEMAS.has(schema)
        ? { kind: 'duration' }
        : SIZE_SCHEMAS.has(schema)
          ? { kind: 'size' }
          : classify(schema as AnyZod);
      if (ui?.kind) hint.kind = ui.kind;
      if (ui?.multiline) hint.multiline = true;
      if (ui?.mapWidth) hint.mapWidth = ui.mapWidth;
      if (ui?.min !== undefined) hint.min = ui.min;
      if (ui?.hidden) hint.hidden = true;
      out[key] = hint;
    }
  }
  cache = out;
  return out;
}
