import type { UserData } from '@aiostreams/core';

/**
 * Fields an update never asks about. Identity and server state, this feature's
 * own bookkeeping, the user's saved variants, and `services`, which the wizard
 * has the user pick again on every apply.
 */
const NOT_A_SETTING = new Set([
  'uuid',
  'encryptedPassword',
  'ip',
  'trusted',
  'parentConfig',
  'appliedTemplates',
  'variants',
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

const instanceIds = (presets: unknown): Set<string> =>
  new Set(
    (Array.isArray(presets) ? presets : [])
      .map((p: any) => p?.instanceId)
      .filter((id: unknown): id is string => typeof id === 'string')
  );

/** Presets compare by instanceId, not position. */
function comparable(field: string, value: unknown): string {
  if (field === 'presets' && Array.isArray(value)) {
    return JSON.stringify(
      [...value].sort((a: any, b: any) =>
        String(a?.instanceId).localeCompare(String(b?.instanceId))
      )
    );
  }
  return JSON.stringify(value ?? null);
}

/** The user's presets limited to the ones the template supplied. */
function templateOwnedPresets(mine: unknown, base: unknown): unknown {
  const owned = instanceIds(base);
  return (Array.isArray(mine) ? mine : []).filter((p: any) =>
    owned.has(p?.instanceId)
  );
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
    let ours = (mine as any)?.[field];
    if (comparable(field, ours) === comparable(field, incoming)) continue;

    if (base) {
      const original = (base as any)[field];
      if (comparable(field, original) === comparable(field, incoming)) continue;
      changed.push(field);
      // Addons the user added are kept by mergeTemplateUpdate, so only the
      // template's own addons can conflict.
      if (field === 'presets') ours = templateOwnedPresets(ours, original);
    } else {
      changed.push(field);
    }

    const current = (mine as any)?.[field];
    const after =
      field === 'presets' && base
        ? mergePresets((base as any).presets, current, incoming)
        : incoming;
    const userMoved = base
      ? comparable(field, (base as any)[field]) !== comparable(field, ours)
      : true;
    const conflict =
      userMoved && comparable(field, ours) !== comparable(field, incoming);
    changes.push({ field, mine: current, theirs: after, conflict });
    if (conflict) conflicts.push({ field, mine: current, theirs: incoming });
  }

  return { changed, changes, conflicts, hasBaseline: Boolean(base) };
}

/**
 * The template's addons as updated, plus the addons the user added, minus the
 * template addons the user removed.
 */
export function mergePresets(
  base: unknown,
  mine: unknown,
  theirs: unknown
): unknown[] {
  const baseIds = instanceIds(base);
  const mineList = Array.isArray(mine) ? mine : [];
  const mineIds = instanceIds(mineList);
  const theirList = Array.isArray(theirs) ? theirs : [];
  const theirIds = instanceIds(theirList);

  const removedByUser = new Set([...baseIds].filter((id) => !mineIds.has(id)));
  const updated = theirList.filter(
    (p: any) => !removedByUser.has(p?.instanceId)
  );
  const addedByUser = mineList.filter(
    (p: any) => !baseIds.has(p?.instanceId) && !theirIds.has(p?.instanceId)
  );
  return [...updated, ...addedByUser];
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
