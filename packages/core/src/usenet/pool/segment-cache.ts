import { SegmentData } from '../types.js';
import { DiskBackedCache } from '../../utils/disk-backed-cache.js';

/** Point-in-time cache stats for the dashboard. */
export interface CacheStats {
  /** Memory-tier bytes (alias of {@link memBytes}; kept for back-compat). */
  sizeBytes: number;
  /** Memory-tier budget. */
  maxBytes: number;
  /** Memory-tier entry count. */
  count: number;
  hits: number;
  misses: number;
  /** hits / (hits + misses); 0 when never queried. */
  hitRate: number;
  /** L1 (memory) bytes. */
  memBytes: number;
  /** L2 (disk) bytes. */
  diskBytes: number;
  /** L2 (disk) entry count. */
  diskCount: number;
  /** Subset of hits served from the disk tier. */
  diskHits: number;
}

export interface SegmentCacheOptions {
  /** L1 (in-memory) byte budget. */
  maxBytes: number;
  /** L2 (on-disk) byte budget. `0` (default) disables the disk tier. */
  diskBytes?: number;
  /** Base directory for the disk tier. */
  diskPath?: string;
  /** Subdirectory namespace (e.g. per provider-set) under {@link diskPath}. */
  namespace?: string;
}

/** Length-prefixed metadata header + raw body. */
function serializeSegment(s: SegmentData): Buffer {
  const meta = Buffer.from(
    JSON.stringify({
      byteRange: s.byteRange,
      fileSize: s.fileSize,
      name: s.name,
      size: s.size,
    }),
    'utf8'
  );
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(meta.length, 0);
  return Buffer.concat([header, meta, s.body]);
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
 * Bounded, byte-sized LRU cache for decoded segment payloads, backed by the
 * generic two-tier {@link DiskBackedCache} (hot memory L1 + on-disk L2 overflow
 * that survives restarts). Keyed by message-id.
 *
 * The hot path uses the synchronous {@link get} (L1 only); {@link getAsync}
 * additionally consults the disk tier before a network fetch.
 */
export class SegmentCache {
  private cache: DiskBackedCache<SegmentData>;
  private maxBytes: number;

  constructor(opts: SegmentCacheOptions) {
    this.maxBytes = opts.maxBytes;
    this.cache = new DiskBackedCache<SegmentData>({
      name: opts.namespace ?? 'segments',
      dir: opts.diskPath ?? '',
      maxMemBytes: opts.maxBytes,
      maxDiskBytes: opts.diskBytes ?? 0,
      serialize: serializeSegment,
      deserialize: deserializeSegment,
      sizeOf: (s) => s.body.length,
    });
  }

  /** Synchronous L1 lookup for the hot path. */
  get(messageId: string): SegmentData | undefined {
    return this.cache.get(messageId);
  }

  /** L1 → L2 lookup; promotes disk hits back to memory. */
  getAsync(messageId: string): Promise<SegmentData | undefined> {
    return this.cache.getAsync(messageId);
  }

  /**
   * Insert a decoded segment. `disk: false` keeps it L1-only; used for
   * Low-priority (inspect/probe) bodies that the archive parse may re-read
   * shortly but that would otherwise flood the disk tier's write queue.
   */
  set(messageId: string, data: SegmentData, opts?: { disk?: boolean }): void {
    this.cache.set(messageId, data, { skipDisk: opts?.disk === false });
  }

  stats(): CacheStats {
    const s = this.cache.stats();
    return {
      sizeBytes: s.memBytes,
      maxBytes: this.maxBytes,
      count: s.memCount,
      hits: s.hits,
      misses: s.misses,
      hitRate: s.hitRate,
      memBytes: s.memBytes,
      diskBytes: s.diskBytes,
      diskCount: s.diskCount,
      diskHits: s.diskHits,
    };
  }

  clear(): void {
    void this.cache.clear();
  }

  /** Resize the memory budget (e.g. after a settings change) and evict. */
  resize(maxBytes: number): void {
    this.maxBytes = maxBytes;
    this.cache.resize(maxBytes);
  }

  /** Flush the disk index + drain pending writes (called on engine close). */
  async close(): Promise<void> {
    await this.cache.close();
  }
}
