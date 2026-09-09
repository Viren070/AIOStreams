import type { SegmentProviderId } from '../../utils/constants.js';

/** The Jellyfin segment types a provider here can supply. */
export type SegmentType = 'Intro' | 'Recap' | 'Outro';

export interface Segment {
  type: SegmentType;
  startMs: number;
  endMs: number;
  /** Which provider supplied it; carried for logging, not for clients. */
  provider: SegmentProviderId;
}

/** Every id space a provider might key on. Keys are Stremio's spellings. */
export type SegmentIdKey =
  | 'imdb'
  | 'tmdb'
  | 'tvdb'
  | 'mal'
  | 'kitsu'
  | 'anilist'
  | 'anidb';

export interface SegmentLookup {
  kind: 'movie' | 'episode';
  ids: Partial<Record<SegmentIdKey, string>>;
  season?: number;
  episode?: number;
  /** Rejects and clamps entries that cannot fit this cut. Absent until an item has been resolved. */
  runtimeMs?: number;
}

export interface ProviderContext {
  baseUrl: string;
  timeoutMs: number;
  /** Only applied by providers that publish a score. */
  minConfidence: number;
  minSubmissions: number;
  animeSkipClientId: string;
}

export interface SegmentProvider {
  id: SegmentProviderId;
  defaultBaseUrl: string;
  /** Ids this provider needs, so the caller knows what to resolve first. */
  readonly idKeys: readonly SegmentIdKey[];
  /** What it covers before any ids are resolved, which `supports` cannot answer. */
  readonly kinds: readonly SegmentLookup['kind'][];
  /** The precise gate, run once ids are resolved. */
  supports(lookup: SegmentLookup, ctx: ProviderContext): boolean;
  /** Raw segments in any order. Throwing is safe, and ranges are validated centrally. */
  fetch(lookup: SegmentLookup, ctx: ProviderContext): Promise<Segment[]>;
}
