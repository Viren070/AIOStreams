import React from 'react';
import type { JellyfinClient } from './client';
import { storage } from './storage';

/** A source the home page features from: `resume` or `view:<library id>`. */
export type FeaturedSource = string;

/** An empty list features nothing. */
export type Featured = 'auto' | FeaturedSource[];

export const MAX_FEATURED = 4;

export type PosterSize = 'small' | 'medium' | 'large';

export type PosterLine = 'title' | 'year';

const POSTER_LINES: PosterLine[] = ['title', 'year'];

/*
 * Settings that follow the user, kept in Jellyfin's display preferences on the
 * server. The device holds a copy so a page never waits on them; the server's
 * wins once it answers.
 */
interface Synced {
  featured?: string;
  posterSize?: string;
  posterText?: string;
}

const SYNCED_KEYS: (keyof Synced)[] = ['featured', 'posterSize', 'posterText'];

const PREFS_ID = 'aiostreams-web';
/** Set on every save, so preferences reset to their defaults still count as saved. */
const SAVED_MARK = 'saved';
const LEGACY_KEYS = {
  featured: 'aiostreams-web-featured',
  posterSize: 'aiostreams-web-poster-size',
} as const;
const CATALOG_KEY = 'aiostreams-web-catalog';

const cacheKey = (userId: string) => `aiostreams-web-prefs:${userId}`;
const listeners = new Set<() => void>();
let current: Synced = {};
let session: { client: JellyfinClient; userId: string } | null = null;
let generation = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  listeners.forEach((l) => l());
}

function known(prefs: Record<string, unknown> | null | undefined): Synced {
  const out: Synced = {};
  for (const key of SYNCED_KEYS) {
    const value = prefs?.[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

/** What this device kept before settings followed the user. */
function legacy(): Synced {
  return known({
    featured: storage.get<string>(LEGACY_KEYS.featured),
    posterSize: storage.get<string>(LEGACY_KEYS.posterSize),
  });
}

function publish(next: Synced) {
  current = next;
  if (session) storage.set(cacheKey(session.userId), next);
  announce();
}

function push(prefs: Synced) {
  if (!session) return;
  const { client, userId } = session;
  void client
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

/** A user with nothing saved yet takes this device's settings. */
export function syncPreferences(
  client: JellyfinClient,
  userId: string
): () => void {
  const mine = ++generation;
  session = { client, userId };
  current = storage.get<Synced>(cacheKey(userId)) ?? legacy();
  announce();
  void client
    .get<{
      CustomPrefs?: Record<string, string | null>;
    }>(`/DisplayPreferences/${PREFS_ID}`, { client: PREFS_ID, userId })
    .then((remote) => {
      if (mine !== generation) return;
      if (remote.CustomPrefs?.[SAVED_MARK]) publish(known(remote.CustomPrefs));
      else if (Object.keys(current).length) push(current);
    })
    .catch(() => undefined);
  return () => {
    if (mine === generation) session = null;
  };
}

function update(key: keyof Synced, value: string | undefined) {
  const next = { ...current };
  if (value) next[key] = value;
  else delete next[key];
  publish(next);
  push(next);
}

function readFeatured(): string {
  return current.featured ?? 'auto';
}

export function useFeatured(): [Featured, (value: Featured) => void] {
  const raw = React.useSyncExternalStore(subscribe, readFeatured);
  const value = React.useMemo<Featured>(
    () =>
      raw === 'auto'
        ? 'auto'
        : raw === 'none'
          ? []
          : raw.split(',').filter(Boolean).slice(0, MAX_FEATURED),
    [raw]
  );
  const set = React.useCallback((next: Featured) => {
    update(
      'featured',
      next === 'auto' ? undefined : next.length ? next.join(',') : 'none'
    );
  }, []);
  return [value, set];
}

function readPosterSize(): PosterSize {
  const value = current.posterSize;
  return value === 'small' || value === 'large' ? value : 'medium';
}

export function usePosterSize(): [PosterSize, (value: PosterSize) => void] {
  const value = React.useSyncExternalStore(subscribe, readPosterSize);
  const set = React.useCallback((next: PosterSize) => {
    update('posterSize', next === 'medium' ? undefined : next);
  }, []);
  return [value, set];
}

function readPosterLines(): string {
  return current.posterText ?? 'title,year';
}

export function usePosterLines(): [
  PosterLine[],
  (value: PosterLine[]) => void,
] {
  const raw = React.useSyncExternalStore(subscribe, readPosterLines);
  const value = React.useMemo(
    () => POSTER_LINES.filter((line) => raw.split(',').includes(line)),
    [raw]
  );
  const set = React.useCallback((next: PosterLine[]) => {
    const lines = POSTER_LINES.filter((line) => next.includes(line));
    update(
      'posterText',
      lines.length === POSTER_LINES.length
        ? undefined
        : lines.length
          ? lines.join(',')
          : 'none'
    );
  }, []);
  return [value, set];
}

type Catalogs = { last?: string } & Record<string, string | undefined>;

/**
 * The catalog Discover returns to, overall and per type, so switching type and
 * back lands where it was rather than on whichever catalog comes first.
 */
export function rememberCatalog(viewId: string, kind?: string): void {
  const stored = storage.get<Catalogs>(CATALOG_KEY) ?? {};
  storage.set(CATALOG_KEY, {
    ...stored,
    last: viewId,
    ...(kind ? { [kind]: viewId } : {}),
  });
}

export function lastCatalog(kind?: string): string | null {
  const stored = storage.get<Catalogs>(CATALOG_KEY);
  return (kind ? stored?.[kind] : stored?.last) ?? null;
}
