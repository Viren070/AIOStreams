import {
  PARTY_LIMITS,
  type PartyClientMessage,
  type PartyLock,
  type PartyRequest,
  type PartyResumeState,
  type QueueItem,
} from '@aiostreams/core';

/*
 * Checks what a client sends before the relay acts on it: every field typed,
 * every string and list bounded. Anything else is dropped as a whole.
 */

type Json = Record<string, unknown>;

/** 16 random bytes in base64url, as party ids and seat keys are. */
const KEY = /^[A-Za-z0-9_-]{22}$/;
const MEMBER_ID = /^[A-Za-z0-9_-]{12}$/;
const PLAYLIST_ID = /^[0-9a-f]{32}$/;
const SEALED = /^[A-Za-z0-9_-]+$/;
const CODE = /^[0-9A-Z]{10}$/;
const TICKET = /^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{22}$/;
const MAX_TOKEN = 4096;
/** Further than any file runs, and any clock reads. */
const MAX_MS = 1e9;
const MAX_TIME = 1e14;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNumber = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const isOffset = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_MS;
const isInt = (v: unknown, max: number): v is number =>
  isNumber(v, max) && Number.isInteger(v);
const isSealed = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max && SEALED.test(v);
const isPlaylistId = (v: unknown): v is string =>
  typeof v === 'string' && (v === '' || PLAYLIST_ID.test(v));
const isKey = (v: unknown): v is string => typeof v === 'string' && KEY.test(v);
const isMemberId = (v: unknown): v is string =>
  typeof v === 'string' && MEMBER_ID.test(v);
const isToken = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_TOKEN;

function items(v: unknown): QueueItem[] | null {
  if (!Array.isArray(v) || !v.length || v.length > PARTY_LIMITS.queue)
    return null;
  const out: QueueItem[] = [];
  for (const item of v) {
    if (!isObject(item) || !isSealed(item.ref, PARTY_LIMITS.ref)) return null;
    if (!isNumber(item.runtimeMs, MAX_MS)) return null;
    out.push({ ref: item.ref, runtimeMs: item.runtimeMs });
  }
  return out;
}

function request(v: unknown): PartyRequest | null {
  if (!isObject(v)) return null;
  switch (v.type) {
    case 'Play': {
      const list = items(v.items);
      if (!list || !isInt(v.index, list.length - 1)) return null;
      if (!isNumber(v.startMs, MAX_MS)) return null;
      return { type: 'Play', items: list, index: v.index, startMs: v.startMs };
    }
    case 'Queue': {
      const list = items(v.items);
      if (!list || (v.mode !== 'Queue' && v.mode !== 'QueueNext')) return null;
      return { type: 'Queue', items: list, mode: v.mode };
    }
    case 'SetPlaylistItem':
    case 'NextItem':
    case 'PreviousItem':
      return isPlaylistId(v.playlistItemId)
        ? { type: v.type, playlistItemId: v.playlistItemId }
        : null;
    case 'RemoveFromPlaylist': {
      const ids = v.playlistItemIds;
      if (!Array.isArray(ids) || ids.length > PARTY_LIMITS.queue) return null;
      if (!ids.every(isPlaylistId)) return null;
      if (!isBool(v.clearPlaylist) || !isBool(v.clearPlayingItem)) return null;
      return {
        type: 'RemoveFromPlaylist',
        playlistItemIds: ids,
        clearPlaylist: v.clearPlaylist,
        clearPlayingItem: v.clearPlayingItem,
      };
    }
    case 'MovePlaylistItem':
      return isPlaylistId(v.playlistItemId) &&
        isInt(v.newIndex, PARTY_LIMITS.queue)
        ? {
            type: 'MovePlaylistItem',
            playlistItemId: v.playlistItemId,
            newIndex: v.newIndex,
          }
        : null;
    case 'Unpause':
    case 'Pause':
    case 'Stop':
      return { type: v.type };
    case 'Seek':
      return isNumber(v.positionMs, MAX_MS)
        ? { type: 'Seek', positionMs: v.positionMs }
        : null;
    case 'Buffer':
    case 'Ready':
      return isNumber(v.when, MAX_TIME) &&
        isNumber(v.positionMs, MAX_MS) &&
        isBool(v.isPlaying) &&
        isPlaylistId(v.playlistItemId)
        ? {
            type: v.type,
            when: v.when,
            positionMs: v.positionMs,
            isPlaying: v.isPlaying,
            playlistItemId: v.playlistItemId,
          }
        : null;
    case 'SetRepeatMode':
      return v.mode === 'RepeatOne' ||
        v.mode === 'RepeatAll' ||
        v.mode === 'RepeatNone'
        ? { type: 'SetRepeatMode', mode: v.mode }
        : null;
    case 'SetShuffleMode':
      return v.mode === 'Sorted' || v.mode === 'Shuffle'
        ? { type: 'SetShuffleMode', mode: v.mode }
        : null;
    case 'IgnoreWait':
      return isBool(v.ignoreWait)
        ? { type: 'IgnoreWait', ignoreWait: v.ignoreWait }
        : null;
    default:
      return null;
  }
}

function resumeState(v: unknown): PartyResumeState | null {
  if (!isObject(v)) return null;
  const list = items(v.items);
  if (!list || !isInt(v.index, list.length - 1)) return null;
  if (!isNumber(v.positionMs, MAX_MS) || !isBool(v.playing)) return null;
  return {
    items: list,
    index: v.index,
    positionMs: v.positionMs,
    playing: v.playing,
  };
}

const token = (v: unknown) => (isToken(v) ? v : undefined);
const isTicket = (v: unknown): v is string =>
  typeof v === 'string' && TICKET.test(v);

function hostClaim(v: unknown): { ticket: string; lock: PartyLock } | null {
  if (!isObject(v) || !isTicket(v.ticket) || !isObject(v.lock)) return null;
  const { control, joins } = v.lock;
  return isBool(control) && isBool(joins)
    ? { ticket: v.ticket, lock: { control, joins } }
    : null;
}

/** What create, join and resume all carry. */
function hello(v: Json) {
  if (!isInt(v.v, 1e6) || !isKey(v.party)) return null;
  if (!isSealed(v.name, PARTY_LIMITS.name)) return null;
  return { v: v.v, party: v.party, name: v.name, token: token(v.token) };
}

export function parseMessage(text: string): PartyClientMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  switch (v.t) {
    case 'create': {
      const h = hello(v);
      if (!h) return null;
      if (
        v.code !== undefined &&
        !(typeof v.code === 'string' && CODE.test(v.code))
      )
        return null;
      return { t: 'create', ...h, code: v.code };
    }
    case 'join': {
      const h = hello(v);
      if (!h || (v.seat !== undefined && !isKey(v.seat))) return null;
      return { t: 'join', ...h, seat: v.seat };
    }
    case 'resume': {
      const h = hello(v);
      if (!h || !isTicket(v.ticket)) return null;
      const state = resumeState(v.state);
      const host = v.host === undefined ? undefined : hostClaim(v.host);
      if (!state || host === null) return null;
      return { t: 'resume', ...h, ticket: v.ticket, state, host };
    }
    case 'peek':
      if (!isInt(v.v, 1e6) || !isKey(v.party)) return null;
      return { t: 'peek', v: v.v, party: v.party, token: token(v.token) };
    case 'ping':
      if (!isNumber(v.t0, MAX_TIME)) return null;
      return {
        t: 'ping',
        t0: v.t0,
        rtt: isNumber(v.rtt, 60_000) ? v.rtt : undefined,
      };
    case 'request': {
      const r = request(v.request);
      return r ? { t: 'request', request: r } : null;
    }
    case 'offset':
      if (v.offsetMs === undefined) return { t: 'offset' };
      return isOffset(v.offsetMs)
        ? { t: 'offset', offsetMs: v.offsetMs }
        : null;
    case 'chat':
      return isSealed(v.text, PARTY_LIMITS.chat)
        ? { t: 'chat', text: v.text }
        : null;
    case 'react':
      return isSealed(v.emoji, PARTY_LIMITS.reaction)
        ? { t: 'react', emoji: v.emoji }
        : null;
    case 'name':
      return isSealed(v.name, PARTY_LIMITS.name)
        ? { t: 'name', name: v.name }
        : null;
    case 'kick':
      return isMemberId(v.member) ? { t: 'kick', member: v.member } : null;
    case 'lock':
      if (v.control !== undefined && !isBool(v.control)) return null;
      if (v.joins !== undefined && !isBool(v.joins)) return null;
      return { t: 'lock', control: v.control, joins: v.joins };
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}
