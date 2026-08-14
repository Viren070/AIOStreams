import { DiskBackedCache } from './disk-backed-cache.js';
import { getCacheFolder } from './general.js';

/**
 * Where every grab cache (NZB bodies, torrent metadata, …) lives on disk. Sits
 * under the shared `<data>/cache` root alongside every other disk-backed cache,
 * each in its own namespace subdirectory, so they show up together on the
 * dashboard cache page.
 */
export const GRAB_CACHE_DIR = (): string => getCacheFolder();

export interface GrabCacheOptions<V> {
  /** Namespace (subdirectory + dashboard label). Must be filesystem-safe. */
  name: string;
  /** Base directory; defaults to `<data>/grabs`. */
  dir?: string;
  /** L1 (in-memory) byte budget. */
  maxMemBytes: number;
  /** L2 (on-disk) byte budget. */
  maxDiskBytes: number;
  serialize: (value: V) => Buffer;
  deserialize: (buf: Buffer) => V;
  sizeOf: (value: V) => number;
}

/**
 * A single-flighted, disk-backed cache of grabbed remote artefacts, keyed by
 * source URL. The shared primitive behind every "grab" in AIOStreams — raw
 * `.nzb` bodies ({@link DownloadManager}) and parsed torrent metadata
 * ({@link TorrentGrabber}). Both kinds want the same three things: dedupe
 * concurrent fetches of the same URL, survive restarts, and feed the dashboard
 * cache page. Only the value codecs + budgets differ.
 *
 * The producer is supplied by the caller: NZB grabs hand it a raw HTTP fetch;
 * torrent grabs hand it the fetch-then-parse (incl. magnet-redirect handling)
 * pipeline. Single-flight + caching live here; producer-specific policy (the
 * torrent concurrency limiter, lazy mode) stays with the caller via
 * {@link GrabCache.cached}/{@link GrabCache.inFlight}.
 */
export class GrabCache<V> {
  private readonly cache: DiskBackedCache<V>;
  private readonly inflight = new Map<string, Promise<V>>();
  /** Full fetch lifecycle, including the async L2 lookup before production. */
  private readonly fetches = new Map<string, Promise<V>>();
  /** Per-key invalidations; unrelated grab URLs never block one another. */
  private readonly deletions = new Map<string, Promise<boolean>>();

  constructor(opts: GrabCacheOptions<V>) {
    this.cache = new DiskBackedCache<V>({
      name: opts.name,
      dir: opts.dir ?? GRAB_CACHE_DIR(),
      maxMemBytes: opts.maxMemBytes,
      maxDiskBytes: opts.maxDiskBytes,
      serialize: opts.serialize,
      deserialize: opts.deserialize,
      sizeOf: opts.sizeOf,
    });
  }

  /** Cached value for `key` (L1→L2), or `undefined` on a miss. */
  async cached(key: string): Promise<V | undefined> {
    for (;;) {
      const deleting = this.deletions.get(key);
      if (!deleting) break;
      await deleting.catch(() => false);
    }
    return this.cache.getAsync(key);
  }

  /** The in-flight producer for `key`, if one is running. */
  inFlight(key: string): Promise<V> | undefined {
    return this.inflight.get(key);
  }

  /**
   * Return the cached value for `key`, else run (and cache) `produce`, deduping
   * concurrent callers for the same key. Successful results are written through
   * to the cache; failures reject and are not cached.
   */
  async fetch(key: string, produce: () => Promise<V>): Promise<V> {
    // A fetch that arrives during invalidation must observe the post-delete
    // state. Loop because another coalesced invalidation may start as the
    // previous one settles.
    for (;;) {
      const deleting = this.deletions.get(key);
      if (!deleting) break;
      await deleting.catch(() => false);
    }

    // Register before the first async cache lookup. This closes the window in
    // which delete() could otherwise miss a fetch that has begun reading L2
    // but has not started its producer yet.
    const active = this.fetches.get(key);
    if (active) return active;

    let fetch!: Promise<V>;
    fetch = (async () => {
      const hit = await this.cache.getAsync(key);
      if (hit !== undefined) return hit;

      const existing = this.inflight.get(key);
      if (existing) return existing;

      const producer = produce()
        .then((value) => {
          this.cache.set(key, value);
          return value;
        })
        .finally(() => {
          if (this.inflight.get(key) === producer) {
            this.inflight.delete(key);
          }
        });
      this.inflight.set(key, producer);
      return producer;
    })().finally(() => {
      if (this.fetches.get(key) === fetch) this.fetches.delete(key);
    });
    this.fetches.set(key, fetch);
    return fetch;
  }

  /** Remove one key after any earlier fetch for it has completely settled. */
  delete(key: string): Promise<boolean> {
    const existing = this.deletions.get(key);
    if (existing) return existing;

    let deletion!: Promise<boolean>;
    deletion = (async () => {
      const running = this.fetches.get(key);
      if (running) await running.catch(() => undefined);
      return this.cache.delete(key);
    })().finally(() => {
      if (this.deletions.get(key) === deletion) this.deletions.delete(key);
    });
    this.deletions.set(key, deletion);
    return deletion;
  }
}
