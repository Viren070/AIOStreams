import { randomBytes } from 'crypto';
import { config as appConfig } from '../config/index.js';
import { Cache } from '../utils/cache.js';
import { getSimpleTextHash } from '../utils/crypto.js';
import type { UserData } from '../db/schemas.js';
import type { MemoPointer, PlaybackMemo } from './types.js';

/*
 * Long because a client holds credential-less stream URLs for the length of
 * playback, so they must stay resolvable; reuse of the sources themselves is
 * bounded separately by `isMemoFresh`.
 */
export const PLAYBACK_MEMO_TTL = 30 * 60;

/* ~20 KB per memo, so the cap is low; an eviction costs a re-resolve. */
const memos = Cache.getInstance<string, PlaybackMemo>(
  'jellyfin-playback',
  10_000
);
const pointers = Cache.getInstance<string, MemoPointer>(
  'jellyfin-playback-ptr',
  50_000
);

/**
 * Identity of the configuration a memo was resolved under, so saving a
 * configuration or switching variant misses rather than reusing its streams.
 */
export function memoScope(userData: UserData): string {
  return getSimpleTextHash(JSON.stringify(userData));
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
  scope: string
): Promise<void> {
  const pointer: MemoPointer = {
    uuid: memo.uuid,
    encryptedPassword: memo.encryptedPassword,
    itemId: memo.itemId,
  };
  await Promise.all([
    memos.set(itemKey(memo.uuid, scope, memo.itemId), memo, PLAYBACK_MEMO_TTL),
    pointers.set(`psid:${memo.psid}`, pointer, PLAYBACK_MEMO_TTL),
    ...memo.sources.map((s) =>
      pointers.set(`msid:${s.msid}`, pointer, PLAYBACK_MEMO_TTL)
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
  await pointers
    .set(`msid:${id}`, pointer, PLAYBACK_MEMO_TTL)
    .catch(() => undefined);
}

export function resolveByItem(
  uuid: string,
  scope: string,
  itemId: string
): Promise<PlaybackMemo | undefined> {
  return memos.get(itemKey(uuid, scope, itemId), true).catch(() => undefined);
}

export function resolveByPlaySession(
  psid: string
): Promise<MemoPointer | undefined> {
  return pointers.get(`psid:${psid}`, true).catch(() => undefined);
}

export function resolveByMediaSource(
  msid: string
): Promise<MemoPointer | undefined> {
  return pointers.get(`msid:${msid}`, true).catch(() => undefined);
}
