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
  /** TMDB season/episode candidates, best first. Absent: `season`/`episode` already are; empty: none known. */
  tmdbEpisodes?: { season: number; episode: number }[];
}

export interface SegmentProviderStatus {
  id: SegmentProviderId;
  name: string;
  /** `configuration`: usable only by configurations that enter their own key. */
  key: 'none' | 'instance' | 'configuration';
}

/** Per-configuration keys, each overriding the instance's own. */
export interface SegmentCredentials {
  pmdbApiKey?: string;
}

export interface ProviderContext {
  baseUrl: string;
  timeoutMs: number;
  /** Only applied by providers that publish a score. */
  minConfidence: number;
  minSubmissions: number;
  animeSkipClientId: string;
  pmdbApiKey: string;
}

export interface SegmentProvider {
  id: SegmentProviderId;
  name: string;
  defaultBaseUrl: string;
  /** Ids this provider needs, so the caller knows what to resolve first. */
  readonly idKeys: readonly SegmentIdKey[];
  /** What it covers before any ids are resolved, which `supports` cannot answer. */
  readonly kinds: readonly SegmentLookup['kind'][];
  /** Absent means it needs no credentials. */
  configured?(ctx: ProviderContext): boolean;
  /** The credential a configuration can supply when the instance has none. */
  readonly configurationKey?: keyof SegmentCredentials;
  /** The precise gate, run once ids are resolved. */
  supports(lookup: SegmentLookup, ctx: ProviderContext): boolean;
  /** Raw segments in any order. Throwing is safe, and ranges are validated centrally. */
  fetch(lookup: SegmentLookup, ctx: ProviderContext): Promise<Segment[]>;
}
