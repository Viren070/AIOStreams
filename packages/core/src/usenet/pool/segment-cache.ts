import { SegmentData } from '../types.js';
import { DiskBackedCache } from '../../utils/disk-backed-cache.js';
import { SegmentArena } from './segment-arena.js';

/** Point-in-time cache stats for the dashboard. */
export interface CacheStats {
  hits: number;
  misses: number;
  /** hits / (hits + misses); 0 when never queried. */
  hitRate: number;
  /** On-disk cache bytes. */
  diskBytes: number;
  /** On-disk cache entry count. */
  diskCount: number;
  /** Subset of hits served from the disk cache. */
  diskHits: number;
  /** Allocated in-RAM arena bytes (pinned decoded bodies, serve-path tier). */
  arenaBytes?: number;
  /** Resident arena entries. */
  arenaEntries?: number;
  /** Arena entries currently pinned by in-flight reads (hovers near 0). */
  arenaPinned?: number;
  arenaEvictions?: number;
}

export interface SegmentCacheOptions {
  /**
   * In-RAM byte budget for the pinned segment arena (see {@link SegmentArena}).
   * `0` disables it.
   */
  arenaBytes?: number;
  /**
   * In-RAM byte budget for owned bodies in the generic cache's mem tier.
   * Superseded by the arena; kept for rollback.
   */
  memBytes?: number;
  /** On-disk byte budget. `0` (default) disables the cache. */
  diskBytes?: number;
  /** Base directory for the disk cache. */
  diskPath?: string;
  /** Subdirectory namespace (e.g. per provider-set) under {@link diskPath}. */
  namespace?: string;
}

/** JSON metadata buffer (shared by serialize / size / serialize-into). */
function metaBufOf(s: SegmentData): Buffer {
  return Buffer.from(
    JSON.stringify({
      byteRange: s.byteRange,
      fileSize: s.fileSize,
      name: s.name,
      size: s.size,
    }),
    'utf8'
  );
}

/** Length-prefixed metadata header + raw body. */
function serializeSegment(s: SegmentData): Buffer {
  const meta = metaBufOf(s);
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(meta.length, 0);
  return Buffer.concat([header, meta, s.body]);
}

/** Exact serialized byte length (drives the pooled write-buffer slot size). */
function serializedSegmentSize(s: SegmentData): number {
  return 4 + metaBufOf(s).length + s.body.length;
}

/**
 * Zero-alloc serializer: write `[u32 metaLen][meta][body]` straight into `dst`
 * (the cache's pooled write slot) instead of allocating via `Buffer.concat`. Runs
 * synchronously at `set()` time, capturing the (pooled ring-slot or leased
 * arena-slot) body before it can be reused. Returns the number of bytes written.
 */
function serializeSegmentInto(s: SegmentData, dst: Buffer): number {
  const meta = metaBufOf(s);
  dst.writeUInt32LE(meta.length, 0);
  meta.copy(dst, 4);
  s.body.copy(dst, 4 + meta.length);
  return 4 + meta.length + s.body.length;
}

function deserializeSegment(buf: Buffer): SegmentData {
  const metaLen = buf.readUInt32LE(0);
  const meta = JSON.parse(buf.toString('utf8', 4, 4 + metaLen));
  const body = buf.subarray(4 + metaLen);
  return {
    body,
    byteRange: meta.byteRange,
    fileSize: meta.fileSize,
    name: meta.name,
    size: meta.size ?? body.length,
  };
}

/**
 * Cache for decoded segment payloads: a pinned in-RAM {@link SegmentArena}
 * (populated by the pool's shared fetch coordinator, not by {@link set}) in
 * front of an on-disk tier that survives restarts. Keyed by message-id.
 * {@link getAsync} consults the disk before a network fetch.
 */
export class SegmentCache {
  private cache: DiskBackedCache<SegmentData>;
  /** Pinned decoded-body tier; owned here, driven by MultiProviderPool. */
  readonly arena: SegmentArena;

  constructor(opts: SegmentCacheOptions) {
    this.arena = new SegmentArena({ budgetBytes: opts.arenaBytes ?? 0 });
    this.cache = new DiskBackedCache<SegmentData>({
      name: opts.namespace ?? 'segments',
      dir: opts.diskPath ?? '',
      maxMemBytes: opts.memBytes ?? 0,
      maxDiskBytes: opts.diskBytes ?? 0,
      serialize: serializeSegment,
      serializeInto: serializeSegmentInto,
      serializedSize: serializedSegmentSize,
      deserialize: deserializeSegment,
      sizeOf: (s) => s.body.length,
    });
  }

  /** Synchronous lookup for the hot path (in-process; no network or disk read). */
  get(messageId: string): SegmentData | undefined {
    return this.cache.get(messageId);
  }

  /** Disk lookup, consulted before a network fetch. */
  getAsync(messageId: string): Promise<SegmentData | undefined> {
    return this.cache.getAsync(messageId);
  }

  /**
   * Insert a decoded segment, written through to disk. `skipMem` must be set
   * when `data.body` is a view into a recycled decode slot: the disk tier
   * copies it out synchronously, but the mem tier would retain the view past
   * the slot's recycle. The arena is never populated via set(); the
   * coordinator commits leased slots directly.
   */
  set(
    messageId: string,
    data: SegmentData,
    opts?: { skipMem?: boolean }
  ): void {
    this.cache.set(messageId, data, opts);
  }

  stats(): CacheStats {
    const s = this.cache.stats();
    const a = this.arena.stats();
    // Arena misses always fall through to the disk tier (which counts its own
    // hit-or-miss), so merged misses = disk misses; merged hits add arena hits.
    const hits = s.hits + a.hits;
    const misses = s.misses;
    return {
      hits,
      misses,
      hitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
      diskBytes: s.diskBytes,
      diskCount: s.diskCount,
      diskHits: s.diskHits,
      arenaBytes: a.bytes,
      arenaEntries: a.entries,
      arenaPinned: a.pinned,
      arenaEvictions: a.evictions,
    };
  }

  clear(): void {
    this.arena.clear();
    void this.cache.clear();
  }

  /** Flush the disk index + drain pending writes (called on engine close). */
  async close(): Promise<void> {
    this.arena.clear();
    await this.cache.close();
  }
}
