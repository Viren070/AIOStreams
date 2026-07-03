import { Readable } from 'node:stream';
import { createLogger } from '../../logging/logger.js';
import { MultiProviderPool } from './multi-provider-pool.js';
import { SegmentsStream } from './segments-stream.js';
import { isImplausibleYencFileSize } from './yenc.js';
import { ArticleNotFoundError } from '../nntp/errors.js';
import { CommandPriority, EngineOptions, NzbSegmentRef } from '../types.js';
import type { HoleHooks } from '../holes.js';

const logger = createLogger('usenet/file-stream');

export interface FileSource {
  segments: NzbSegmentRef[];
  /** Best-effort filename. */
  filename?: string;
  /**
   * Pre-known decoded size (e.g. from NZB inspection / a parent archive's
   * member sizes). When set, {@link FileStream.open} skips the size probe
   * entirely; no segment is fetched until the first {@link FileStream.readAt}.
   * Critical for archive inspection, which opens one stream per volume.
   */
  knownSize?: number;
}

/**
 * Common surface for a seekable, byte-range-servable stream. Implemented by both
 * {@link FileStream} (a plain NZB file) and the archive inner-file stream, so
 * the byte-serving route and engine handle either transparently.
 */
export interface SeekableStream {
  readonly filename?: string;
  size(): number;
  open(signal?: AbortSignal): Promise<void>;
  createReadStream(range?: { start?: number; end?: number }): Readable;
  readAt(offset: number, length: number): Promise<Buffer>;
  /**
   * Zero-alloc variant of {@link readAt}: write into `dst` at `dstOffset`,
   * returning bytes written (fewer than `length` only at EOF). Optional; see
   * `RandomAccess.readAtInto` for the contract and rationale.
   */
  readAtInto?(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number
  ): Promise<number>;
}

interface KnownRange {
  /** Half-open decoded byte range [begin, end) of this segment in the file. */
  begin: number;
  end: number;
}

/**
 * Memo of the window-boundary segment on the readAt path: consecutive archive
 * windows (and the CBC IV read just before each window) re-touch the segment
 * straddling the boundary, and the memo spares them an arena/disk round-trip.
 * Holds a copy, never a pin: FileStream has no close/destroy hook, so a pin
 * held here would leak an arena slot.
 */
export interface SegmentMemo {
  owner?: FileStream;
  index: number;
  begin: number;
  end: number;
  len: number;
  /** Lazily allocated, grown only when a larger body appears; reused in place. */
  buf?: Buffer;
}

/**
 * Seekable view over a single NZB file. Resolves byte offsets to segment
 * indices using interpolation search (cheap because probed segments are cached)
 * and serves arbitrary HTTP ranges via {@link SegmentsStream}.
 */
export class FileStream implements SeekableStream {
  private knownRanges = new Map<number, KnownRange>();
  private _size = 0;
  private avgDecodedSize = 0;
  /**
   * Confirmed uniform part size: locked once a segment's measured range sits
   * exactly at `index × partLength` (posters emit fixed-size parts, so this
   * locks on the first non-zero segment touched). Locked seeks compute the
   * target segment arithmetically (no interpolation misprobes, each of which
   * costs a full segment fetch). Every result is still verified by the located
   * segment's own yEnc range before serving.
   */
  private lockedPartSize: number | undefined;
  private opened = false;
  /** Whether {@link _size} is exact (measured/known), not a ratio estimate. */
  private sizeExact = false;
  /** See {@link SegmentMemo}; shared when injected, own slot otherwise. */
  private memo?: SegmentMemo;
  /** Playback hole handling (zero-fill policy owner + persisted holes). */
  private holes?: { hooks: HoleHooks; fileIndex: number };

  constructor(
    private pool: MultiProviderPool,
    private source: FileSource,
    private nzbHash: string,
    private opts: EngineOptions,
    memo?: SegmentMemo,
    holes?: { hooks: HoleHooks; fileIndex: number }
  ) {
    this.memo = memo;
    this.holes = holes;
  }

  get filename(): string | undefined {
    return this.source.filename;
  }

  size(): number {
    return this._size;
  }

  /**
   * Determine the file's decoded size, fetching as little as possible.
   *
   * - With a pre-known size (archive volumes, from NZB inspection): fetch
   *   NOTHING: the header bytes are pulled lazily by the first {@link readAt}.
   * - Otherwise probe only the FIRST segment and trust its yEnc `=ybegin size=`
   *   (the total file size is present in every segment). We deliberately do NOT
   *   fetch the last segment: it would be a second round-trip per file purely to
   *   refine the size, and on a multi-volume archive that doubles the
   *   inspection's article fetches.
   * - Only when the yEnc header lacks a size do we fall back to the last
   *   segment's part end for an exact value.
   */
  async open(signal?: AbortSignal): Promise<void> {
    if (this.opened) return;
    const startedAt = Date.now();
    const segments = this.source.segments;
    if (segments.length === 0) {
      throw new Error('cannot open file stream: no segments');
    }

    if (this.source.knownSize && this.source.knownSize > 0) {
      this._size = this.source.knownSize;
      // Callers only pass exact sizes here (PAR2 descriptors / probed part
      // ends); estimates would corrupt archive offset maps anyway.
      this.sizeExact = true;
      // Float on purpose: flooring biases the estimate low, which makes far
      // seeks overshoot by a segment or two (each a wasted full fetch).
      this.avgDecodedSize = Math.max(1, this._size / segments.length);
      this.opened = true;
      return;
    }

    // Metadata-only: handles released immediately; the scalar fields stay
    // valid after release (see SharedSegment).
    const firstShared = await this.pool.fetchSegmentShared(
      segments[0],
      this.nzbHash,
      signal,
      CommandPriority.High
    );
    const first = firstShared.data;
    firstShared.release();
    const firstBegin = first.byteRange?.[0] ?? 0;
    const firstEnd = first.byteRange?.[1] ?? first.size;
    this.knownRanges.set(0, { begin: firstBegin, end: firstEnd });
    this.avgDecodedSize = firstEnd - firstBegin || first.size || 1;

    const encodedSize = segments.reduce((acc, s) => acc + (s.bytes ?? 0), 0);
    const trustYencSize =
      first.fileSize !== undefined &&
      !isImplausibleYencFileSize(first.fileSize, segments.length, {
        encodedSize,
        firstPartLen: firstEnd - firstBegin,
      });

    if (segments.length === 1) {
      // A single part spans the whole file, so its decoded end IS the exact
      // size; prefer it over a (possibly bogus) `=ybegin size=`.
      this._size = firstEnd || first.fileSize || first.size;
      this.sizeExact = firstEnd > 0;
    } else if (trustYencSize) {
      // yEnc `=ybegin size=` is the exact total file size; no last fetch needed.
      this._size = first.fileSize!;
      this.sizeExact = true;
    } else {
      // No (or implausible) yEnc size: fall back to the last segment's part end
      // (exact) or a ratio estimate.
      const lastIdx = segments.length - 1;
      const lastShared = await this.pool.fetchSegmentShared(
        segments[lastIdx],
        this.nzbHash,
        signal,
        CommandPriority.High
      );
      const last = lastShared.data;
      lastShared.release();
      if (last.byteRange) {
        this.knownRanges.set(lastIdx, {
          begin: last.byteRange[0],
          end: last.byteRange[1],
        });
        this._size = last.byteRange[1];
        this.sizeExact = true;
      } else {
        this._size = this.avgDecodedSize * segments.length;
        this.sizeExact = false;
      }
    }
    this.opened = true;
    logger.debug(
      {
        nzbHash: this.nzbHash,
        filename: this.source.filename,
        size: this._size,
        segments: segments.length,
        latency: Date.now() - startedAt,
      },
      'opened file stream'
    );
  }

  /**
   * Random-access read of `length` bytes at `offset`. Used by archive header
   * parsers (RAR/7z) to cheaply probe arbitrary regions via interpolation seek.
   * Returns fewer bytes than requested only when the range hits EOF.
   *
   * Unlike {@link createReadStream} (which prefetches a parallel window for
   * playback), this fetches **only** the segments overlapping the requested
   * range, sequentially. A small header probe therefore costs ~one segment, not
   * a full read-ahead-window prefetch burst; this is critical for the archive
   * parser, which issues many tiny reads across volume boundaries.
   */
  async readAt(offset: number, length: number): Promise<Buffer> {
    if (!this.opened) {
      throw new Error('FileStream.open() must be called before reading');
    }
    if (length <= 0) return Buffer.alloc(0);
    const start = Math.max(0, offset);
    const end = Math.min(this._size, start + length);
    if (end <= start) return Buffer.alloc(0);
    const dst = Buffer.allocUnsafe(end - start);
    const written = await this.readAtInto(dst, 0, offset, length);
    return written === dst.length ? dst : dst.subarray(0, written);
  }

  /**
   * {@link readAt} into a caller-owned buffer: the archive serve path's hot
   * loop. Copies each contributing segment's slice straight into `dst` with
   * no intermediate allocation.
   */
  async readAtInto(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number
  ): Promise<number> {
    if (!this.opened) {
      throw new Error('FileStream.open() must be called before reading');
    }
    if (length <= 0) return 0;
    const start = Math.max(0, offset);
    const end = Math.min(this._size, start + length);
    if (end <= start) return 0;

    const segments = this.source.segments;
    let written = 0;
    let pos = start;
    let { segmentIndex } = await this.locateSegment(pos);

    while (pos < end && segmentIndex < segments.length) {
      let begin: number;
      let segEnd: number;
      const memo = this.memo;
      if (
        memo &&
        memo.owner === this &&
        memo.index === segmentIndex &&
        memo.buf
      ) {
        ({ begin, end: segEnd } = memo);
        const buf = memo.buf;
        this.knownRanges.set(segmentIndex, { begin, end: segEnd });
        if (begin >= end) break;
        if (segEnd > pos) {
          const within = Math.max(0, pos - begin);
          const take = Math.min(end, segEnd) - pos;
          if (take > 0) {
            buf.copy(dst, dstOffset + written, within, within + take);
            written += take;
            pos += take;
          }
        }
      } else {
        // Everything between the pin and release() is one synchronous block
        // (the arena contract).
        const h = await this.pool.fetchSegmentShared(
          segments[segmentIndex],
          this.nzbHash,
          undefined,
          CommandPriority.High
        );
        try {
          const body = h.data.body;
          begin = h.data.byteRange?.[0] ?? segmentIndex * this.avgDecodedSize;
          segEnd = h.data.byteRange?.[1] ?? begin + body.length;
          this.knownRanges.set(segmentIndex, { begin, end: segEnd });
          // The located segment must contain `pos`; subsequent segments start
          // at their own `begin`. Guard against a gap/overshoot just in case.
          if (begin >= end) break;
          if (segEnd > pos) {
            const within = Math.max(0, pos - begin);
            const take = Math.min(end, segEnd) - pos;
            if (take > 0) {
              body.copy(dst, dstOffset + written, within, within + take);
              written += take;
              pos += take;
            }
          }
          // Memoize only the window-boundary segment (extends past this
          // read's end), as a copy, never a retained pin.
          if (segEnd >= end && body.length > 0) {
            const slot = (this.memo ??= {
              index: -1,
              begin: 0,
              end: 0,
              len: 0,
            });
            if (!slot.buf || slot.buf.length < body.length) {
              slot.buf = Buffer.allocUnsafe(Math.max(1 << 20, body.length));
            }
            body.copy(slot.buf, 0);
            slot.owner = this;
            slot.index = segmentIndex;
            slot.begin = begin;
            slot.end = segEnd;
            slot.len = body.length;
          }
        } finally {
          h.release();
        }
      }
      segmentIndex++;
    }
    return written;
  }

  /**
   * Serve a half-open byte range [start, end). `end` defaults to file size.
   */
  createReadStream(range?: { start?: number; end?: number }): Readable {
    if (!this.opened) {
      throw new Error('FileStream.open() must be called before reading');
    }
    const start = Math.max(0, range?.start ?? 0);
    const end = Math.min(this._size, range?.end ?? this._size);
    const length = Math.max(0, end - start);
    logger.trace(
      { nzbHash: this.nzbHash, start, end, length },
      'serving byte range'
    );

    if (length === 0) {
      return Readable.from([]);
    }

    // Find the segment containing `start`.
    return this.openRangeStream(start, length);
  }

  private openRangeStream(start: number, length: number): Readable {
    // Deferred passthrough: do the (async) interpolation search, then wire up a
    // SegmentsStream. We use a PassThrough-like Readable that begins emitting
    // once the start segment is located.
    const out = new Readable({
      read() {
        /* pushed by the inner stream */
      },
    });

    const requestedAt = Date.now();
    let firstByteSeen = false;
    void this.locateSegment(start)
      .then(({ segmentIndex, segmentStartByte }) => {
        const segments = this.source.segments.slice(segmentIndex);
        // Playback hole handling: local task index → absolute segment index.
        const holes = this.holes;
        const knownAbs = holes?.hooks.knownHoles?.(holes.fileIndex);
        const knownLocal =
          knownAbs && knownAbs.size > 0
            ? new Set(
                [...knownAbs]
                  .map((a) => a - segmentIndex)
                  .filter((l) => l >= 0 && l < segments.length)
              )
            : undefined;
        const inner = new SegmentsStream({
          pool: this.pool,
          segments,
          nzbHash: this.nzbHash,
          sizeForSegment: holes
            ? (local) => this.exactSegmentSize(segmentIndex + local)
            : undefined,
          onHole: holes
            ? (local, bytes) =>
                holes.hooks.onHole({
                  nzbFileIndex: holes.fileIndex,
                  segmentIndex: segmentIndex + local,
                  bytes,
                })
            : undefined,
          knownHoles: knownLocal,
          // The read-ahead window IS the per-stream parallelism: a stream keeps
          // up to `prefetchSegments` segment fetches in flight ahead of the read
          // cursor, and the global download semaphore (Σ provider connections)
          // caps how many of those actually run at once. So a lone stream can use
          // the whole account, while concurrent streams fair-share it via that
          // semaphore; there is no separate per-stream connection cap.
          maxWorkers: this.opts.prefetchSegments,
          // Buffer sized to the same window so completed-but-not-yet-emitted
          // segments can ride out per-segment latency jitter without stalling
          // dispatch.
          bufferSizeBytes: Math.max(
            this.avgDecodedSize * this.opts.prefetchSegments,
            1
          ),
          skipBytes: start - segmentStartByte,
          limitBytes: length,
          priority: CommandPriority.High,
        });
        inner.on('data', (chunk: Buffer) => {
          if (!firstByteSeen) {
            firstByteSeen = true;
            logger.debug(
              {
                nzbHash: this.nzbHash,
                start,
                length,
                latency: Date.now() - requestedAt,
              },
              'range first byte'
            );
          }
          if (!out.push(chunk)) inner.pause();
        });
        inner.on('end', () => out.push(null));
        inner.on('error', (err) => out.destroy(err));
        out.on('resume', () => inner.resume());
        const destroyInner = () => inner.destroy();
        out.on('close', destroyInner);
      })
      .catch((err) =>
        out.destroy(err instanceof Error ? err : new Error(String(err)))
      );

    return out;
  }

  /**
   * Locate the segment containing `targetByte` via interpolation search over
   * decoded byte ranges. Returns the segment index and its decoded start byte.
   */
  private async locateSegment(
    targetByte: number
  ): Promise<{ segmentIndex: number; segmentStartByte: number }> {
    const segments = this.source.segments;
    if (segments.length === 1) {
      return {
        segmentIndex: 0,
        segmentStartByte: this.knownRanges.get(0)?.begin ?? 0,
      };
    }

    let lo = 0;
    let hi = segments.length - 1;

    // Use known endpoints to bound the search.
    const firstRange = this.knownRanges.get(0);
    if (firstRange && targetByte < firstRange.end) {
      return { segmentIndex: 0, segmentStartByte: firstRange.begin };
    }

    let guard = 0;
    while (lo <= hi && guard++ < segments.length + 8) {
      // Interpolate an index guess: exact arithmetic once the uniform part
      // size is locked, the running average estimate otherwise.
      const est = this.lockedPartSize ?? Math.max(1, this.avgDecodedSize);
      let guess = Math.floor(targetByte / est);
      guess = Math.min(hi, Math.max(lo, guess));

      const range = await this.rangeForSegment(guess);
      if (targetByte < range.begin) {
        hi = guess - 1;
        // Refine avg estimate downward.
        this.avgDecodedSize = Math.max(1, range.begin / Math.max(1, guess));
      } else if (targetByte >= range.end) {
        lo = guess + 1;
        this.avgDecodedSize = Math.max(1, range.end / Math.max(1, guess + 1));
      } else {
        return { segmentIndex: guess, segmentStartByte: range.begin };
      }
    }

    // Fallback: linear clamp to the bounded region.
    const idx = Math.min(segments.length - 1, Math.max(0, lo));
    const range = await this.rangeForSegment(idx);
    return { segmentIndex: idx, segmentStartByte: range.begin };
  }

  /**
   * Uniform part length, when proven: the locked grid (a measured non-first
   * range landing exactly on `index × len`), else the first segment's
   * measured length corroborated by an EXACT total size + segment count that
   * only a uniform grid of that length satisfies. yEnc posters emit
   * fixed-size parts, so corroboration failing means "don't trust it".
   */
  private partGridSize(): number | undefined {
    if (this.lockedPartSize !== undefined && this.lockedPartSize > 0) {
      return this.lockedPartSize;
    }
    const first = this.knownRanges.get(0);
    if (!first || first.begin !== 0 || !this.sizeExact) return undefined;
    const len = first.end - first.begin;
    const n = this.source.segments.length;
    if (len <= 0) return undefined;
    return len * (n - 1) < this._size && this._size <= len * n
      ? len
      : undefined;
  }

  /**
   * Exact decoded size of segment `index`, or undefined when it cannot be
   * guaranteed. Zero-fill padding relies on this: a wrong length silently
   * shifts every later byte, which is worse than the stream dying.
   */
  private exactSegmentSize(index: number): number | undefined {
    const known = this.knownRanges.get(index);
    if (known) return known.end - known.begin;
    const part = this.partGridSize();
    if (part === undefined) return undefined;
    const n = this.source.segments.length;
    if (index < 0 || index >= n) return undefined;
    if (index < n - 1) return part;
    if (!this.sizeExact) return undefined;
    const last = this._size - part * (n - 1);
    return last > 0 && last <= part ? last : undefined;
  }

  private async rangeForSegment(index: number): Promise<KnownRange> {
    const cached = this.knownRanges.get(index);
    if (cached) return cached;
    // Metadata-only; released immediately.
    let data: { byteRange?: [number, number]; size: number };
    try {
      const h = await this.pool.fetchSegmentShared(
        this.source.segments[index],
        this.nzbHash,
        undefined,
        CommandPriority.High
      );
      data = h.data;
      h.release();
    } catch (err) {
      // A seek landing ON a hole must not kill the locate: with a proven part
      // grid the segment's range is known without its bytes. The actual read
      // of the hole is then the padding policy's problem, not the seek's.
      if (err instanceof ArticleNotFoundError && err.allProviders) {
        const part = this.partGridSize();
        if (part !== undefined) {
          const begin = index * part;
          const end = this.exactSegmentSize(index)
            ? begin + this.exactSegmentSize(index)!
            : Math.min(begin + part, this._size || begin + part);
          const range = { begin, end };
          this.knownRanges.set(index, range);
          logger.debug(
            { nzbHash: this.nzbHash, index, begin, end },
            'segment missing on all providers; synthesized grid range for seek'
          );
          return range;
        }
      }
      throw err;
    }
    const begin = data.byteRange?.[0] ?? index * this.avgDecodedSize;
    const end = data.byteRange?.[1] ?? begin + data.size;
    const range = { begin, end };
    this.knownRanges.set(index, range);
    // Lock the uniform part size when a measured non-first range lands exactly
    // on the fixed-size grid; a later contradiction unlocks it.
    if (data.byteRange) {
      const len = end - begin;
      if (this.lockedPartSize !== undefined) {
        if (
          index < this.source.segments.length - 1 &&
          begin !== index * this.lockedPartSize
        ) {
          this.lockedPartSize = undefined;
        }
      } else if (index > 0 && len > 0 && begin === index * len) {
        this.lockedPartSize = len;
      }
    }
    return range;
  }
}
