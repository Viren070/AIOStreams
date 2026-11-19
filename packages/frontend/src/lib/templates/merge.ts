import type { UserData } from '@aiostreams/core';

/**
 * Fields an update never asks about. Identity and server state, this feature's
 * own bookkeeping, and `services`, which the wizard has the user pick again on
 * every apply.
 */
const NOT_A_SETTING = new Set([
  'uuid',
  'encryptedPassword',
  'ip',
  'trusted',
  'parentConfig',
  'appliedTemplates',
  'services',
]);

/** A field both the user and a template update have changed. */
export interface TemplateUpdateConflict {
  field: string;
  mine: unknown;
  theirs: unknown;
}

/** One setting an update changes, with the value it holds now and after. */
export interface TemplateUpdateChange {
  field: string;
  mine: unknown;
  theirs: unknown;
  /** The user changed this too, so they choose which value stays. */
  conflict: boolean;
}

export interface TemplateUpdatePlan {
  /** Fields the update changes. Everything else is left as the user has it. */
  changed: string[];
  /** The same fields with their values, in the order the update lists them. */
  changes: TemplateUpdateChange[];
  /** Of those, the ones the user has also changed. */
  conflicts: TemplateUpdateConflict[];
  /** False when the template was applied before its config was stored. */
  hasBaseline: boolean;
}

const comparable = (value: unknown) => JSON.stringify(value ?? null);

const byInstance = (presets: unknown): Map<string, unknown> =>
  new Map(
    (Array.isArray(presets) ? presets : [])
      .filter((p: any) => typeof p?.instanceId === 'string')
      .map((p: any) => [p.instanceId, p])
  );

/**
 * True when an addon was changed both by the user and by the update, or when
 * the update adds an addon under an id the user already uses.
 */
function presetsConflict(base: unknown, mine: unknown, theirs: unknown) {
  const b = byInstance(base);
  const m = byInstance(mine);
  const t = byInstance(theirs);
  for (const id of new Set([...b.keys(), ...t.keys()])) {
    const ours = comparable(m.get(id));
    const incoming = comparable(t.get(id));
    if (!b.has(id)) {
      if (m.has(id) && t.has(id) && ours !== incoming) return true;
      continue;
    }
    const original = comparable(b.get(id));
    if (original !== ours && original !== incoming && ours !== incoming)
      return true;
  }
  return false;
}

/**
 * Works out what a template update changes and which of those changes would
 * replace something the user changed themselves.
 *
 * `base` is the template's config as it was last applied. A field is part of
 * the update only when the new config differs from it, and a conflict only
 * when the user has also moved it away from `base`. Without a base every field
 * the update would change is listed, since there is no way to tell who changed
 * it.
 */
export function planTemplateUpdate(
  base: Partial<UserData> | undefined,
  mine: Partial<UserData>,
  theirs: Partial<UserData>
): TemplateUpdatePlan {
  const changed: string[] = [];
  const conflicts: TemplateUpdateConflict[] = [];
  const changes: TemplateUpdateChange[] = [];

  for (const field of Object.keys(theirs)) {
    if (NOT_A_SETTING.has(field)) continue;
    const incoming = (theirs as any)[field];
    const current = (mine as any)?.[field];
    if (comparable(current) === comparable(incoming)) continue;
    const original = base ? (base as any)[field] : undefined;
    if (base && comparable(original) === comparable(incoming)) continue;
    changed.push(field);

    const after =
      field === 'presets' && base
        ? mergePresets(original, current, incoming)
        : incoming;
    const conflict = !base
      ? true
      : field === 'presets'
        ? presetsConflict(original, current, incoming)
        : comparable(original) !== comparable(current);
    changes.push({ field, mine: current, theirs: after, conflict });
    if (conflict) conflicts.push({ field, mine: current, theirs: incoming });
  }

  return { changed, changes, conflicts, hasBaseline: Boolean(base) };
}

/**
 * The template's addons as updated, keeping the user's edits to addons the
 * update leaves alone, the addons the user added, and their removals. Keeps the
 * user's order unless the update reorders the template's addons.
 */
export function mergePresets(
  base: unknown,
  mine: unknown,
  theirs: unknown
): unknown[] {
  const b = byInstance(base);
  const m = byInstance(mine);
  const theirList = Array.isArray(theirs) ? theirs : [];
  const mineList = Array.isArray(mine) ? mine : [];
  const t = byInstance(theirList);

  const pick = (p: any) => {
    const id = p?.instanceId;
    if (b.has(id) && !m.has(id))
      return comparable(b.get(id)) === comparable(p) ? null : p;
    if (b.has(id) && m.has(id) && comparable(b.get(id)) === comparable(p))
      return m.get(id);
    return p;
  };

  const sharedOrder = (list: unknown[]) =>
    list
      .map((p: any) => p?.instanceId)
      .filter((id) => b.has(id) && t.has(id))
      .join(',');
  const reordered =
    sharedOrder(Array.isArray(base) ? base : []) !== sharedOrder(theirList);

  const addedByUser = mineList.filter(
    (p: any) => !b.has(p?.instanceId) && !t.has(p?.instanceId)
  );
  const fromTemplate = theirList.map(pick).filter((p) => p !== null);
  if (reordered) return [...fromTemplate, ...addedByUser];

  const newFromTemplate = fromTemplate.filter(
    (p: any) => !m.has(p?.instanceId) || !b.has(p?.instanceId)
  );
  const kept = mineList
    .filter((p: any) => t.has(p?.instanceId) && b.has(p?.instanceId))
    .map((p: any) => pick(t.get(p.instanceId)))
    .filter((p) => p !== null);
  return [...kept, ...newFromTemplate, ...addedByUser];
}

/** Keeps the user's credentials wherever the incoming service leaves one blank. */
function mergeServices(mine: unknown, theirs: unknown): unknown {
  if (!Array.isArray(theirs)) return theirs;
  const existing = Array.isArray(mine) ? mine : [];
  return theirs.map((service: any) => {
    const current = existing.find((s: any) => s?.id === service?.id);
    const credentials = { ...(current?.credentials ?? {}) };
    for (const [key, value] of Object.entries(service?.credentials ?? {})) {
      if (value !== '' && value !== undefined) credentials[key] = value;
    }
    return { ...service, credentials };
  });
}

/**
 * The user's config after applying `incoming`. With no plan (a first apply)
 * every field the template sets is taken. With a plan only the fields the
 * update changes are taken, except those named in `keepMine`.
 */
export function mergeTemplateUpdate(
  prev: any,
  incoming: any,
  plan: TemplateUpdatePlan | null,
  keepMine: ReadonlySet<string>,
  base: any
): any {
  if (!plan) return { ...prev, ...incoming };

  const next = { ...prev };
  if ('services' in incoming)
    next.services = mergeServices(prev?.services, incoming.services);
  for (const field of plan.changed) {
    if (keepMine.has(field)) continue;
    next[field] =
      field === 'presets' && plan.hasBaseline
        ? mergePresets(base?.presets, prev?.presets, incoming.presets)
        : incoming[field];
  }
  return next;
}
