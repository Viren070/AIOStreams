import { createHash } from 'crypto';
import type { Manifest } from '../db/schemas.js';
import { JellyfinRepository } from '../db/repositories/jellyfin.js';
import { Cache } from '../utils/cache.js';
import { IdParser } from '../utils/id-parser.js';
import { createLogger } from '../logging/logger.js';
import type { WatchStateRow } from '../db/repositories/watch-state.js';
import type { ContentDescriptor, JellyfinDescriptor } from './types.js';

const logger = createLogger('jellyfin');

/*
 * 16-byte ids, rendered as 32 lowercase hex. Byte 0 says what follows:
 *   a1 packed content (kind, id type, media type, numeric id, season, episode)
 *   a2 view    a3 genre    a5 person    a6 media source    b2 hashed content
 * Packed ids need no storage. Views and genres are found by scanning the
 * config's catalogs, persons live in a cache, media sources in the playback
 * memo, and hashed content in a small durable table.
 */
const MARK_PACKED = 0xa1;
const MARK_VIEW = 0xa2;
const MARK_GENRE = 0xa3;
const MARK_PERSON = 0xa5;
const MARK_SOURCE = 0xa6;
const MARK_HASHED = 0xb2;

const KIND_CODES: Record<ContentDescriptor['k'], number> = {
  movie: 1,
  series: 2,
  season: 3,
  episode: 4,
  boxset: 5,
};
const KIND_BY_CODE = Object.fromEntries(
  Object.entries(KIND_CODES).map(([k, v]) => [v, k])
) as Record<number, ContentDescriptor['k']>;

const ID_TYPE_CODES: Record<string, number> = {
  imdbId: 1,
  themoviedbId: 2,
  thetvdbId: 3,
  kitsuId: 4,
  malId: 5,
  anilistId: 6,
  anidbId: 7,
  simklId: 8,
};
const ID_TYPE_BY_CODE = Object.fromEntries(
  Object.entries(ID_TYPE_CODES).map(([k, v]) => [v, k])
) as Record<number, string>;

const MEDIA_TYPE_CODES: Record<string, number> = {
  movie: 1,
  series: 2,
  anime: 3,
  tv: 4,
  other: 5,
  channel: 6,
};
const MEDIA_TYPE_BY_CODE = Object.fromEntries(
  Object.entries(MEDIA_TYPE_CODES).map(([k, v]) => [v, k])
) as Record<number, string>;

const NONE16 = 0xffff;
const MAX48 = 2 ** 48 - 1;

const idCache = Cache.getInstance<string, JellyfinDescriptor>(
  'jellyfin-ids',
  100_000
);
const ID_CACHE_TTL = 30 * 24 * 3600;
const personCache = Cache.getInstance<string, string>(
  'jellyfin-persons',
  50_000
);
const PERSON_TTL = 30 * 24 * 3600;

export function hyphenless(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

export function isGuidLike(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(hyphenless(id));
}

function sha(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function marked(mark: number, text: string): string {
  const buf = Buffer.alloc(16);
  buf[0] = mark;
  sha(text).copy(buf, 1, 0, 15);
  return buf.toString('hex');
}

function rebuildBaseId(idType: string, numeric: number): string {
  switch (idType) {
    case 'imdbId':
      return `tt${String(numeric).padStart(7, '0')}`;
    case 'themoviedbId':
      return `tmdb:${numeric}`;
    case 'thetvdbId':
      return `tvdb:${numeric}`;
    case 'kitsuId':
      return `kitsu:${numeric}`;
    case 'malId':
      return `mal:${numeric}`;
    case 'anilistId':
      return `anilist:${numeric}`;
    case 'anidbId':
      return `anidb:${numeric}`;
    case 'simklId':
      return `simkl:${numeric}`;
    default:
      return '';
  }
}

function numericOf(parsed: { type: string; value: string | number }) {
  const raw = String(parsed.value);
  const n = Number(parsed.type === 'imdbId' ? raw.replace(/^tt/, '') : raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX48 ? n : null;
}

/** True when `videoId` is exactly what the parent's id parser would generate. */
export function isRebuildableVideoId(
  seriesId: string,
  type: string,
  season: number,
  episode: number,
  videoId: string
): boolean {
  const parsed = IdParser.parse(seriesId, type);
  if (!parsed || parsed.season || parsed.episode) return false;
  if (!ID_TYPE_CODES[parsed.type]) return false;
  try {
    return (
      parsed.generator(parsed.value, String(season), String(episode)) ===
      videoId
    );
  } catch {
    return false;
  }
}

function tryPack(d: ContentDescriptor): string | null {
  const mediaCode = MEDIA_TYPE_CODES[d.t];
  if (!mediaCode) return null;
  const parsed = IdParser.parse(d.i, d.t);
  if (!parsed || parsed.season || parsed.episode) return null;
  const idTypeCode = ID_TYPE_CODES[parsed.type];
  if (!idTypeCode) return null;
  const numeric = numericOf(parsed);
  if (numeric === null) return null;
  if (rebuildBaseId(parsed.type, numeric) !== d.i) return null;

  let season = NONE16;
  let episode = NONE16;
  if (d.k === 'season') {
    if (!Number.isInteger(d.s) || d.s < 0 || d.s >= NONE16) return null;
    season = d.s;
  } else if (d.k === 'episode') {
    if (!Number.isInteger(d.s) || d.s < 0 || d.s >= NONE16) return null;
    if (!Number.isInteger(d.e) || d.e < 0 || d.e >= NONE16) return null;
    if (!isRebuildableVideoId(d.i, d.t, d.s, d.e, d.v)) return null;
    season = d.s;
    episode = d.e;
  }

  const buf = Buffer.alloc(16);
  buf[0] = MARK_PACKED;
  buf[1] = (KIND_CODES[d.k] << 4) | idTypeCode;
  buf[2] = mediaCode;
  buf.writeUIntBE(numeric, 3, 6);
  buf.writeUInt16BE(season, 9);
  buf.writeUInt16BE(episode, 11);
  return buf.toString('hex');
}

function unpack(buf: Buffer): ContentDescriptor | null {
  const kind = KIND_BY_CODE[buf[1] >> 4];
  const idType = ID_TYPE_BY_CODE[buf[1] & 0x0f];
  const mediaType = MEDIA_TYPE_BY_CODE[buf[2]];
  if (!kind || !idType || !mediaType) return null;
  const numeric = buf.readUIntBE(3, 6);
  const season = buf.readUInt16BE(9);
  const episode = buf.readUInt16BE(11);
  const baseId = rebuildBaseId(idType, numeric);
  switch (kind) {
    case 'movie':
    case 'series':
    case 'boxset':
      return { k: kind, t: mediaType, i: baseId };
    case 'season':
      return { k: 'season', t: mediaType, i: baseId, s: season };
    case 'episode': {
      const parsed = IdParser.parse(baseId, mediaType);
      if (!parsed) return null;
      return {
        k: 'episode',
        t: mediaType,
        i: baseId,
        s: season,
        e: episode,
        v: parsed.generator(parsed.value, String(season), String(episode)),
      };
    }
  }
}

export function canonicalDescriptor(d: JellyfinDescriptor): string {
  switch (d.k) {
    case 'view':
      return `view|${d.t}|${d.c}`;
    case 'genre':
      return `genre|${d.t}|${d.c}|${d.g}`;
    case 'movie':
    case 'series':
    case 'boxset':
      return `${d.k}|${d.t}|${d.i}`;
    case 'season':
      return `season|${d.t}|${d.i}|${d.s}`;
    case 'episode':
      return `episode|${d.t}|${d.i}|${d.s}|${d.e}|${d.v}`;
    case 'person':
      return `person|${d.n}`;
    case 'source':
      return `source|${d.h}`;
  }
}

let pending: { id: string; payload: JellyfinDescriptor }[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const queued = new Set<string>();
const QUEUED_MAX = 50_000;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingIds();
  }, 250);
  flushTimer.unref?.();
}

export async function flushPendingIds(): Promise<void> {
  const batch = pending;
  pending = [];
  if (!batch.length) return;
  try {
    await JellyfinRepository.rememberIds(batch);
  } catch (error) {
    for (const b of batch) queued.delete(b.id);
    logger.warn(
      {
        count: batch.length,
        err: error instanceof Error ? error.message : String(error),
      },
      'failed to persist jellyfin id mappings'
    );
  }
}

function rememberHashed(id: string, d: JellyfinDescriptor) {
  if (queued.has(id)) return;
  if (queued.size >= QUEUED_MAX) queued.clear();
  queued.add(id);
  pending.push({ id, payload: d });
  scheduleFlush();
  void idCache.set(id, d, ID_CACHE_TTL).catch(() => undefined);
}

export function viewId(type: string, catalogId: string): string {
  return marked(MARK_VIEW, `view|${type}|${catalogId}`);
}

export function genreId(
  type: string,
  catalogId: string,
  genre: string
): string {
  return marked(MARK_GENRE, `genre|${type}|${catalogId}|${genre}`);
}

export function personId(name: string): string {
  const id = marked(MARK_PERSON, `person|${name}`);
  void personCache.set(id, name, PERSON_TTL).catch(() => undefined);
  return id;
}

export function mediaSourceId(uuid: string, identity: string): string {
  return marked(MARK_SOURCE, `source|${uuid}|${identity}`);
}

/** The id of the "Load versions" source, derived so nothing has to store it. */
export function resolveMarkerId(uuid: string, itemId: string): string {
  return mediaSourceId(uuid, `resolve|${itemId}`);
}

export function encodeItemId(d: JellyfinDescriptor): string {
  switch (d.k) {
    case 'view':
      return viewId(d.t, d.c);
    case 'genre':
      return genreId(d.t, d.c, d.g);
    case 'person':
      return personId(d.n);
    case 'source':
      return d.h;
    default: {
      const packed = tryPack(d);
      if (packed) return packed;
      const id = marked(MARK_HASHED, canonicalDescriptor(d));
      rememberHashed(id, d);
      return id;
    }
  }
}

export interface DecodeScope {
  catalogs?: Manifest['catalogs'];
}

export type DecodedId =
  | { kind: 'descriptor'; descriptor: JellyfinDescriptor }
  | { kind: 'source'; msid: string };

export async function decodeItemId(
  raw: string,
  scope: DecodeScope = {}
): Promise<DecodedId | null> {
  const hex = hyphenless(raw);
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  const buf = Buffer.from(hex, 'hex');
  switch (buf[0]) {
    case MARK_PACKED: {
      const d = unpack(buf);
      return d ? { kind: 'descriptor', descriptor: d } : null;
    }
    case MARK_VIEW: {
      for (const c of scope.catalogs ?? []) {
        if (viewId(c.type, c.id) === hex) {
          return {
            kind: 'descriptor',
            descriptor: { k: 'view', t: c.type, c: c.id },
          };
        }
      }
      return null;
    }
    case MARK_GENRE: {
      for (const c of scope.catalogs ?? []) {
        const options = c.extra?.find((e) => e.name === 'genre')?.options ?? [];
        for (const g of options) {
          if (g && genreId(c.type, c.id, g) === hex) {
            return {
              kind: 'descriptor',
              descriptor: { k: 'genre', t: c.type, c: c.id, g },
            };
          }
        }
      }
      return null;
    }
    case MARK_PERSON: {
      const name = await personCache.get(hex).catch(() => undefined);
      return name
        ? { kind: 'descriptor', descriptor: { k: 'person', n: name } }
        : null;
    }
    case MARK_SOURCE:
      return { kind: 'source', msid: hex };
    case MARK_HASHED: {
      const cached = await idCache.get(hex).catch(() => undefined);
      if (cached) return { kind: 'descriptor', descriptor: cached };
      const stored = await JellyfinRepository.lookupId<JellyfinDescriptor>(hex);
      if (!stored) return null;
      void idCache.set(hex, stored, ID_CACHE_TTL).catch(() => undefined);
      return { kind: 'descriptor', descriptor: stored };
    }
    default:
      return null;
  }
}

/** Convenience for routes that only accept content ids. */
export async function decodeContentId(
  raw: string,
  scope: DecodeScope = {}
): Promise<ContentDescriptor | null> {
  const decoded = await decodeItemId(raw, scope);
  if (!decoded || decoded.kind !== 'descriptor') return null;
  const d = decoded.descriptor;
  return d.k === 'movie' ||
    d.k === 'series' ||
    d.k === 'boxset' ||
    d.k === 'season' ||
    d.k === 'episode'
    ? d
    : null;
}

export function uuidToUserId(uuid: string): string {
  return hyphenless(uuid);
}

/** The account keeps the bare uuid id, which signed-in clients already hold. */
export function personaUserId(uuid: string, persona: string): string {
  if (!persona) return uuidToUserId(uuid);
  return sha(`jellyfin-persona:${uuid}:${persona}`)
    .toString('hex')
    .slice(0, 32);
}

/** The Jellyfin item a watch-state row stands for. */
export function descriptorForWatchRow(row: WatchStateRow): ContentDescriptor {
  if (row.episode != null) {
    return {
      k: 'episode',
      t: row.mediaType,
      i: row.baseId,
      s: row.season ?? 1,
      e: row.episode,
      v: row.videoId ?? row.baseId,
    };
  }
  return row.mediaType === 'movie'
    ? { k: 'movie', t: row.mediaType, i: row.baseId }
    : { k: 'series', t: row.mediaType, i: row.baseId };
}

export function itemIdForWatchRow(row: WatchStateRow): string {
  return encodeItemId(descriptorForWatchRow(row));
}
