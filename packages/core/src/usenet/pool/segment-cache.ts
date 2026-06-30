import { SegmentData } from '../types.js';
import { DiskBackedCache } from '../../utils/disk-backed-cache.js';

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
}

export interface SegmentCacheOptions {
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
 * synchronously at `set()` time, capturing the (pooled ring-slot) body before it
 * can be reused. Returns the number of bytes written.
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
 * Disk-only cache for decoded segment payloads, backed by the generic
 * {@link DiskBackedCache} as an on-disk tier that survives restarts. Keyed by
 * message-id. {@link getAsync} consults the disk before a network fetch.
 */
export class SegmentCache {
  private cache: DiskBackedCache<SegmentData>;

  constructor(opts: SegmentCacheOptions) {
    this.cache = new DiskBackedCache<SegmentData>({
      name: opts.namespace ?? 'segments',
      dir: opts.diskPath ?? '',
      maxMemBytes: 0,
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

  /** Insert a decoded segment, written through to disk. */
  set(messageId: string, data: SegmentData): void {
    this.cache.set(messageId, data);
  }

  stats(): CacheStats {
    const s = this.cache.stats();
    return {
      hits: s.hits,
      misses: s.misses,
      hitRate: s.hitRate,
      diskBytes: s.diskBytes,
      diskCount: s.diskCount,
      diskHits: s.diskHits,
    };
  }

  clear(): void {
    void this.cache.clear();
  }

  /** Flush the disk index + drain pending writes (called on engine close). */
  async close(): Promise<void> {
    await this.cache.close();
  }
}
