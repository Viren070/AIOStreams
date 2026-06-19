import { Readable } from 'node:stream';
import { createLogger } from '../../logging/logger.js';
import { MultiProviderPool } from './multi-provider-pool.js';
import { SegmentsStream } from './segments-stream.js';
import { isImplausibleYencFileSize } from './yenc.js';
import { CommandPriority, EngineOptions, NzbSegmentRef } from '../types.js';

const logger = createLogger('usenet/file-stream');

export interface FileSource {
  segments: NzbSegmentRef[];
  groups: string[];
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
}

interface KnownRange {
  /** Half-open decoded byte range [begin, end) of this segment in the file. */
  begin: number;
  end: number;
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

  constructor(
    private pool: MultiProviderPool,
    private source: FileSource,
    private nzbHash: string,
    private opts: EngineOptions
  ) {}

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
      // Float on purpose: flooring biases the estimate low, which makes far
      // seeks overshoot by a segment or two (each a wasted full fetch).
      this.avgDecodedSize = Math.max(1, this._size / segments.length);
      this.opened = true;
      return;
    }

    const first = await this.pool.fetchSegment(
      segments[0],
      this.source.groups,
      this.nzbHash,
      signal,
      CommandPriority.High
    );
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
    } else if (trustYencSize) {
      // yEnc `=ybegin size=` is the exact total file size; no last fetch needed.
      this._size = first.fileSize!;
    } else {
      // No (or implausible) yEnc size: fall back to the last segment's part end
      // (exact) or a ratio estimate.
      const lastIdx = segments.length - 1;
      const last = await this.pool.fetchSegment(
        segments[lastIdx],
        this.source.groups,
        this.nzbHash,
        signal,
        CommandPriority.High
      );
      if (last.byteRange) {
        this.knownRanges.set(lastIdx, {
          begin: last.byteRange[0],
          end: last.byteRange[1],
        });
        this._size = last.byteRange[1];
      } else {
        this._size = this.avgDecodedSize * segments.length;
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
   * a `maxConnectionsPerStream`-wide prefetch burst; this is critical for the archive
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

    const segments = this.source.segments;
    const out: Buffer[] = [];
    let pos = start;
    let { segmentIndex } = await this.locateSegment(pos);

    while (pos < end && segmentIndex < segments.length) {
      const data = await this.pool.fetchSegment(
        segments[segmentIndex],
        this.source.groups,
        this.nzbHash,
        undefined,
        CommandPriority.High
      );
      const begin = data.byteRange?.[0] ?? segmentIndex * this.avgDecodedSize;
      const segEnd = data.byteRange?.[1] ?? begin + data.body.length;
      this.knownRanges.set(segmentIndex, { begin, end: segEnd });
      // The located segment must contain `pos`; subsequent segments start at
      // their own `begin`. Guard against a gap/overshoot just in case.
      if (begin >= end) break;
      if (segEnd > pos) {
        const within = Math.max(0, pos - begin);
        const take = Math.min(end, segEnd) - pos;
        if (take > 0) {
          out.push(data.body.subarray(within, within + take));
          pos += take;
        }
      }
      segmentIndex++;
    }
    return Buffer.concat(out);
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
        const inner = new SegmentsStream({
          pool: this.pool,
          segments,
          groups: this.source.groups,
          nzbHash: this.nzbHash,
          maxWorkers: this.opts.maxConnectionsPerStream,
          // In-flight fetches are capped by maxWorkers; the buffer is sized to
          // the (larger) prefetch depth so the stream stays well ahead of the
          // consumer and rides out per-segment latency jitter.
          bufferSizeBytes: Math.max(
            this.avgDecodedSize * this.opts.prefetchSegments,
            this.avgDecodedSize * this.opts.maxConnectionsPerStream,
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

  private async rangeForSegment(index: number): Promise<KnownRange> {
    const cached = this.knownRanges.get(index);
    if (cached) return cached;
    const data = await this.pool.fetchSegment(
      this.source.segments[index],
      this.source.groups,
      this.nzbHash,
      undefined,
      CommandPriority.High
    );
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
