import type {
  WatchIdentity,
  WatchKind,
  WatchOrigin,
  WatchSnapshot,
  WatchStateRow,
} from '../db/repositories/watch-state.js';
import { IdParser } from '../utils/id-parser.js';

export type {
  WatchIdentity,
  WatchKind,
  WatchOrigin,
  WatchSnapshot,
  WatchStateRow,
};

/** The primary user: the key every row had before personas existed. */
export const ACCOUNT_PERSONA = '';

/**
 * Names one history. Anything that reads or writes a row keyed by
 * `(uuid, persona)` takes this; a credential or a piece of content is a `uuid`.
 */
export interface WatchScope {
  uuid: string;
  persona: string;
}

export function accountScope(uuid: string): WatchScope {
  return { uuid, persona: ACCOUNT_PERSONA };
}

export function scopeOf(row: { uuid: string; persona: string }): WatchScope {
  return { uuid: row.uuid, persona: row.persona };
}

export interface ContentRef {
  /** What this is, independent of the Stremio type used to route requests. */
  kind: WatchKind;
  /** Stremio type used for meta and stream requests (`movie`, `series`, `anime`, ...). */
  type: string;
  /** The meta id (`tt0903747`, `kitsu:123`, `ctmdb.531241`). */
  baseId: string;
  season?: number | null;
  episode?: number | null;
  /** The exact stream id for episodes and boxset children. */
  videoId?: string | null;
}

/**
 * The Stremio type is deliberately not in the key: it is routing information, so
 * one episode reached through two catalogs of different types is one row.
 * Episodes key on the video id, the address a local play and a pulled row share,
 * so absolute and broadcast numbering each key as themselves.
 */
export function itemKeyFor(ref: ContentRef): string {
  if (ref.kind === 'episode') return `e|${episodeAddress(ref)}`;
  return ref.kind === 'movie' ? `m|${ref.baseId}` : seriesKeyOf(ref.baseId);
}

/** Never compose this by hand: a mismatched key silently matches nothing. */
export function seriesKeyOf(baseId: string): string {
  return `s|${baseId}`;
}

function episodeAddress(ref: ContentRef): string {
  if (ref.videoId) return ref.videoId;
  // Only reached for a malformed descriptor; a real episode always carries one.
  return ref.season == null
    ? `${ref.baseId}:${ref.episode}`
    : `${ref.baseId}:${ref.season}:${ref.episode}`;
}

/**
 * The series an episode belongs to. A catalog can list an episode under an id
 * of its own that embeds the series id, which its video id names directly.
 */
export function seriesIdOf(
  baseId: string,
  videoId: string | null | undefined,
  type: string
): string {
  if (!videoId || IdParser.parse(baseId, type)) return baseId;
  const parsed = IdParser.parse(videoId, type);
  if (!parsed?.episode) return baseId;
  const suffix = parsed.season
    ? `:${parsed.season}:${parsed.episode}`
    : `:${parsed.episode}`;
  if (!videoId.endsWith(suffix)) return baseId;
  const series = videoId.slice(0, -suffix.length);
  return containsToken(baseId, series) ? series : baseId;
}

function containsToken(haystack: string, token: string): boolean {
  const word = /[A-Za-z0-9]/;
  for (
    let at = haystack.indexOf(token);
    at !== -1;
    at = haystack.indexOf(token, at + 1)
  ) {
    const before = haystack[at - 1];
    const after = haystack[at + token.length];
    if ((!before || !word.test(before)) && (!after || !word.test(after)))
      return true;
  }
  return false;
}

export function seriesKeyFor(ref: ContentRef): string | null {
  return ref.kind === 'episode' ? seriesKeyOf(ref.baseId) : null;
}

export function identityFor(input: ContentRef): WatchIdentity {
  const baseId =
    input.kind === 'episode'
      ? seriesIdOf(input.baseId, input.videoId, input.type)
      : input.baseId;
  const ref = baseId === input.baseId ? input : { ...input, baseId };
  return {
    itemKey: itemKeyFor(ref),
    kind: ref.kind,
    mediaType: ref.type,
    baseId: ref.baseId,
    // Absolute numbering keeps a null season; 1 would be a different item.
    season: ref.kind === 'episode' ? (ref.season ?? null) : null,
    episode: ref.kind === 'episode' ? (ref.episode ?? null) : null,
    videoId: ref.videoId ?? (ref.kind === 'movie' ? ref.baseId : null),
    seriesKey: seriesKeyFor(ref),
  };
}

export interface WatchProgressEvent {
  type: 'start' | 'progress' | 'stop';
  identity: WatchIdentity;
  positionMs?: number;
  durationMs?: number;
  snapshot?: WatchSnapshot;
}

export interface WatchFlagEvent {
  type: 'played' | 'unplayed' | 'favorite' | 'unfavorite';
  identity: WatchIdentity;
  snapshot?: WatchSnapshot;
}

export type WatchEvent = WatchProgressEvent | WatchFlagEvent;

export type WatchChangeListener = (
  scope: WatchScope,
  rows: WatchStateRow[]
) => void;

export interface WatchStateProvider {
  getMany(
    scope: WatchScope,
    itemKeys: string[]
  ): Promise<Map<string, WatchStateRow>>;
  listResume(
    scope: WatchScope,
    limit: number,
    kinds?: WatchKind[]
  ): Promise<WatchStateRow[]>;
  listRecentSeries(scope: WatchScope, limit: number): Promise<WatchStateRow[]>;
  listFavorites(
    scope: WatchScope,
    kinds?: WatchKind[]
  ): Promise<WatchStateRow[]>;
  listPlayed(scope: WatchScope, kinds?: WatchKind[]): Promise<WatchStateRow[]>;
  listForSeries(scope: WatchScope, seriesKey: string): Promise<WatchStateRow[]>;
  record(scope: WatchScope, event: WatchEvent): Promise<WatchStateRow | null>;
  onChange(listener: WatchChangeListener): () => void;
  flush(): Promise<void>;
}
