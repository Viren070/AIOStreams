import type { UserData } from '@aiostreams/core';
import {
  createCelBudget,
  parseCelScript,
  runCelProgram,
  type CelPath,
  type CelProgram,
} from '../../../core/src/variants/language';

/**
 * The scripts stay the only record: a row is read by applying its variants,
 * and a choice is written as `enable`/`disable` lines in the variant it owns.
 */

type Variant = NonNullable<UserData['variants']>[number];

/** Config fields a view holds; anything chosen per audience must live in one. */
const VIEW_ROOTS = [
  'presets',
  'catalogModifications',
  'mergedCatalogs',
] as const;
type ViewRoot = (typeof VIEW_ROOTS)[number];
export type View = Partial<Pick<UserData, ViewRoot>>;

export interface Audience {
  key: string;
  kind: 'base' | 'user' | 'link';
  label: string;
  caption?: string;
  avatar?: string;
  chain: string[];
  /** The variant its choices are written to. */
  own?: string;
  /** The Jellyfin user it is, `''` for the primary user. */
  userId?: string;
  /** Why its choices can't be made here. */
  locked?: string;
}

export interface EntryRef {
  root: ViewRoot;
  match: Record<string, string>;
}

/** Entries switched on and off together; the first one is read. */
export interface Toggle {
  label: string;
  entries: EntryRef[];
}

const PRIMARY_VARIANT_ID = 'primary';

/**
 * Where a user's own choices live: a persona's id, or `primary` for the
 * primary user (`''`). Undefined for the primary user while a persona holds
 * that id.
 */
function ownVariantId(
  userData: Pick<UserData, 'jellyfin'>,
  userId: string
): string | undefined {
  if (userId) return userId;
  return userData.jellyfin?.personas?.some((p) => p.id === PRIMARY_VARIANT_ID)
    ? undefined
    : PRIMARY_VARIANT_ID;
}

export function listAudiences(
  userData: Pick<UserData, 'variants' | 'jellyfin' | 'addonName'>,
  jellyfin: boolean
): Audience[] {
  const variants = userData.variants ?? [];
  const audiences: Audience[] = [
    {
      key: 'base',
      kind: 'base',
      label: 'Base config',
      caption: 'Install links without a variant',
      chain: [],
    },
  ];
  const primary = userData.jellyfin?.primary;
  const users = [
    {
      id: '',
      name: primary?.name || userData.addonName || 'Primary user',
      avatar: primary?.avatar,
      variants: primary?.variants ?? [],
    },
    ...(userData.jellyfin?.personas ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      variants: p.variants ?? [],
    })),
  ];
  const used = new Set(users.flatMap((user) => user.variants));
  if (jellyfin) {
    for (const user of users) {
      const own = ownVariantId(userData, user.id);
      audiences.push({
        key: `user:${user.id}`,
        kind: 'user',
        label: user.name,
        caption: user.id ? undefined : 'Primary user',
        avatar: user.avatar,
        chain: user.variants,
        own,
        userId: user.id,
        locked: !own
          ? 'Another user has the id "primary", so the primary user has no variant of its own.'
          : variants.some((v) => v.id === own) && !user.variants.includes(own)
            ? `A variant called "${own}" already exists. Pick it for ${user.name} under Users to choose for them here.`
            : undefined,
      });
    }
  }
  for (const variant of variants) {
    if (variant.enabled === false || variant.when || used.has(variant.id))
      continue;
    audiences.push({
      key: `link:${variant.id}`,
      kind: 'link',
      label: variant.name || variant.id,
      caption: `/v/${variant.id}`,
      chain: [variant.id],
      own: variant.id,
    });
  }
  return audiences;
}

export function compilePrograms(
  variants: Variant[] | undefined
): Map<string, CelProgram> {
  const programs = new Map<string, CelProgram>();
  for (const variant of variants ?? []) {
    if (variant.enabled !== false) {
      programs.set(variant.id, parseCelScript(variant.script).program);
    }
  }
  return programs;
}

export function viewOf(
  source: View,
  chain: string[],
  programs: Map<string, CelProgram>,
  work: number,
  roots: readonly ViewRoot[] = VIEW_ROOTS
): View {
  const view: View = {};
  for (const root of roots) {
    if (source[root] !== undefined) {
      (view as any)[root] = structuredClone(source[root]);
    }
  }
  const budget = createCelBudget(work);
  for (const id of chain) {
    const program = programs.get(id);
    if (!program) continue;
    runCelProgram(view as UserData, program, {
      resolveVariant: (ref) => programs.get(ref.toLowerCase()),
      activeVariants: [id],
      budget,
    });
  }
  return view;
}

const indexes = new WeakMap<object, Map<string, Map<string, any>>>();

/** Views are never changed once made, so each list is indexed once per field set. */
function find(view: View, ref: EntryRef): any {
  const list = view[ref.root];
  if (!Array.isArray(list)) return undefined;
  const fields = Object.keys(ref.match);
  const fieldsKey = fields.join('\0');
  let byFields = indexes.get(list);
  if (!byFields) indexes.set(list, (byFields = new Map()));
  let index = byFields.get(fieldsKey);
  if (!index) {
    index = new Map();
    for (const entry of list as any[]) {
      const key = fields.map((f) => String(entry?.[f])).join('\0');
      if (!index.has(key)) index.set(key, entry);
    }
    byFields.set(fieldsKey, index);
  }
  return index.get(fields.map((f) => ref.match[f]).join('\0'));
}

/** Undefined when the view has no such entry at all. */
export function isOn(view: View, toggle: Toggle): boolean | undefined {
  const entry = find(view, toggle.entries[0]);
  return entry ? entry.enabled !== false : undefined;
}

export function summarise(
  audiences: Audience[],
  states: (boolean | undefined)[]
): string | undefined {
  const on = audiences.filter((_, i) => states[i]);
  const off = audiences.filter((_, i) => !states[i]);
  if (!on.length || !off.length) return undefined;
  const names = (list: Audience[]) => {
    const labels = list.map((a) =>
      a.kind === 'base' ? 'the base config' : a.label
    );
    return labels.length <= 2
      ? labels.join(' and ')
      : `${labels[0]} and ${labels.length - 1} more`;
  };
  return on.length <= off.length
    ? `Only ${names(on)}`
    : `All but ${names(off)}`;
}

/** Conditional variants that change a toggle on the requests they match. */
export function conditionalTouching(
  source: View,
  variants: Variant[] | undefined,
  programs: Map<string, CelProgram>,
  toggles: Toggle[],
  work: number
): string[] {
  const base = viewOf(source, [], programs, work);
  return (variants ?? [])
    .filter((v) => v.enabled !== false && v.when)
    .filter((v) => {
      const view = viewOf(source, [v.id], programs, work);
      return toggles.some((t) => isOn(view, t) !== isOn(base, t));
    })
    .map((v) => v.name || v.id);
}

const pathOf = (ref: EntryRef) =>
  ref.root +
  Object.entries(ref.match)
    .map(([key, value]) => `[${key}=${JSON.stringify(value)}]`)
    .join('');

function linesFor(toggle: Toggle, on: boolean): string[] {
  const note = toggle.label.replace(/\s+/g, ' ').trim();
  return toggle.entries.map(
    (ref) =>
      `${on ? 'enable' : 'disable'} ${pathOf(ref)}${note ? ` # ${note}` : ''}`
  );
}

function addresses(path: CelPath, ref: EntryRef): boolean {
  const [segment, ...rest] = path.segments;
  if (path.root !== ref.root || rest.length || segment?.kind !== 'filter')
    return false;
  const wanted = Object.entries(ref.match);
  return (
    segment.conditions.length === wanted.length &&
    wanted.every(([key, value]) =>
      segment.conditions.some(
        (c) => c.key === key && c.operator === '=' && String(c.value) === value
      )
    )
  );
}

/** Drops the `enable`/`disable` lines that address any of `refs`. */
function withoutLines(script: string, refs: EntryRef[]): string {
  const { program } = parseCelScript(script);
  const drop = new Set(
    program.statements
      .filter(
        (s) =>
          (s.op === 'enable' || s.op === 'disable') &&
          refs.some((ref) => addresses(s.path, ref))
      )
      .map((s) => s.line)
  );
  if (!drop.size) return script;
  return script
    .split(/\r?\n/)
    .filter((_, i) => !drop.has(i + 1))
    .join('\n')
    .trimEnd();
}

/** Edits to variants and users' lists, tracked so empty own variants can go. */
class VariantEdits {
  variants: Variant[];
  jellyfin: UserData['jellyfin'];
  programs: Map<string, CelProgram>;
  readonly touched = new Set<string>();

  constructor(userData: UserData) {
    this.variants = [...(userData.variants ?? [])];
    this.jellyfin = userData.jellyfin;
    this.programs = compilePrograms(this.variants);
  }

  scriptOf(id: string): string | undefined {
    return this.variants.find((v) => v.id === id)?.script;
  }

  setScript(id: string, script: string, name?: string): void {
    if (this.scriptOf(id) === undefined) {
      this.variants.push({ id, name, script });
    } else {
      this.variants = this.variants.map((v) =>
        v.id === id ? { ...v, script } : v
      );
    }
    this.programs.set(id, parseCelScript(script).program);
    this.touched.add(id);
  }

  strip(id: string, refs: EntryRef[]): void {
    const script = this.scriptOf(id);
    if (script === undefined || !refs.length) return;
    const next = withoutLines(script, refs);
    if (next !== script) this.setScript(id, next);
  }

  listOf(userId: string): string[] {
    const list = userId
      ? this.jellyfin?.personas?.find((p) => p.id === userId)?.variants
      : this.jellyfin?.primary?.variants;
    return list ?? [];
  }

  setList(userId: string, list: string[]): void {
    const variants = list.length ? list : undefined;
    this.jellyfin = userId
      ? {
          ...this.jellyfin,
          personas: this.jellyfin?.personas?.map((p) =>
            p.id === userId ? { ...p, variants } : p
          ),
        }
      : {
          ...this.jellyfin,
          primary: { ...this.jellyfin?.primary, variants },
        };
  }

  isReferenced(id: string, exceptUser: string): boolean {
    const users = [
      { id: '', variants: this.jellyfin?.primary?.variants },
      ...(this.jellyfin?.personas ?? []),
    ];
    return (
      users.some((u) => u.id !== exceptUser && u.variants?.includes(id)) ||
      [...this.programs.values()].some((p) =>
        p.referencedVariants.some((ref) => ref.toLowerCase() === id)
      )
    );
  }

  /** Removes a user's own variant once it holds nothing. */
  release(id: string, userId: string): void {
    if (this.scriptOf(id)?.trim() || this.isReferenced(id, userId)) return;
    this.variants = this.variants.filter((v) => v.id !== id);
    this.programs.delete(id);
    if (this.listOf(userId).includes(id)) {
      this.setList(
        userId,
        this.listOf(userId).filter((v) => v !== id)
      );
    }
  }

  apply(userData: UserData): UserData {
    return {
      ...userData,
      variants: this.variants.length ? this.variants : undefined,
      jellyfin: this.jellyfin,
    };
  }
}

export interface AssignResult {
  userData: UserData;
  problems: string[];
}

/**
 * Sets the toggles for the audiences in `set` and keeps every other audience
 * as it was. Lines about one entry never affect another, so each audience's
 * toggles are settled together.
 */
export function assignAudiences(
  userData: UserData,
  audiences: Audience[],
  toggles: Toggle[],
  set: ReadonlyMap<string, boolean>,
  work: number
): AssignResult {
  const edits = new VariantEdits(userData);
  const roots = [
    ...new Set(toggles.flatMap((t) => t.entries.map((e) => e.root))),
  ];
  const refs = toggles.flatMap((t) => t.entries);
  const base: View = {};
  for (const root of roots) {
    if (userData[root] !== undefined) {
      (base as any)[root] = structuredClone(userData[root]);
    }
  }

  const chainOf = (a: Audience) =>
    a.kind === 'user' ? edits.listOf(a.userId!) : a.chain;
  const statesOf = (a: Audience, programs = edits.programs) => {
    const view = viewOf(base, chainOf(a), programs, work, roots);
    return toggles.map((t) => isOn(view, t));
  };
  const before = new Map(audiences.map((a) => [a.key, statesOf(a)]));
  const wantedOf = (a: Audience) =>
    before.get(a.key)!.map((state) => set.get(a.key) ?? state);

  const wantBase = set.get('base');
  const baseLines = toggles.flatMap((t, i) =>
    wantBase !== undefined && before.get('base')![i] !== wantBase
      ? linesFor(t, wantBase)
      : []
  );
  if (baseLines.length) {
    // The base config is edited directly, so no request budget applies.
    const { program } = parseCelScript(baseLines.join('\n'));
    runCelProgram(base as UserData, program, {
      budget: createCelBudget(Infinity),
    });
  }

  for (const a of audiences) {
    if (a.kind === 'base' || a.locked || !a.own) continue;
    const wanted = wantedOf(a);
    const current = statesOf(a);
    const script = edits.scriptOf(a.own);
    let stripped = current;
    if (script !== undefined) {
      const programs = new Map(edits.programs);
      programs.set(a.own, parseCelScript(withoutLines(script, refs)).program);
      stripped = statesOf(a, programs);
    }
    // Lines that keep an audience right stay where they are.
    const drop = toggles.filter(
      (_, i) =>
        wanted[i] !== undefined &&
        (stripped[i] === wanted[i] || current[i] !== wanted[i])
    );
    const add = toggles.flatMap((t, i) =>
      wanted[i] !== undefined &&
      stripped[i] !== wanted[i] &&
      current[i] !== wanted[i]
        ? linesFor(t, wanted[i]!)
        : []
    );
    edits.strip(
      a.own,
      drop.flatMap((t) => t.entries)
    );
    if (!add.length) continue;
    if (a.kind === 'user' && !edits.listOf(a.userId!).includes(a.own)) {
      edits.setList(a.userId!, [...edits.listOf(a.userId!), a.own]);
    }
    edits.setScript(
      a.own,
      [edits.scriptOf(a.own)?.trimEnd(), ...add].filter(Boolean).join('\n'),
      a.kind === 'user' ? a.label : undefined
    );
  }

  const problems: string[] = [];
  for (const a of audiences) {
    const wanted = wantedOf(a);
    const after = statesOf(a);
    const chain = chainOf(a);
    const reason = a.locked
      ? a.locked
      : a.own && chain.indexOf(a.own) < chain.length - 1
        ? 'A variant after theirs decides it.'
        : 'Their variants remove it.';
    toggles.forEach((t, i) => {
      if (wanted[i] === undefined || after[i] === wanted[i]) return;
      problems.push(
        `${t.label}: couldn't ${wanted[i] ? 'give it to' : 'take it from'} ${a.label}. ${reason}`
      );
    });
  }

  for (const a of audiences) {
    if (a.kind === 'user' && a.own && edits.touched.has(a.own)) {
      edits.release(a.own, a.userId!);
    }
  }

  const result = edits.apply(userData);
  if (baseLines.length) {
    for (const root of roots) (result as any)[root] = base[root];
  }
  return { userData: result, problems };
}

/** Drops every variant line about these entries. */
export function forgetEntries(userData: UserData, refs: EntryRef[]): UserData {
  if (!refs.length || !userData.variants?.length) return userData;
  const edits = new VariantEdits(userData);
  for (const variant of userData.variants) edits.strip(variant.id, refs);
  if (!edits.touched.size) return userData;
  const users = [
    { id: '', variants: userData.jellyfin?.primary?.variants },
    ...(userData.jellyfin?.personas ?? []),
  ];
  for (const user of users) {
    const own = ownVariantId(userData, user.id);
    if (own && edits.touched.has(own) && user.variants?.includes(own)) {
      edits.release(own, user.id);
    }
  }
  return edits.apply(userData);
}

/** Removes a user's own variant unless something else still uses it. */
export function releaseOwnVariant(
  userData: UserData,
  userId: string
): UserData {
  const own = ownVariantId(userData, userId);
  const edits = new VariantEdits(userData);
  if (
    !own ||
    !edits.listOf(userId).includes(own) ||
    edits.isReferenced(own, userId)
  )
    return userData;
  edits.variants = edits.variants.filter((v) => v.id !== own);
  return edits.apply(userData);
}
