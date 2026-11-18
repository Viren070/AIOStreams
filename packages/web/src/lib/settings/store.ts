import React from 'react';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import { storage } from '@/lib/storage';

/**
 * Where a setting lives: with the profile, on the device with a default for
 * every device, or on the device alone.
 */
export type SettingKind = 'synced' | 'device' | 'local';

/**
 * A stored value; `read` returns the same reference until it changes. Without
 * a layer it is this device's signed-in profile.
 */
export interface Setting<T> {
  kind: SettingKind;
  read(layer?: Layer): T;
  write(value: T, layer?: Layer): void;
}

type Synced = Record<string, string>;

/** One profile's settings over everyone's, or everyone's alone. */
export interface Layer {
  /** Whose they are; absent for the signed-in profile. */
  userId?: string;
  own(): Synced;
  inherited(): Synced;
  /** Its own document is everyone's, which also holds defaults for devices. */
  everyone: boolean;
  set(key: string, raw: string | undefined): void;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  listeners.forEach((l) => l());
}

const LayerContext = React.createContext<Layer | null>(null);
/** The settings a page under it shows and changes, when not the device's own. */
export const SettingsLayer = LayerContext.Provider;
export const useSettingsLayer = () => React.useContext(LayerContext);

export function useSetting<T>(setting: Setting<T>): [T, (value: T) => void] {
  const layer = React.useContext(LayerContext) ?? live;
  const read = React.useCallback(() => setting.read(layer), [setting, layer]);
  const write = React.useCallback(
    (value: T) => setting.write(value, layer),
    [setting, layer]
  );
  return [React.useSyncExternalStore(subscribe, read), write];
}

export function onSettingsChange(listener: () => void): () => void {
  return subscribe(listener);
}

/** An older key of a setting, with a reader where the value's shape changed. */
type Was<T> = string | { key: string; read: (old: unknown) => T | undefined };

const wasKey = (old: Was<unknown>) => (typeof old === 'string' ? old : old.key);

function readWas<T>(was: Was<T>[]): { value: unknown } | null {
  for (const old of was) {
    const stored = storage.get<unknown>(wasKey(old));
    if (stored === null) continue;
    return { value: typeof old === 'string' ? stored : old.read(stored) };
  }
  return null;
}

function forget(was: Was<unknown>[]) {
  for (const old of was) storage.remove(wasKey(old));
}

/*
 * Settings that follow the user, kept in Jellyfin's display preferences on the
 * server. The device holds a copy so a page never waits on them; the server's
 * wins once it answers.
 */
const SYNCED_KEYS = new Set<string>();
const DEVICE_KEYS = new Set<string>();

/** Everyone's document holds a device setting's default under this key. */
const deviceDefaultKey = (key: string) => `d:${key}`;

/** Stored over a default for everyone, to keep the built-in one. */
const BUILT_IN = '~';

/** Settings this device kept before they followed the user. */
const moved = new Map<
  string,
  { was: Was<unknown>[]; format: (value: never) => string | undefined }
>();

const PREFS_ID = 'aiostreams-web';
/** Set on every save, so preferences reset to their defaults still count as saved. */
const SAVED_MARK = 'saved';
const cacheKey = (userId: string) => `aiostreams-web-prefs:${userId}`;
const movedKey = (userId: string) => `aiostreams-web-prefs-moved:${userId}`;
let current: Synced = {};
let everyoneDoc: Synced = {};
let session: {
  client: JellyfinClient;
  userId: string;
  everyoneId?: string;
} | null = null;
let generation = 0;

function known(
  prefs: Record<string, unknown> | null | undefined,
  everyone = false
): Synced {
  const out: Synced = {};
  const keys = everyone
    ? [...SYNCED_KEYS, ...[...DEVICE_KEYS].map(deviceDefaultKey)]
    : SYNCED_KEYS;
  for (const key of keys) {
    const value = prefs?.[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

const live: Layer = {
  own: () => current,
  inherited: () => everyoneDoc,
  everyone: false,
  set: (key, raw) => update(key, raw),
};

function fetchPrefs(client: JellyfinClient, userId: string) {
  return client.get<{ CustomPrefs?: Record<string, string | null> }>(
    `/DisplayPreferences/${PREFS_ID}`,
    { client: PREFS_ID, userId }
  );
}

function fromDevice(): Synced {
  const out: Synced = {};
  for (const [key, { was, format }] of moved) {
    const found = readWas(was);
    if (!found || found.value === undefined) continue;
    try {
      const text = format(found.value as never);
      if (text) out[key] = text;
    } catch {}
  }
  return out;
}

function publish(next: Synced) {
  current = next;
  if (session) storage.set(cacheKey(session.userId), next);
  announce();
}

let saving: Promise<unknown> = Promise.resolve();

function push(
  prefs: Synced,
  target: { client: JellyfinClient; userId: string } | null = session
) {
  if (!target) return;
  const { client, userId } = target;
  saving = client
    .post(
      `/DisplayPreferences/${PREFS_ID}`,
      {
        Id: PREFS_ID,
        Client: PREFS_ID,
        CustomPrefs: { ...prefs, [SAVED_MARK]: '1' },
      },
      { client: PREFS_ID, userId }
    )
    .catch(() => undefined);
}

/**
 * A user with nothing saved yet takes this device's settings. Moved settings
 * fill an account's gaps once, or a reset elsewhere would keep coming back.
 */
export function syncPreferences(
  client: JellyfinClient,
  userId: string,
  /** The id everyone's defaults are kept under, on a server that has them. */
  everyoneId?: string
): () => void {
  const mine = ++generation;
  session = { client, userId, everyoneId };
  const folded = storage.get<unknown>(movedKey(userId));
  const older = Object.fromEntries(
    Object.entries(fromDevice()).filter(
      ([key]) => !(Array.isArray(folded) && folded.includes(key))
    )
  );
  current = { ...older, ...(storage.get<Synced>(cacheKey(userId)) ?? {}) };
  everyoneDoc = everyoneId
    ? (storage.get<Synced>(cacheKey(everyoneId)) ?? {})
    : {};
  announce();
  // Else a change still saving reads back as its old value.
  flushPush();
  void saving
    .then(() =>
      Promise.all([
        fetchPrefs(client, userId),
        everyoneId ? fetchPrefs(client, everyoneId).catch(() => null) : null,
      ])
    )
    .then(([remote, everyone]) => {
      if (mine !== generation) return;
      if (everyoneId && everyone) {
        everyoneDoc = known(everyone.CustomPrefs, true);
        storage.set(cacheKey(everyoneId), everyoneDoc);
      }
      if (remote.CustomPrefs?.[SAVED_MARK]) {
        const theirs = known(remote.CustomPrefs);
        publish({ ...older, ...theirs });
        if (Object.keys(older).some((key) => !(key in theirs))) push(current);
      } else if (Object.keys(current).length) push(current);
      else announce();
      storage.set(movedKey(userId), [...moved.keys()]);
    })
    .catch(() => undefined);
  return () => {
    if (mine === generation) {
      session = null;
      everyoneDoc = {};
      publish({});
    }
  };
}

/** Another profile's settings, or everyone's, for the owner to change. */
export function useLayer(
  client: JellyfinClient,
  target: { userId: string; everyone: boolean } | null
): Layer | null {
  const [doc, setDoc] = React.useState<Synced | null>(null);
  const userId = target?.userId;
  const everyone = !!target?.everyone;
  React.useEffect(() => {
    setDoc(null);
    if (!userId) return;
    let gone = false;
    fetchPrefs(client, userId).then(
      (remote) => !gone && setDoc(known(remote.CustomPrefs, everyone)),
      () => !gone && setDoc({})
    );
    return () => {
      gone = true;
    };
  }, [client, userId, everyone]);
  const docRef = React.useRef(doc);
  docRef.current = doc;
  const loaded = doc !== null;
  return React.useMemo(() => {
    if (!userId || !loaded) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
      userId,
      own: () => docRef.current ?? {},
      inherited: () => (everyone ? {} : everyoneDoc),
      everyone,
      set(key, raw) {
        const next = { ...(docRef.current ?? {}) };
        if (raw) next[key] = raw;
        else delete next[key];
        docRef.current = next;
        setDoc(next);
        if (everyone) {
          everyoneDoc = next;
          if (session?.everyoneId)
            storage.set(cacheKey(session.everyoneId), next);
        }
        announce();
        clearTimeout(timer);
        timer = setTimeout(() => push(next, { client, userId }), 500);
      },
    };
  }, [client, userId, everyone, loaded]);
}

/** Whether a user's settings apply, rather than the defaults of nobody signed in. */
export function signedIn(): boolean {
  return session !== null;
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPush: (() => void) | undefined;

function flushPush() {
  clearTimeout(pushTimer);
  pendingPush?.();
  pendingPush = undefined;
}

function update(key: string, value: string | undefined) {
  const was = moved.get(key)?.was;
  if (was) forget(was);
  const next = { ...current };
  if (value) next[key] = value;
  else delete next[key];
  publish(next);
  // A dragged colour or typed CSS saves once it settles.
  clearTimeout(pushTimer);
  const target = session;
  pendingPush = () => push(next, target);
  pushTimer = setTimeout(flushPush, 500);
}

/**
 * A setting that follows the user; `format` returns undefined for the
 * built-in default. A profile's own value wins over everyone's.
 */
export function synced<T>(
  key: string,
  parse: (raw: string | undefined) => T,
  format: (value: T) => string | undefined,
  was: Was<T>[] = []
): Setting<T> {
  SYNCED_KEYS.add(key);
  if (was.length) moved.set(key, { was, format });
  const seen = new WeakMap<Layer, { raw: string | undefined; value: T }>();
  return {
    kind: 'synced',
    read(layer = live) {
      const own = layer.own()[key];
      const raw =
        own === BUILT_IN ? undefined : (own ?? layer.inherited()[key]);
      let last = seen.get(layer);
      if (!last || last.raw !== raw) {
        last = { raw, value: parse(raw) };
        seen.set(layer, last);
      }
      return last.value;
    },
    write(next, layer = live) {
      const raw = format(next);
      const inherited = layer.inherited()[key];
      layer.set(
        key,
        raw === inherited
          ? undefined
          : (raw ?? (inherited === undefined ? undefined : BUILT_IN))
      );
    },
  };
}

export const syncedFlag = (
  key: string,
  fallback = false,
  was: Was<boolean>[] = []
) =>
  synced<boolean>(
    key,
    (raw) => (raw === undefined ? fallback : raw === '1'),
    (value) => (value === fallback ? undefined : value ? '1' : '0'),
    was
  );

export function syncedChoice<T extends string | number>(
  key: string,
  options: readonly T[],
  fallback: T,
  was: Was<T>[] = []
): Setting<T> {
  return synced<T>(
    key,
    (raw) => options.find((o) => String(o) === raw) ?? fallback,
    (value) => (value === fallback ? undefined : String(value)),
    was
  );
}

export const syncedColor = (
  key: string,
  fallback: string,
  was: Was<string>[] = []
) =>
  synced<string>(
    key,
    (raw) => (raw && isHex(raw) ? raw : fallback),
    (value) => (value === fallback ? undefined : value),
    was
  );

export function syncedNumber(
  key: string,
  fallback: number,
  valid: (value: number) => boolean,
  was: Was<number>[] = []
): Setting<number> {
  return synced<number>(
    key,
    (raw) => {
      const value = Number(raw);
      return raw && Number.isFinite(value) && valid(value) ? value : fallback;
    },
    (value) => (value === fallback ? undefined : String(value)),
    was
  );
}

/** A fixed-length list of short strings, kept as JSON. */
export function syncedList(
  key: string,
  fallback: readonly string[]
): Setting<readonly string[]> {
  const same = (list: readonly string[]) =>
    JSON.stringify(list) === JSON.stringify(fallback);
  return synced<readonly string[]>(
    key,
    (raw) => {
      try {
        const list: unknown = raw && JSON.parse(raw);
        if (
          Array.isArray(list) &&
          list.length === fallback.length &&
          list.every((v) => typeof v === 'string' && v && v.length <= 32)
        )
          return list as string[];
      } catch {}
      return fallback;
    },
    (value) => (same(value) ? undefined : JSON.stringify(value))
  );
}

export const syncedText = (key: string) =>
  synced<string | undefined>(
    key,
    (raw) => raw,
    (value) => value
  );

type Valid<T> = readonly T[] | ((value: T) => boolean);

/**
 * A setting kept on this device, over a default everyone's settings may set;
 * `fallback` is the built-in one, and a function's is read when needed.
 */
export function device<T extends string | number | boolean>(
  key: string,
  fallback: T | (() => T),
  valid?: Valid<T>,
  was: Was<T>[] = []
): Setting<T> {
  DEVICE_KEYS.add(key);
  const initial = () =>
    typeof fallback === 'function' ? fallback() : fallback;
  const ok = (value: unknown): value is T =>
    typeof value === typeof initial() &&
    (!valid ||
      (typeof valid === 'function'
        ? valid(value as T)
        : valid.includes(value as T)));
  const defaultIn = (doc: Synced): T | undefined => {
    const raw =
      setting.kind === 'local' ? undefined : doc[deviceDefaultKey(key)];
    if (raw === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(raw);
      return ok(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const setting: Setting<T> = {
    kind: 'device',
    read(layer = live) {
      if (layer.everyone) return defaultIn(layer.own()) ?? initial();
      const stored = storage.get<unknown>(key);
      const value = stored === null ? readWas(was)?.value : stored;
      return ok(value) ? value : (defaultIn(everyoneDoc) ?? initial());
    },
    write(value, layer = live) {
      if (layer.everyone) {
        if (setting.kind === 'local') return;
        layer.set(
          deviceDefaultKey(key),
          value === initial() ? undefined : JSON.stringify(value)
        );
        return;
      }
      // Another profile's settings hold none of this device's.
      if (layer !== live) return;
      forget(was);
      if (value === (defaultIn(everyoneDoc) ?? initial())) storage.remove(key);
      else storage.set(key, value);
      announce();
    },
  };
  return setting;
}

/** Kept on each device with no default for everyone, such as a device's own outputs. */
export function local<T>(setting: Setting<T>): Setting<T> {
  setting.kind = 'local';
  return setting;
}

/** Lists of strings by name, kept on this device; an empty record clears it. */
export function deviceLists(
  key: string,
  was: string[] = []
): Setting<Record<string, string[]>> {
  let seen: string | undefined;
  let value: Record<string, string[]> = {};
  return {
    kind: 'local',
    read() {
      const stored = storage.get<unknown>(key) ?? readWas(was)?.value;
      const text = JSON.stringify(stored);
      if (text !== seen) {
        seen = text;
        const entries =
          stored && typeof stored === 'object' ? Object.entries(stored) : [];
        value = Object.fromEntries(
          entries.filter(
            (entry): entry is [string, string[]] =>
              Array.isArray(entry[1]) &&
              entry[1].every((item) => typeof item === 'string')
          )
        );
      }
      return value;
    },
    write(next, layer = live) {
      if (layer !== live) return;
      forget(was);
      if (Object.keys(next).length) storage.set(key, next);
      else storage.remove(key);
      announce();
    },
  };
}

type Values<G> = { [K in keyof G]: G[K] extends Setting<infer T> ? T : never };

export function group<G extends Record<string, Setting<unknown>>>(
  members: G
): Setting<Values<G>> {
  const values = new WeakMap<Layer, Values<G>>();
  const kinds = new Set(Object.values(members).map((m) => m.kind));
  return {
    kind: kinds.size === 1 ? [...kinds][0] : 'synced',
    read(layer = live) {
      const value = values.get(layer);
      const next = {} as Values<G>;
      let changed = !value;
      for (const key in members) {
        next[key] = members[key].read(layer) as Values<G>[typeof key];
        if (!Object.is(next[key], value?.[key])) changed = true;
      }
      if (!changed) return value!;
      values.set(layer, next);
      return next;
    },
    write(next, layer) {
      for (const key in members) members[key].write(next[key], layer);
    },
  };
}

export function record<K extends string, V>(
  keys: readonly K[],
  make: (key: K) => V
): Record<K, V> {
  return Object.fromEntries(keys.map((key) => [key, make(key)])) as Record<
    K,
    V
  >;
}

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
