import pLimit from 'p-limit';
import { createLogger } from '../../../logging/logger.js';
import { RandomAccess, readAtIntoFrom } from './random-access.js';

const logger = createLogger('usenet/archive');

/** A lazily-openable archive volume. */
export interface Volume {
  filename: string;
  /**
   * Open the volume as a random-access source (e.g. a {@link FileStream}). The
   * `knownSize` hint lets the source skip its own size probe (no segment fetch
   * at open time).
   */
  open: (knownSize?: number) => Promise<RandomAccess>;
  /**
   * Pre-known decoded size of this volume (e.g. from the yEnc `=ybegin size=`
   * header fetched during NZB inspection). When provided, the volume is opened
   * lazily on the first {@link VolumeSet.readAt} access rather than upfront,
   * which avoids fetching first+last segments for every volume just to compute
   * cumulative offsets.
   */
  knownSize?: number;
}

/**
 * Presents an ordered set of archive volumes as one logical, concatenated
 * random-access stream: the byte view a RAR/7z parser sees, reduced to the
 * random-access surface our header parsers need.
 *
 * NOTE: the concatenation is of the *raw volume bytes*, including each volume's
 * own archive headers. Inner-file data offsets produced by the RAR parser are
 * therefore offsets into this concatenated stream, and may span volume
 * boundaries; callers must read through this view, not the underlying files.
 */
export class VolumeSet implements RandomAccess {
  private accs: (RandomAccess | null)[] = [];
  private starts: number[] = [];
  private total = 0;
  private opened = false;

  constructor(private volumes: Volume[]) {}

  get volumeCount(): number {
    return this.volumes.length;
  }

  /**
   * Absolute [start, end) byte ranges of each volume within the concatenated
   * address space. Used by the RAR parser to locate each volume's signature
   * (every volume begins with its own RAR marker + archive header).
   */
  volumeRanges(): Array<{ start: number; end: number }> {
    if (!this.opened) throw new Error('VolumeSet.open() must be called first');
    return this.starts.map((start, i) => ({
      start,
      end: i + 1 < this.starts.length ? this.starts[i + 1] : this.total,
    }));
  }

  /**
   * Compute cumulative volume offsets. Volumes with a `knownSize` are registered
   * without opening (lazy); all others are opened to obtain their size in
   * PARALLEL (bounded by `concurrency`), since each open costs a first-segment
   * fetch and a truncated inspect can leave hundreds of volumes sizeless. Lazy
   * volumes are opened on the first {@link readAt} call that touches their
   * byte range.
   */
  async open(concurrency = 8): Promise<void> {
    if (this.opened) return;
    const sized: (RandomAccess | null)[] = new Array(this.volumes.length).fill(
      null
    );
    const unknown = this.volumes
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => v.knownSize === undefined);
    if (unknown.length > 0) {
      const startedAt = Date.now();
      const limit = pLimit(Math.max(1, concurrency));
      await Promise.all(
        unknown.map(({ v, i }) =>
          limit(async () => {
            sized[i] = await v.open(v.knownSize);
          })
        )
      );
      logger.debug(
        {
          volumes: this.volumes.length,
          probed: unknown.length,
          concurrency,
          latency: Date.now() - startedAt,
        },
        'probed sizes for volumes without known size'
      );
    }
    let off = 0;
    for (let i = 0; i < this.volumes.length; i++) {
      const v = this.volumes[i];
      this.accs.push(sized[i]);
      this.starts.push(off);
      off += v.knownSize !== undefined ? v.knownSize : sized[i]!.size();
    }
    this.total = off;
    this.opened = true;
  }

  size(): number {
    return this.total;
  }

  async readAt(offset: number, length: number): Promise<Buffer> {
    if (!this.opened) throw new Error('VolumeSet.open() must be called first');
    if (length <= 0 || offset >= this.total) return Buffer.alloc(0);
    const want = Math.min(length, this.total - Math.max(0, offset));
    const dst = Buffer.allocUnsafe(want);
    const written = await this.readAtInto(dst, 0, offset, length);
    return written === dst.length ? dst : dst.subarray(0, written);
  }

  /** {@link readAt} into a caller-owned buffer (see RandomAccess.readAtInto). */
  async readAtInto(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number
  ): Promise<number> {
    if (!this.opened) throw new Error('VolumeSet.open() must be called first');
    if (length <= 0 || offset >= this.total) return 0;
    let written = 0;
    let pos = Math.max(0, offset);
    let remaining = Math.min(length, this.total - pos);
    while (remaining > 0 && pos < this.total) {
      const vi = this.volumeIndexAt(pos);
      if (!this.accs[vi]) {
        this.accs[vi] = await this.volumes[vi].open(this.volumes[vi].knownSize);
      }
      const acc = this.accs[vi]!;
      const localOffset = pos - this.starts[vi];
      const want = Math.min(remaining, acc.size() - localOffset);
      if (want <= 0) break;
      const n = await readAtIntoFrom(
        acc,
        dst,
        dstOffset + written,
        localOffset,
        want
      );
      if (n === 0) break;
      written += n;
      pos += n;
      remaining -= n;
    }
    return written;
  }

  /** Index of the volume containing absolute offset `pos` (binary search). */
  private volumeIndexAt(pos: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
