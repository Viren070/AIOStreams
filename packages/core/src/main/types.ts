import type {
  Addon,
  Manifest,
  StrictManifestResource,
  UserData,
} from '../db/index.js';
import type { Preset } from '../db/schemas.js';
import type Proxifier from '../streams/proxifier.js';
import type StreamLimiter from '../streams/limiter.js';
import type {
  StreamFetcher as Fetcher,
  StreamFilterer as Filterer,
  StreamSorter as Sorter,
  StreamDeduplicator as Deduplicator,
  StreamPrecomputer as Precomputer,
  StreamContext,
} from '../streams/index.js';
import type { ServiceWrapServiceTiming } from './serviceWrapper.js';
import type { PrecomputeSubTimings } from '../streams/precomputer.js';

export interface AIOStreamsError {
  title?: string;
  description?: string;
}

export interface AIOStreamsResponse<T> {
  success: boolean;
  data: T;
  errors: AIOStreamsError[];
}

export interface AIOStreamsOptions {
  skipFailedAddons?: boolean;
  increasedManifestTimeout?: boolean;
  bypassManifestCache?: boolean;
}

export type StatEntry = {
  title: string;
  description: string;
  forced?: boolean;
};

export type PipelineTimings = {
  metaFilterMs: number;
  serviceWrapMs: number;
  serviceWrapTimings?: Record<string, ServiceWrapServiceTiming>;
  filterMs: number;
  deduplicationMs: number;
  precomputeMs: number;
  precomputeSubTimings?: PrecomputeSubTimings;
  sortMs: number;
  limitMs: number;
  selMs: number;
};

/**
 * Shared mutable context passed to all AIOStreams functions.
 * Owned by the AIOStreams class; passed into every module function.
 * `userData` is the only field that may be mutated at runtime
 * (precacheNextEpisode temporarily swaps it with a cloned copy).
 */
export interface AIOStreamsContext {
  userData: UserData;
  readonly options: AIOStreamsOptions | undefined;
  readonly manifestUrl: string;
  manifests: Record<string, Manifest | null>;
  supportedResources: Record<string, StrictManifestResource[]>;
  finalResources: StrictManifestResource[];
  finalCatalogs: Manifest['catalogs'];
  finalAddonCatalogs: Manifest['addonCatalogs'];
  isInitialised: boolean;
  addons: Addon[];
  proxifier: Proxifier;
  limiter: StreamLimiter;
  fetcher: Fetcher;
  filterer: Filterer;
  deduplicator: Deduplicator;
  sorter: Sorter;
  precomputer: Precomputer;
  streamContext: StreamContext | null;
  addonInitialisationErrors: { addon: Addon | Preset; error: string }[];
}
