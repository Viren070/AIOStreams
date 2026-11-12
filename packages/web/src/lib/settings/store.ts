import React from 'react';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import { storage } from '@/lib/storage';

/** A stored value; `read` returns the same reference until it changes. */
export interface Setting<T> {
  read(): T;
  write(value: T): void;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  listeners.forEach((l) => l());
}

export function useSetting<T>(setting: Setting<T>): [T, (value: T) => void] {
  return [React.useSyncExternalStore(subscribe, setting.read), setting.write];
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
type Synced = Record<string, string>;

const SYNCED_KEYS = new Set<string>();

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
let session: { client: JellyfinClient; userId: string } | null = null;
let generation = 0;

function known(prefs: Record<string, unknown> | null | undefined): Synced {
  const out: Synced = {};
  for (const key of SYNCED_KEYS) {
    const value = prefs?.[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
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

function push(prefs: Synced, target = session) {
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
  userId: string
): () => void {
  const mine = ++generation;
  session = { client, userId };
  const folded = storage.get<unknown>(movedKey(userId));
  const older = Object.fromEntries(
    Object.entries(fromDevice()).filter(
      ([key]) => !(Array.isArray(folded) && folded.includes(key))
    )
  );
  current = { ...older, ...(storage.get<Synced>(cacheKey(userId)) ?? {}) };
  announce();
  // Else a change still saving reads back as its old value.
  flushPush();
  void saving
    .then(() =>
      client.get<{
        CustomPrefs?: Record<string, string | null>;
      }>(`/DisplayPreferences/${PREFS_ID}`, { client: PREFS_ID, userId })
    )
    .then((remote) => {
      if (mine !== generation) return;
      if (remote.CustomPrefs?.[SAVED_MARK]) {
        const theirs = known(remote.CustomPrefs);
        publish({ ...older, ...theirs });
        if (Object.keys(older).some((key) => !(key in theirs))) push(current);
      } else if (Object.keys(current).length) push(current);
      storage.set(movedKey(userId), [...moved.keys()]);
    })
    .catch(() => undefined);
  return () => {
    if (mine === generation) {
      session = null;
      publish({});
    }
  };
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

/** A setting that follows the user; `format` returns undefined for the default. */
export function synced<T>(
  key: string,
  parse: (raw: string | undefined) => T,
  format: (value: T) => string | undefined,
  was: Was<T>[] = []
): Setting<T> {
  SYNCED_KEYS.add(key);
  if (was.length) moved.set(key, { was, format });
  let raw: string | undefined;
  let value = parse(undefined);
  return {
    read() {
      if (current[key] !== raw) {
        raw = current[key];
        value = parse(raw);
      }
      return value;
    },
    write: (next) => update(key, format(next)),
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

/** A setting kept on this device; `fallback` is also what clears it, and a function's is read when needed. */
export function device<T extends string | number | boolean>(
  key: string,
  fallback: T | (() => T),
  valid?: Valid<T>,
  was: Was<T>[] = []
): Setting<T> {
  const initial = () =>
    typeof fallback === 'function' ? fallback() : fallback;
  const ok = (value: unknown): value is T =>
    typeof value === typeof initial() &&
    (!valid ||
      (typeof valid === 'function'
        ? valid(value as T)
        : valid.includes(value as T)));
  return {
    read() {
      const stored = storage.get<unknown>(key);
      const value = stored === null ? readWas(was)?.value : stored;
      return ok(value) ? value : initial();
    },
    write(value) {
      forget(was);
      if (value === initial()) storage.remove(key);
      else storage.set(key, value);
      announce();
    },
  };
}

/** Lists of strings by name, kept on this device; an empty record clears it. */
export function deviceLists(
  key: string,
  was: string[] = []
): Setting<Record<string, string[]>> {
  let seen: string | undefined;
  let value: Record<string, string[]> = {};
  return {
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
    write(next) {
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
  let value: Values<G> | undefined;
  return {
    read() {
      const next = {} as Values<G>;
      let changed = !value;
      for (const key in members) {
        next[key] = members[key].read() as Values<G>[typeof key];
        if (!Object.is(next[key], value?.[key])) changed = true;
      }
      if (changed) value = next;
      return value!;
    },
    write(next) {
      for (const key in members) members[key].write(next[key]);
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
