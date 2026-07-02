import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('disk-cache');

/**
 * Codecs + budgets for a {@link DiskBackedCache}. Value-generic: the caller
 * supplies (de)serialisers and a weigher so the same module can back hot binary
 * segment payloads today and torrent/NZB download managers later.
 */
export interface DiskBackedCacheOptions<V> {
  /** Namespace → subdirectory + index file name. Must be filesystem-safe. */
  name: string;
  /** Base directory; the cache lives under `${dir}/${name}/`. */
  dir: string;
  /** L1 (in-memory) byte budget. `0` disables the memory tier. */
  maxMemBytes: number;
  /** L2 (on-disk) byte budget. `0` disables the disk tier. */
  maxDiskBytes: number;
  serialize: (value: V) => Buffer;
  deserialize: (buf: Buffer) => V;
  /** Decoded byte weight of a value (drives both budgets). */
  sizeOf: (value: V) => number;
  /**
   * Optional zero-alloc serializer: write the full serialized form of `value`
   * into `dst` (≥ {@link serializedSize} bytes) and return the bytes written.
   * When provided (with {@link serializedSize}), disk writes serialize
   * synchronously in {@link DiskBackedCache.set} through a pooled, recycled
   * write-buffer ring, so a transient/pooled `value` body is captured before it
   * can be reused, with no per-write `Buffer.concat`. Falls back to
   * {@link serialize} when absent.
   */
  serializeInto?: (value: V, dst: Buffer) => number;
  /** Exact serialized byte length of `value`. Required iff {@link serializeInto} is set. */
  serializedSize?: (value: V) => number;
}

interface MemEntry<V> {
  value: V;
  size: number;
}

interface DiskEntry {
  size: number;
}

export interface DiskBackedCacheStats {
  memBytes: number;
  memCount: number;
  diskBytes: number;
  diskCount: number;
  hits: number;
  misses: number;
  /** Subset of hits that were served from the disk tier. */
  diskHits: number;
  hitRate: number;
}

/**
 * Live registry of all {@link DiskBackedCache} instances so the dashboard can
 * surface them alongside the Redis/SQL/memory caches. Instances register on
 * construction and unregister on {@link DiskBackedCache.close}.
 */
const diskCacheRegistry = new Set<DiskBackedCache<unknown>>();

/** Snapshot every live disk-backed cache for the dashboard cache page. */
export function describeDiskCaches(): {
  name: string;
  maxMemBytes: number;
  maxDiskBytes: number;
  stats: DiskBackedCacheStats;
}[] {
  return [...diskCacheRegistry].map((c) => ({
    name: c.name,
    maxMemBytes: c.maxMemBytes,
    maxDiskBytes: c.maxDiskBytes,
    stats: c.stats(),
  }));
}

/** Clear one registered disk cache by name. Returns false if not found. */
export async function clearDiskCacheByName(name: string): Promise<boolean> {
  const cache = [...diskCacheRegistry].find((c) => c.name === name);
  if (!cache) return false;
  await cache.clear();
  return true;
}

/**
 * Two-tier, byte-bounded, restart-surviving cache: a hot in-memory LRU (L1) in
 * front of an on-disk LRU overflow (L2). One file per key under a namespaced
 * directory, plus a persisted index so the disk budget + LRU survive restarts.
 *
 * Modelled on StremThru's `internal/cache/disk_backed.go` but value-generic via
 * injected codecs. Deliberately independent of the Redis/SQL {@link Cache}: the
 * semantics differ (sync hot-path `get`, byte-bounded eviction, binary values).
 *
 * Writes are write-through but non-blocking: `set` updates L1 synchronously and
 * persists to disk in the background, so the hot path never awaits disk I/O.
 */
export class DiskBackedCache<V> {
  private mem = new Map<string, MemEntry<V>>();
  private memBytes = 0;
  /** L2 index, insertion-order = LRU order (re-inserted on access). */
  private disk = new Map<string, DiskEntry>();
  private diskBytes = 0;

  private hits = 0;
  private misses = 0;
  private diskHits = 0;

  private readonly dir: string;
  private readonly indexPath: string;
  private readonly opts: DiskBackedCacheOptions<V>;

  /** In-flight disk writes keyed by file key, so reads can await consistency. */
  private pendingWrites = new Map<string, Promise<void>>();
  /** Approximate bytes held by in-flight disk writes (serialized payloads). */
  private pendingWriteBytes = 0;
  /** Serialises index persistence. */
  private indexFlush: Promise<void> = Promise.resolve();
  private indexDirty = false;
  private ready: Promise<void>;
  private closed = false;

  constructor(opts: DiskBackedCacheOptions<V>) {
    this.opts = opts;
    this.dir = path.join(opts.dir, opts.name);
    this.indexPath = path.join(opts.dir, `${opts.name}.index.json`);
    this.ready = this.load();
    diskCacheRegistry.add(this as DiskBackedCache<unknown>);
  }

  /** Namespace of this cache (drives the on-disk subdirectory + index file). */
  get name(): string {
    return this.opts.name;
  }

  /** L1 (memory) byte budget. */
  get maxMemBytes(): number {
    return this.opts.maxMemBytes;
  }

  /** L2 (disk) byte budget. */
  get maxDiskBytes(): number {
    return this.opts.maxDiskBytes;
  }

  /** Resolves once the on-disk index has been loaded + reconciled. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private diskEnabled(): boolean {
    return this.opts.maxDiskBytes > 0;
  }

  private fileKey(key: string): string {
    return createHash('sha1').update(key).digest('hex');
  }

  private filePath(fileKey: string): string {
    return path.join(this.dir, fileKey);
  }

  /** Load the persisted index, then reconcile index ↔ files (drop orphans). */
  private async load(): Promise<void> {
    if (!this.diskEnabled()) return;
    try {
      await fs.mkdir(this.dir, { recursive: true });
      let entries: Array<[string, DiskEntry]> = [];
      try {
        const raw = await fs.readFile(this.indexPath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, DiskEntry>;
        entries = Object.entries(parsed);
      } catch {
        // No index yet — first run or it was removed.
      }
      // Index → drop entries whose file is missing.
      const present = new Set(await fs.readdir(this.dir).catch(() => []));
      for (const [fileKey, entry] of entries) {
        if (present.has(fileKey) && typeof entry?.size === 'number') {
          this.disk.set(fileKey, entry);
          this.diskBytes += entry.size;
        }
      }
      // Files → delete any not referenced by the index (StremThru cleanOrphaned).
      for (const fileKey of present) {
        if (!this.disk.has(fileKey)) {
          await fs.rm(this.filePath(fileKey), { force: true }).catch(() => {});
        }
      }
      // The index may have shrunk; trim to budget.
      this.evictDisk();
      logger.debug(
        {
          name: this.opts.name,
          diskCount: this.disk.size,
          diskBytes: this.diskBytes,
        },
        'disk cache loaded'
      );
    } catch (err) {
      logger.warn(
        { name: this.opts.name, err: (err as Error).message },
        'disk cache load failed; continuing memory-only'
      );
    }
  }

  /** Sync L1 lookup for the hot path. Does NOT count a miss (disk may hold it). */
  get(key: string): V | undefined {
    const entry = this.mem.get(key);
    if (!entry) return undefined;
    this.hits++;
    // Refresh LRU recency.
    this.mem.delete(key);
    this.mem.set(key, entry);
    return entry.value;
  }

  /** L1 peek without touching hit/miss counters. */
  private peek(key: string): V | undefined {
    const entry = this.mem.get(key);
    if (!entry) return undefined;
    this.mem.delete(key);
    this.mem.set(key, entry);
    return entry.value;
  }

  /** L1 → L2 lookup; promotes disk hits back into memory. */
  async getAsync(key: string): Promise<V | undefined> {
    const hot = this.peek(key);
    if (hot !== undefined) {
      this.hits++;
      return hot;
    }
    if (!this.diskEnabled()) {
      this.misses++;
      return undefined;
    }
    const fileKey = this.fileKey(key);
    if (!this.disk.has(fileKey)) {
      this.misses++;
      return undefined;
    }
    // Ensure any in-flight write for this key has settled before reading.
    const pending = this.pendingWrites.get(fileKey);
    if (pending) await pending.catch(() => {});
    try {
      const buf = await fs.readFile(this.filePath(fileKey));
      const value = this.opts.deserialize(buf);
      this.hits++;
      this.diskHits++;
      // Refresh disk recency + promote to L1.
      this.disk.delete(fileKey);
      this.disk.set(fileKey, { size: buf.length });
      this.addToMem(key, value, this.opts.sizeOf(value));
      return value;
    } catch {
      // File vanished or is corrupt — drop the index entry.
      this.dropDisk(fileKey);
      this.misses++;
      return undefined;
    }
  }

  /**
   * Insert into L1 and (unless `skipDisk`) write-through to the disk tier in
   * the background. `skipDisk` is for transient payloads (e.g. import-probe
   * article bodies) that benefit from the hot L1 but would only churn the disk.
   * `skipMem` is for values whose backing memory the caller recycles: the
   * disk serialize copies them out synchronously, but the mem tier must not
   * retain the view.
   */
  set(
    key: string,
    value: V,
    opts?: { skipDisk?: boolean; skipMem?: boolean }
  ): void {
    if (this.closed) return;
    const size = this.opts.sizeOf(value);
    if (size <= 0) return;
    const fitsMem = this.opts.maxMemBytes > 0 && size <= this.opts.maxMemBytes;
    const fitsDisk = this.diskEnabled() && size <= this.opts.maxDiskBytes;
    if (!fitsMem && !fitsDisk) return; // larger than every budget

    if (fitsMem && !opts?.skipMem) this.addToMem(key, value, size);
    if (fitsDisk && !opts?.skipDisk) this.persistToDisk(key, value, size);
  }

  private addToMem(key: string, value: V, size: number): void {
    if (this.opts.maxMemBytes <= 0) return;
    const existing = this.mem.get(key);
    if (existing) {
      this.memBytes -= existing.size;
      this.mem.delete(key);
    }
    this.mem.set(key, { value, size });
    this.memBytes += size;
    while (this.memBytes > this.opts.maxMemBytes && this.mem.size > 0) {
      const oldest = this.mem.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const e = this.mem.get(oldest);
      this.mem.delete(oldest);
      if (e) this.memBytes -= e.size;
    }
  }

  /**
   * Backpressure caps for the background write queue. When a burst of inserts
   * outruns the disk, further persists are *dropped* (the disk tier is
   * best-effort) instead of queueing serialized payloads without bound — an
   * import-sized burst previously held hundreds of MB in `pendingWrites`.
   */
  private static readonly MAX_PENDING_WRITES = 64;
  private static readonly MAX_PENDING_WRITE_BYTES = 128 * 1024 * 1024;

  /**
   * Recycled write-buffer ring for the zero-alloc serialize path. Bounded by the
   * same {@link MAX_PENDING_WRITES} backpressure; a slot returns to the pool once
   * its `fs.writeFile` settles.
   */
  private writePool: Buffer[] = [];

  private acquireWriteBuf(size: number): Buffer {
    const slot = this.writePool.pop();
    if (slot && slot.length >= size) return slot;
    return Buffer.allocUnsafe(Math.max(size, 1 << 20));
  }

  private releaseWriteBuf(buf: Buffer): void {
    if (this.writePool.length < DiskBackedCache.MAX_PENDING_WRITES) {
      this.writePool.push(buf);
    }
  }

  /** Update the disk index synchronously; write the file in the background. */
  private persistToDisk(key: string, value: V, size: number): void {
    if (
      this.pendingWrites.size >= DiskBackedCache.MAX_PENDING_WRITES ||
      this.pendingWriteBytes >= DiskBackedCache.MAX_PENDING_WRITE_BYTES
    ) {
      return; // saturated — skip this persist rather than queue it
    }
    const fileKey = this.fileKey(key);
    const existing = this.disk.get(fileKey);
    if (existing) {
      this.diskBytes -= existing.size;
      this.disk.delete(fileKey);
    }
    this.disk.set(fileKey, { size });
    this.diskBytes += size;
    this.indexDirty = true;
    this.evictDisk();

    // Zero-alloc path: serialize SYNCHRONOUSLY into a pooled slot (capturing a
    // transient/pooled `value` body before it can be reused), then write the
    // slot's bytes and recycle it. Falls back to the allocating `serialize` when
    // the codec doesn't provide the into-form.
    const into = this.opts.serializeInto;
    const sizer = this.opts.serializedSize;
    let slot: Buffer | undefined;
    let payload: Buffer;
    if (into && sizer) {
      slot = this.acquireWriteBuf(sizer(value));
      payload = slot.subarray(0, into(value, slot));
    } else {
      payload = this.opts.serialize(value);
    }

    let write: Promise<void>;
    this.pendingWriteBytes += size;
    const run = async (): Promise<void> => {
      try {
        await fs.writeFile(this.filePath(fileKey), payload);
      } catch (err) {
        // Roll back the index entry on write failure.
        this.dropDisk(fileKey);
        logger.debug(
          { name: this.opts.name, err: (err as Error).message },
          'disk cache write failed'
        );
      } finally {
        if (slot) this.releaseWriteBuf(slot);
        this.pendingWriteBytes -= size;
        if (this.pendingWrites.get(fileKey) === write) {
          this.pendingWrites.delete(fileKey);
        }
      }
    };
    write = run();
    this.pendingWrites.set(fileKey, write);
  }

  /** Evict least-recently-used disk entries until within budget. */
  private evictDisk(): void {
    while (this.diskBytes > this.opts.maxDiskBytes && this.disk.size > 0) {
      const oldest = this.disk.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.dropDisk(oldest);
    }
  }

  private dropDisk(fileKey: string): void {
    const entry = this.disk.get(fileKey);
    if (!entry) return;
    this.disk.delete(fileKey);
    this.diskBytes -= entry.size;
    this.indexDirty = true;
    fs.rm(this.filePath(fileKey), { force: true }).catch(() => {});
  }

  stats(): DiskBackedCacheStats {
    const total = this.hits + this.misses;
    return {
      memBytes: this.memBytes,
      memCount: this.mem.size,
      diskBytes: this.diskBytes,
      diskCount: this.disk.size,
      hits: this.hits,
      misses: this.misses,
      diskHits: this.diskHits,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  async delete(key: string): Promise<boolean> {
    let removed = false;
    const memEntry = this.mem.get(key);
    if (memEntry) {
      this.mem.delete(key);
      this.memBytes -= memEntry.size;
      removed = true;
    }
    const fileKey = this.fileKey(key);
    if (this.disk.has(fileKey)) {
      this.dropDisk(fileKey);
      removed = true;
    }
    return removed;
  }

  async clear(): Promise<void> {
    this.mem.clear();
    this.memBytes = 0;
    this.disk.clear();
    this.diskBytes = 0;
    this.indexDirty = true;
    if (this.diskEnabled()) {
      await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(this.dir, { recursive: true }).catch(() => {});
      await fs.rm(this.indexPath, { force: true }).catch(() => {});
    }
  }

  /** Adjust budgets (e.g. after a settings change) and evict to fit. */
  resize(maxMemBytes: number, maxDiskBytes?: number): void {
    this.opts.maxMemBytes = maxMemBytes;
    if (maxDiskBytes !== undefined) this.opts.maxDiskBytes = maxDiskBytes;
    while (this.memBytes > this.opts.maxMemBytes && this.mem.size > 0) {
      const oldest = this.mem.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const e = this.mem.get(oldest);
      this.mem.delete(oldest);
      if (e) this.memBytes -= e.size;
    }
    this.evictDisk();
  }

  /** Persist the disk index. Coalesces concurrent callers. */
  async flushIndex(): Promise<void> {
    if (!this.diskEnabled() || !this.indexDirty) return;
    this.indexFlush = this.indexFlush.then(async () => {
      if (!this.indexDirty) return;
      this.indexDirty = false;
      const snapshot: Record<string, DiskEntry> = {};
      for (const [k, v] of this.disk) snapshot[k] = v;
      try {
        await fs.writeFile(this.indexPath, JSON.stringify(snapshot));
      } catch (err) {
        this.indexDirty = true;
        logger.debug(
          { name: this.opts.name, err: (err as Error).message },
          'disk cache index flush failed'
        );
      }
    });
    return this.indexFlush;
  }

  /** Drain in-flight writes, persist the index, and stop accepting writes. */
  async close(): Promise<void> {
    this.closed = true;
    diskCacheRegistry.delete(this as DiskBackedCache<unknown>);
    await Promise.allSettled([...this.pendingWrites.values()]);
    await this.flushIndex();
  }
}
