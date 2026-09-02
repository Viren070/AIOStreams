/**
 * Serve-path transform that rewrites zero-filled holes in a Matroska stream
 * into valid EBML, so strict demuxers skip the damage instead of
 * throwing on an invalid vint, and lenient ones skip it without a
 * resync scan.
 *
 * Rewrite rules:
 *  - zeros inside an intact-headered leaf's payload stay, except a hole at a
 *    Block/SimpleBlock payload start gets its first byte set to 0x81 (strict
 *    demuxers read the track vint there);
 *  - from the first element boundary inside the hole, Void headers span each
 *    enclosing master to its end, popping outward;
 *  - a hole outliving its Cluster gets one Segment-level Void to the next
 *    validated cluster start (bounded lookahead).
 *
 * Byte-count preserving in every mode. Original bytes flow through as Void
 * payload (skipped by size), keeping output consistent across overlapping
 * range requests. Every fallback emits the original bytes verbatim; the
 * transform never fails a stream that would otherwise play.
 */
import { Readable, Transform, pipeline } from 'node:stream';
import { createLogger } from '../../logging/logger.js';
import type { HoleByteMap, MatroskaVoidPlan } from '../holes.js';
import {
  BLOCK_ID,
  SEGMENT_ID,
  SIMPLE_BLOCK_ID,
  encodeVoidHeader,
} from './varint.js';
import { MatroskaTracker, validateClusterStart } from './tracker.js';

const logger = createLogger('usenet/ebml-fill');

/** Scan carry: longest cluster-header prefix that can straddle a chunk edge. */
const SCAN_CARRY_BYTES = 27;
/** Bytes of a span that decide a header starting inside the carry. */
const SCAN_HEAD_BYTES = 64;
const CLUSTER_MAGIC = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
const TRACK_VINT_ONE = Buffer.from([0x81]);
const EMPTY = Buffer.alloc(0);
/** Zero-run regeneration chunk size when flushing withheld hole spans. */
const ZERO_CHUNK = 1 << 20;

export interface MatroskaHoleFillOptions {
  /** Absolute target-file offset of the first byte this request serves. */
  startOffset: number;
  fileSize: number;
  /** Session-shared registry of zero-filled byte ranges (target space). */
  holes: HoleByteMap;
  /** Session-shared record of placed Segment-level Voids, for re-requests. */
  plan?: MatroskaVoidPlan;
  /** Next-cluster lookahead cap for the top-level Void (default 16 MiB). */
  maxLookaheadBytes?: number;
  /** For logging only. */
  nzbHash?: string;
}

type Mode =
  | 'sync'
  | 'tracking'
  | 'substitute'
  | 'void-payload'
  | 'cluster-scan'
  | 'passthrough';

interface ScanState {
  /** Copied tail of previously scanned real bytes (may straddle chunks). */
  carry: Buffer;
  /** Absolute offset of carry[0]. */
  carryAbs: number;
}

interface ClusterScanState extends ScanState {
  /** Absolute offset the pending top-level Void starts at. */
  voidStart: number;
  /** Withheld input in order; zero runs stored as lengths (no allocation). */
  parts: Array<{ zeroLen?: number; data?: Buffer }>;
  withheldBytes: number;
}

export class MatroskaHoleFillTransform extends Transform {
  private readonly holes: HoleByteMap;
  private readonly plan?: MatroskaVoidPlan;
  private readonly maxLookahead: number;
  private readonly nzbHash?: string;
  private readonly tracker: MatroskaTracker;

  private mode: Mode = 'sync';
  /** Absolute target-file offset of the next INPUT byte. */
  private cursor: number;
  private inBytes = 0;
  private outBytes = 0;

  private sync: ScanState = { carry: EMPTY, carryAbs: 0 };
  private substitute?: { buf: Buffer; i: number };
  private voidPayloadRemaining = 0;
  /** When set, resync the tracker here once the current Void payload ends. */
  private voidResumeAt?: number;
  private clusterScan?: ClusterScanState;
  private loggedFallbacks = new Set<string>();

  constructor(opts: MatroskaHoleFillOptions) {
    super();
    this.holes = opts.holes;
    this.plan = opts.plan;
    this.maxLookahead = opts.maxLookaheadBytes ?? 16 * (1 << 20);
    this.nzbHash = opts.nzbHash;
    this.cursor = opts.startOffset;
    this.tracker = new MatroskaTracker({ fileSize: opts.fileSize });
  }

  override _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void
  ): void {
    this.inBytes += chunk.length;
    try {
      this.process(chunk);
      cb();
    } catch (err) {
      cb(err instanceof Error ? err : new Error(String(err)));
    }
  }

  override _flush(cb: (err?: Error | null) => void): void {
    if (this.clusterScan) this.flushClusterScanVerbatim('range-eof');
    if (this.inBytes !== this.outBytes) {
      // A drift would silently shift every later offset for the player.
      logger.error(
        { nzbHash: this.nzbHash, in: this.inBytes, out: this.outBytes },
        'hole-fill transform byte count drift'
      );
    }
    cb();
  }

  override _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
    this.clusterScan = undefined;
    cb(err);
  }

  // ---- main loop -----------------------------------------------------------

  private process(chunk: Buffer): void {
    let i = 0;
    while (i < chunk.length) {
      switch (this.mode) {
        case 'passthrough': {
          const span = chunk.subarray(i);
          this.emitRaw(span);
          this.cursor += span.length;
          i = chunk.length;
          break;
        }
        case 'substitute':
          i = this.runSubstitute(chunk, i);
          break;
        case 'void-payload':
          i = this.runVoidPayload(chunk, i);
          break;
        case 'sync':
          i = this.runSync(chunk, i);
          break;
        case 'tracking':
          i = this.runTracking(chunk, i);
          break;
        case 'cluster-scan':
          i = this.runClusterScan(chunk, i);
          break;
      }
    }
  }

  /** End of the current homogeneous span: chunk end or the next hole edge. */
  private spanEnd(chunk: Buffer, i: number): number {
    const boundary = this.holes.nextBoundary(this.cursor);
    if (boundary === undefined) return chunk.length;
    return Math.min(chunk.length, i + (boundary - this.cursor));
  }

  private emitRaw(buf: Buffer): void {
    if (buf.length === 0) return;
    this.push(buf);
    this.outBytes += buf.length;
  }

  /** Emit AND feed the tracker: it follows the (always-valid) output bytes. */
  private emitTracked(buf: Buffer): void {
    if (buf.length === 0) return;
    this.push(buf);
    this.outBytes += buf.length;
    this.tracker.advance(buf);
  }

  private fallback(reason: string): void {
    if (!this.loggedFallbacks.has(reason)) {
      this.loggedFallbacks.add(reason);
      logger.warn(
        { nzbHash: this.nzbHash, at: this.cursor, reason },
        'hole-fill fallback to raw zeros'
      );
    }
    if (this.clusterScan) this.flushClusterScanVerbatim(reason);
    this.mode = 'passthrough';
  }

  // ---- mode: sync ----------------------------------------------------------

  private runSync(chunk: Buffer, i: number): number {
    // Replay a recorded Void when this request begins exactly at its start.
    const plannedEnd = this.plan?.endAt(this.cursor);
    if (plannedEnd !== undefined && plannedEnd - this.cursor >= 2) {
      const spanBytes = plannedEnd - this.cursor;
      this.substitute = { buf: encodeVoidHeader(spanBytes), i: 0 };
      this.voidPayloadRemaining = spanBytes - this.substitute.buf.length;
      this.voidResumeAt = plannedEnd;
      this.mode = 'substitute';
      logger.info(
        {
          nzbHash: this.nzbHash,
          at: this.cursor,
          span: spanBytes,
          resumeAt: plannedEnd,
        },
        'hole-fill replayed planned void'
      );
      return i;
    }
    const end = this.spanEnd(chunk, i);
    const span = chunk.subarray(i, end);
    const inHole = this.holes.runAt(this.cursor) !== undefined;
    this.emitRaw(span);
    if (inHole) {
      // Zeros cannot contain a cluster header; drop any straddling carry.
      this.sync.carry = EMPTY;
    } else {
      const found = this.scanSpan(this.sync, span, this.cursor);
      if (found !== undefined) {
        // Catch the tracker up over the tail already emitted past `found`.
        const work =
          this.sync.carry.length > 0
            ? Buffer.concat([this.sync.carry, span])
            : span;
        const workAbs =
          this.sync.carry.length > 0 ? this.sync.carryAbs : this.cursor;
        this.tracker.resyncAt(found);
        this.tracker.advance(work.subarray(found - workAbs));
        logger.debug(
          { nzbHash: this.nzbHash, at: found },
          'hole-fill synced at cluster'
        );
        this.mode = 'tracking';
      }
    }
    this.cursor += span.length;
    return end;
  }

  // ---- mode: tracking ------------------------------------------------------

  private runTracking(chunk: Buffer, i: number): number {
    const end = this.spanEnd(chunk, i);
    const hole = this.holes.runAt(this.cursor);
    if (!hole) {
      const span = chunk.subarray(i, end);
      this.emitTracked(span);
      this.cursor += span.length;
      if (this.tracker.desynced) this.fallback('desynced');
      return end;
    }
    const p = this.tracker.positionAt();
    switch (p.kind) {
      case 'in-leaf': {
        if (
          this.cursor === p.payloadStart &&
          (p.id === SIMPLE_BLOCK_ID || p.id === BLOCK_ID)
        ) {
          // Strict demuxers read the block's track vint here; 0x00 is fatal.
          this.emitTracked(TRACK_VINT_ONE);
          this.cursor += 1;
          return i + 1;
        }
        // Hole bytes inside the payload pass through; the leaf end re-enters
        // as a boundary next iteration.
        const take = Math.min(end - i, p.end - this.cursor);
        this.emitTracked(chunk.subarray(i, i + take));
        this.cursor += take;
        return i + take;
      }
      case 'boundary':
        this.voidStep();
        return i;
      default:
        this.fallback(p.kind);
        return i;
    }
  }

  /**
   * Decide how to fill from an element boundary inside a hole: Void to the
   * innermost master's end, or hand off to the top-level cluster scan.
   * Consumes no input.
   */
  private voidStep(): void {
    for (;;) {
      const f = this.tracker.innermost();
      // Voiding to the Segment end would swallow the rest of the file; a hole
      // outliving its Cluster goes to the next-cluster scan instead.
      if (!f || f.id === SEGMENT_ID) {
        this.clusterScan = {
          voidStart: this.cursor,
          parts: [],
          withheldBytes: 0,
          carry: EMPTY,
          carryAbs: 0,
        };
        this.mode = 'cluster-scan';
        return;
      }
      if (f.end === undefined) {
        this.fallback('unknown-size-master');
        return;
      }
      const span = f.end - this.cursor;
      if (span <= 0) {
        this.tracker.popInnermost();
        continue;
      }
      if (span === 1) {
        // A 1-byte gap cannot hold a Void header.
        this.fallback('span-1');
        return;
      }
      const header = encodeVoidHeader(span);
      logger.info(
        {
          nzbHash: this.nzbHash,
          at: this.cursor,
          span,
          master: f.id.toString(16),
        },
        'hole rewritten as in-master void'
      );
      this.substitute = { buf: header, i: 0 };
      this.voidPayloadRemaining = span - header.length;
      this.mode = 'substitute';
      return;
    }
  }

  // ---- modes: substitute / void-payload ------------------------------------

  /** Emit substitute bytes (a Void header) in place of input bytes, 1:1. */
  private runSubstitute(chunk: Buffer, i: number): number {
    const sub = this.substitute!;
    const take = Math.min(sub.buf.length - sub.i, chunk.length - i);
    this.emitTracked(sub.buf.subarray(sub.i, sub.i + take));
    sub.i += take;
    this.cursor += take;
    if (sub.i === sub.buf.length) {
      this.substitute = undefined;
      if (this.voidPayloadRemaining > 0) {
        this.mode = 'void-payload';
      } else {
        if (this.voidResumeAt !== undefined) {
          this.tracker.resyncAt(this.voidResumeAt);
          this.voidResumeAt = undefined;
        }
        this.mode = 'tracking';
      }
    }
    return i + take;
  }

  /** Original bytes ride through as ignored Void payload. */
  private runVoidPayload(chunk: Buffer, i: number): number {
    const take = Math.min(this.voidPayloadRemaining, chunk.length - i);
    this.emitTracked(chunk.subarray(i, i + take));
    this.voidPayloadRemaining -= take;
    this.cursor += take;
    if (this.voidPayloadRemaining === 0) {
      // A replayed Void ends at a cluster the unsynced tracker must resync on;
      // an in-master Void leaves the tracker already synced.
      if (this.voidResumeAt !== undefined) {
        this.tracker.resyncAt(this.voidResumeAt);
        this.voidResumeAt = undefined;
      }
      this.mode = 'tracking';
    }
    return i + take;
  }

  // ---- mode: cluster-scan --------------------------------------------------

  private runClusterScan(chunk: Buffer, i: number): number {
    const cs = this.clusterScan!;
    // Cap the scan by distance, not per-chunk arrivals, so the outcome does
    // not depend on chunk sizes.
    const capLeft = this.maxLookahead - cs.withheldBytes;
    if (capLeft <= 0) {
      this.fallback('lookahead-cap');
      return i;
    }
    const end = Math.min(this.spanEnd(chunk, i), i + capLeft);
    const span = chunk.subarray(i, end);
    const inHole = this.holes.runAt(this.cursor) !== undefined;
    if (inHole) {
      cs.parts.push({ zeroLen: span.length });
      cs.carry = EMPTY;
      this.cursor += span.length;
    } else {
      // Copied: withheld bytes outlive the upstream pooled chunk.
      cs.parts.push({ data: Buffer.from(span) });
      const found = this.scanSpan(cs, span, this.cursor);
      this.cursor += span.length;
      if (found !== undefined && found >= cs.voidStart + 2) {
        this.flushClusterScan(found);
        return end;
      }
    }
    cs.withheldBytes += span.length;
    if (cs.withheldBytes >= this.maxLookahead) {
      this.fallback('lookahead-cap');
    }
    return end;
  }

  /** Emit the top-level Void header + all withheld bytes as its payload. */
  private flushClusterScan(clusterStart: number): void {
    const cs = this.clusterScan!;
    this.clusterScan = undefined;
    const span = clusterStart - cs.voidStart;
    const header = encodeVoidHeader(span);
    this.plan?.record(cs.voidStart, clusterStart);
    logger.info(
      {
        nzbHash: this.nzbHash,
        at: cs.voidStart,
        span,
        resumeAt: clusterStart,
      },
      'hole rewritten as top-level void to next cluster'
    );
    this.emitTracked(header);
    this.emitWithheld(cs.parts, header.length);
    this.mode = 'tracking';
  }

  /** Abandon the scan: emit every withheld byte exactly as it arrived. */
  private flushClusterScanVerbatim(reason: string): void {
    const cs = this.clusterScan;
    if (!cs) return;
    this.clusterScan = undefined;
    logger.warn(
      {
        nzbHash: this.nzbHash,
        at: cs.voidStart,
        withheld: cs.withheldBytes,
        reason,
      },
      'top-level void abandoned; emitting raw bytes'
    );
    this.emitWithheldRaw(cs.parts, 0);
    this.mode = 'passthrough';
  }

  private emitWithheld(
    parts: Array<{ zeroLen?: number; data?: Buffer }>,
    skip: number
  ): void {
    for (const part of parts) {
      const len = part.zeroLen ?? part.data!.length;
      if (skip >= len) {
        skip -= len;
        continue;
      }
      if (part.data) {
        this.emitTracked(part.data.subarray(skip));
      } else {
        let remaining = len - skip;
        while (remaining > 0) {
          const n = Math.min(remaining, ZERO_CHUNK);
          this.emitTracked(Buffer.alloc(n));
          remaining -= n;
        }
      }
      skip = 0;
    }
  }

  private emitWithheldRaw(
    parts: Array<{ zeroLen?: number; data?: Buffer }>,
    skip: number
  ): void {
    for (const part of parts) {
      const len = part.zeroLen ?? part.data!.length;
      if (skip >= len) {
        skip -= len;
        continue;
      }
      if (part.data) {
        this.emitRaw(part.data.subarray(skip));
      } else {
        let remaining = len - skip;
        while (remaining > 0) {
          const n = Math.min(remaining, ZERO_CHUNK);
          this.emitRaw(Buffer.alloc(n));
          remaining -= n;
        }
      }
      skip = 0;
    }
  }

  // ---- cluster-start scanning ----------------------------------------------

  /**
   * Absolute offset of the next validated cluster start in carry+span, or
   * undefined. Keeps a copied tail in `state.carry` for headers straddling
   * chunk edges.
   */
  private scanSpan(
    state: ScanState,
    span: Buffer,
    spanAbs: number
  ): number | undefined {
    const carryLen = state.carry.length;
    const passes: Array<[work: Buffer, workAbs: number, limit: number]> =
      carryLen > 0
        ? [
            [
              Buffer.concat([state.carry, span.subarray(0, SCAN_HEAD_BYTES)]),
              state.carryAbs,
              carryLen,
            ],
            [span, spanAbs, span.length],
          ]
        : [[span, spanAbs, span.length]];
    for (const [work, workAbs, limit] of passes) {
      let from = 0;
      for (;;) {
        const c = work.indexOf(CLUSTER_MAGIC, from);
        if (c < 0 || c >= limit) break;
        const v = validateClusterStart(work, c);
        if ('ok' in v && v.ok) return workAbs + c;
        if ('needMore' in v) {
          // Revisit this candidate when more bytes arrive.
          const abs = workAbs + c;
          state.carry =
            abs < spanAbs
              ? Buffer.concat([
                  state.carry.subarray(abs - state.carryAbs),
                  span,
                ])
              : Buffer.from(span.subarray(abs - spanAbs));
          state.carryAbs = abs;
          return undefined;
        }
        from = c + 1;
      }
    }
    // A span shorter than the carry window keeps the old carry's tail too.
    const src =
      carryLen > 0 && span.length < SCAN_CARRY_BYTES
        ? Buffer.concat([state.carry, span])
        : span;
    const srcAbs = src === span ? spanAbs : state.carryAbs;
    const tail = Math.min(SCAN_CARRY_BYTES, src.length);
    state.carry = Buffer.from(src.subarray(src.length - tail));
    state.carryAbs = srcAbs + src.length - tail;
    return undefined;
  }
}

/**
 * Wrap a raw serve stream with the Matroska hole-fill transform. `pipeline`
 * propagates teardown both ways and surfaces upstream errors (including the
 * idle reaper's) on the returned stream.
 */
export function wrapMatroskaHoleFill(
  raw: Readable,
  opts: MatroskaHoleFillOptions
): Readable {
  const transform = new MatroskaHoleFillTransform(opts);
  pipeline(raw, transform, () => {});
  return transform;
}
