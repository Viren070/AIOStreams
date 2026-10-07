import type {
  Query,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
} from '@tanstack/react-query';
import { ConnectionError } from '../client';
import { isReachable } from '../connection';
import { settings } from '../settings';
import { storage } from '../storage';
import type { UserDto } from '../types';
import {
  prune,
  readQuery,
  removeAll,
  removeCategory,
  removeScope,
  savedImageUrls,
  writeQuery,
  type CacheCategory,
  type SavedQuery,
} from './store';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      /** Saved on the device under this category; unsaved without it. */
      cache?: CacheCategory;
    };
  }
}

const DAY_MS = 24 * 60 * 60_000;
const USER_KEY = 'aiostreams-web-saved-user:';

/** Scopes signed out of this session, whose answers still on the way aren't saved. */
const signedOut = new Set<string>();

export function saving(category: CacheCategory): boolean {
  return (
    settings.cache.enabled.read() && settings.cache.categories[category].read()
  );
}

let savedArtwork: Set<string> | null = null;

function loadSavedArtwork() {
  void savedImageUrls().then(
    (urls) => (savedArtwork = urls),
    () => undefined
  );
}
loadSavedArtwork();

/** False only for an image known not to be saved, which then skips the read. */
export function maybeSaved(url: string): boolean {
  return !savedArtwork || savedArtwork.has(url);
}

export function noteSaved(url: string): void {
  savedArtwork?.add(url);
}

let pruneTimer: ReturnType<typeof setTimeout> | undefined;

export function pruneCache(): Promise<void> {
  return prune(settings.cache.maxSizeMb.read() * 1_000_000)
    .then(loadSavedArtwork)
    .catch(() => undefined);
}

export function schedulePrune(): void {
  clearTimeout(pruneTimer);
  pruneTimer = setTimeout(() => void pruneCache(), 10_000);
}

/** Every key starts with its server, and the app's own keys then the user. */
function scopeOf(key: QueryKey): string {
  return key[0] === 'jf' ? `${key[1]}|${key[2]}` : `${key[1]}|`;
}

function recent(saved: SavedQuery): boolean {
  const days = settings.cache.maxStaleDays.read();
  return !days || Date.now() - saved.savedAt <= days * DAY_MS;
}

/** The fetch stamps what it returns as new, so the real age goes back after. */
function stampLater(query: Query, savedAt: number, refetch: boolean) {
  setTimeout(() => {
    query.setState({ dataUpdatedAt: savedAt });
    if (refetch) void query.fetch().catch(() => undefined);
  });
}

/**
 * TanStack's per-query persister: a query's first load shows its saved copy
 * and fetches behind it, and an unreachable server leaves the saved copy, or
 * what is on screen, in place of an error.
 */
export async function persister(
  queryFn: QueryFunction<unknown, QueryKey, never>,
  context: QueryFunctionContext<QueryKey>,
  query: Query
): Promise<unknown> {
  const category = query.meta?.cache;
  const scope = scopeOf(query.queryKey);
  if (!category || !saving(category) || signedOut.has(scope))
    return queryFn(context);
  const shown = query.state;
  const saved =
    shown.data === undefined
      ? await readQuery(query.queryHash).catch(() => null)
      : null;
  if (saved && recent(saved)) {
    stampLater(query, saved.savedAt, isReachable());
    return saved.data;
  }
  try {
    const data = await queryFn(context);
    void writeQuery({ id: query.queryHash, category, scope }, Date.now(), data)
      .then(schedulePrune)
      .catch(() => undefined);
    return data;
  } catch (error) {
    if (!(error instanceof ConnectionError)) throw error;
    const kept =
      saved ??
      (shown.data !== undefined
        ? { data: shown.data, savedAt: shown.dataUpdatedAt }
        : null);
    if (!kept) throw error;
    stampLater(query, kept.savedAt, false);
    return kept.data;
  }
}

/** The signed-in user, so the app can open before the server answers. */
export function savedUser(base: string, userId: string): UserDto | null {
  if (!saving('account')) return null;
  const user = storage.get<UserDto>(USER_KEY + base);
  return user?.Id === userId ? user : null;
}

export function saveUser(base: string, user: UserDto): void {
  signedOut.delete(`${base}|${user.Id}`);
  if (saving('account')) storage.set(USER_KEY + base, user);
}

function forgetSavedUsers(): void {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(USER_KEY)) localStorage.removeItem(key);
  } catch {}
}

export function forgetSavedUser(base: string): void {
  storage.remove(USER_KEY + base);
}

export function forgetUser(base: string, userId: string | undefined): void {
  forgetSavedUser(base);
  if (!userId) return;
  signedOut.add(`${base}|${userId}`);
  void removeScope(`${base}|${userId}`).catch(() => undefined);
}

export async function clearCategory(category: CacheCategory): Promise<void> {
  if (category === 'account') forgetSavedUsers();
  if (category === 'artwork') savedArtwork = new Set();
  await removeCategory(category);
}

export async function clearCache(): Promise<void> {
  forgetSavedUsers();
  savedArtwork = new Set();
  await removeAll();
}

export { CACHE_CATEGORIES, usage, type CacheCategory } from './store';
