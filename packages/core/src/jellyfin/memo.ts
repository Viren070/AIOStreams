import { randomBytes } from 'crypto';
import { config as appConfig } from '../config/index.js';
import { Cache } from '../utils/cache.js';
import { getSimpleTextHash } from '../utils/crypto.js';
import { userScopeKey } from '../utils/user-scope.js';
import type { UserData } from '../db/schemas.js';
import type { MemoPointer, PlaybackMemo } from './types.js';
import { firstWriteOf } from './write-once.js';

/*
 * Long because a client holds credential-less stream URLs for the length of
 * playback, so they must stay resolvable; reuse of the sources themselves is
 * bounded separately by `isMemoFresh`.
 */
export const PLAYBACK_MEMO_TTL = 4 * 60 * 60;

/* ~20 KB per memo, so the cap is low; an eviction costs a re-resolve. */
const MEMO_CAP = 10_000;
/* The play session, notices and list markers, beside one pointer per version. */
const POINTER_SPARE = 5;

const memos = Cache.getInstance<string, PlaybackMemo>(
  'jellyfin-playback',
  MEMO_CAP
);
/* A stream URL names only its source, so a pointer must outlive its memo. */
const pointers = Cache.getInstance<string, MemoPointer>(
  'jellyfin-playback-ptr',
  () => MEMO_CAP * (appConfig.jellyfin.maxVersions + POINTER_SPARE)
);

/**
 * Identity of the configuration a memo was resolved under, so saving a
 * configuration or switching variant misses rather than reusing its streams.
 */
export function memoScope(userData: UserData, updatedAt: string): string {
  return getSimpleTextHash(`${userScopeKey(userData)}|${updatedAt}`);
}

function itemKey(uuid: string, scope: string, itemId: string) {
  return `${uuid}|${scope}|${itemId}`;
}

/** Whether a memo's sources may be reused rather than resolved again. */
export function isMemoFresh(memo: PlaybackMemo): boolean {
  const ttl = appConfig.jellyfin.streamCacheTtl;
  if (ttl <= 0) return false;
  return Date.now() - memo.createdAt < ttl * 1000;
}

export function newPlaySessionId(): string {
  return randomBytes(16).toString('hex');
}

export async function writePlaybackMemo(
  memo: PlaybackMemo,
  scope: string,
  persona?: string
): Promise<void> {
  const pointer: MemoPointer = {
    uuid: memo.uuid,
    encryptedPassword: memo.encryptedPassword,
    itemId: memo.itemId,
    persona,
  };
  await Promise.all([
    memos.set(
      itemKey(memo.uuid, scope, memo.itemId),
      memo,
      PLAYBACK_MEMO_TTL,
      true
    ),
    pointers.set(
      `psid:${memo.psid}`,
      { ...pointer, scope },
      PLAYBACK_MEMO_TTL,
      true
    ),
    ...memo.sources.map((s) =>
      pointers.set(`msid:${s.msid}`, pointer, PLAYBACK_MEMO_TTL, true)
    ),
  ]).catch(() => undefined);
}

/**
 * Points an id at an item without claiming its streams were resolved; an empty
 * memo in the item's own slot would block the real resolution.
 */
export async function writeMemoPointer(
  id: string,
  pointer: MemoPointer
): Promise<void> {
  const key = `ptr:${id}:${pointer.encryptedPassword}:${pointer.persona ?? ''}`;
  if (!firstWriteOf(key)) return;
  await pointers
    .set(`msid:${id}`, pointer, PLAYBACK_MEMO_TTL, true)
    .catch(() => undefined);
}

export function resolveByItem(
  uuid: string,
  scope: string,
  itemId: string
): Promise<PlaybackMemo | undefined> {
  return memos
    .get(itemKey(uuid, scope, itemId), PLAYBACK_MEMO_TTL)
    .catch(() => undefined);
}

export function resolveByPlaySession(
  psid: string
): Promise<MemoPointer | undefined> {
  return pointers.get(`psid:${psid}`, PLAYBACK_MEMO_TTL).catch(() => undefined);
}

export function resolveByMediaSource(
  msid: string
): Promise<MemoPointer | undefined> {
  return pointers.get(`msid:${msid}`, PLAYBACK_MEMO_TTL).catch(() => undefined);
}
