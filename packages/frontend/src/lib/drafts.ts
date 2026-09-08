import type { UserData } from '@aiostreams/core';

/**
 * Unsaved-configuration drafts, in two tiers. `sessionStorage` dies with the
 * tab, so a refresh restores silently. `localStorage` outlives the tab and is
 * only ever offered, never applied on its own.
 */

const SESSION_KEY = 'aiostreams-draft-session';
const LOCAL_PREFIX = 'aiostreams-draft:';
const OPT_OUT_KEY = 'aiostreams-draft-opt-out';

/** Pre-two-tier key, migrated once then removed. */
const LEGACY_KEY = 'aiostreams-user-data';

// No tab-close event to hook, so age is judged on read.
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DRAFT_VERSION = 1;

export interface Draft {
  v: number;
  savedAt: number;
  /** The configuration this draft belongs to; null for a signed-out draft. */
  uuid: string | null;
  addonName?: string;
  data: UserData;
}

export type DraftIdentity = string | null;

function localKey(uuid: DraftIdentity): string {
  return `${LOCAL_PREFIX}${uuid ?? 'anon'}`;
}

// Storage can throw outright (Safari private mode, disabled site data).
function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function safeRemove(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

function parse(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Draft;
    if (
      !parsed ||
      parsed.v !== DRAFT_VERSION ||
      typeof parsed.savedAt !== 'number' ||
      !parsed.data
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function build(
  data: UserData,
  uuid: DraftIdentity,
  addonName?: string
): string {
  const draft: Draft = {
    v: DRAFT_VERSION,
    savedAt: Date.now(),
    uuid,
    addonName,
    data,
  };
  return JSON.stringify(draft);
}

/* -------------------------------------------------------------------------- */
/* Opt-out                                                                     */
/* -------------------------------------------------------------------------- */

/** Blocks the localStorage tier only; sessionStorage still covers a refresh. */
export function isDraftOptOut(): boolean {
  return safeGet(localStorage, OPT_OUT_KEY) === '1';
}

export function setDraftOptOut(): void {
  safeSet(localStorage, OPT_OUT_KEY, '1');
  clearAllLocalDrafts();
}

/* -------------------------------------------------------------------------- */
/* Session tier                                                                */
/* -------------------------------------------------------------------------- */

export function readSessionDraft(): Draft | null {
  return parse(safeGet(sessionStorage, SESSION_KEY));
}

export function writeSessionDraft(
  data: UserData,
  uuid: DraftIdentity,
  addonName?: string
): void {
  safeSet(sessionStorage, SESSION_KEY, build(data, uuid, addonName));
}

export function clearSessionDraft(): void {
  safeRemove(sessionStorage, SESSION_KEY);
}

/* -------------------------------------------------------------------------- */
/* Local tier                                                                  */
/* -------------------------------------------------------------------------- */

export function readLocalDraft(uuid: DraftIdentity): Draft | null {
  const key = localKey(uuid);
  const draft = parse(safeGet(localStorage, key));
  if (!draft) {
    safeRemove(localStorage, key);
    return null;
  }
  if (Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
    safeRemove(localStorage, key);
    return null;
  }
  return draft;
}

export function writeLocalDraft(
  data: UserData,
  uuid: DraftIdentity,
  addonName?: string
): void {
  if (isDraftOptOut()) return;
  safeSet(localStorage, localKey(uuid), build(data, uuid, addonName));
}

export function clearLocalDraft(uuid: DraftIdentity): void {
  safeRemove(localStorage, localKey(uuid));
}

// Only the identity in hand is read, so other keys are swept on boot instead.
export function pruneExpiredLocalDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LOCAL_PREFIX)) continue;
      const draft = parse(safeGet(localStorage, key));
      if (!draft || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
        safeRemove(localStorage, key);
      }
    }
  } catch {
    /* ignore */
  }
}

function clearAllLocalDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LOCAL_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => safeRemove(localStorage, key));
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Combined                                                                    */
/* -------------------------------------------------------------------------- */

/** Drops both tiers for one configuration. */
export function clearDrafts(uuid: DraftIdentity): void {
  clearSessionDraft();
  clearLocalDraft(uuid);
}

/**
 * The draft held for one identity, freshest tier first. Drafts never cross
 * identities: a configuration's work is only ever offered back to its uuid.
 */
export function readDraftFor(uuid: DraftIdentity): Draft | null {
  const session = readSessionDraft();
  if (session && session.uuid === uuid) return session;
  return readLocalDraft(uuid);
}

/**
 * Carries a pre-two-tier blob over as a draft. `hasWork` keeps the prompt off
 * browsers whose blob is only defaults. The legacy key is removed either way.
 */
export function migrateLegacyDraft(hasWork: (data: UserData) => boolean) {
  const raw = safeGet(localStorage, LEGACY_KEY);
  if (raw === null) return;
  safeRemove(localStorage, LEGACY_KEY);
  if (isDraftOptOut()) return;

  try {
    const data = JSON.parse(raw) as UserData;
    if (!data || !hasWork(data)) return;
    safeSet(localStorage, localKey(null), build(data, null));
  } catch {
    /* unparseable legacy blob; nothing worth carrying over */
  }
}
