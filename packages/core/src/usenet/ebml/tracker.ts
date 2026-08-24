/**
 * Incremental, header-only Matroska structure tracker: consumes a file's real
 * decoded bytes in order and maintains the master-element stack, so the
 * hole-fill transform can ask what encloses an offset and where it ends
 * without a full parse. Leaf payloads are skipped by size.
 */
import {
  CLUSTER_ID,
  CRC32_ID,
  DESCEND_MASTERS,
  SEGMENT_ID,
  TIMESTAMP_ID,
  readElementId,
  readElementSize,
  vintLen,
} from './varint.js';

/** An open master element on the stack. `end === undefined` => unknown size. */
export interface MasterFrame {
  id: number;
  /** Absolute exclusive end offset, or undefined for unknown-size masters. */
  end: number | undefined;
}

export type HolePosition =
  | { kind: 'boundary' }
  | { kind: 'in-header' }
  | { kind: 'in-leaf'; id: number; payloadStart: number; end: number }
  | { kind: 'unknown-size-master' }
  | { kind: 'desynced' };

/** Max bytes an element header (ID vint + size vint) can occupy: 4 + 8. */
const MAX_HEADER_BYTES = 12;

export class MatroskaTracker {
  private readonly fileSize: number;
  /** Absolute parse cursor: next byte the tracker expects to read. */
  private _pos = 0;
  private _synced: boolean;
  private _desynced = false;
  private stack: MasterFrame[] = [];
  /** Set while the cursor sits inside a leaf's payload (skipped by size). */
  private leaf: { id: number; payloadStart: number; end: number } | undefined;
  /** Partial element header carried across a chunk boundary (copied). */
  private carry: Buffer = Buffer.alloc(0);

  constructor(opts: { fileSize: number }) {
    this.fileSize = opts.fileSize;
    // Unsynced until the transform locks on at a validated cluster.
    this._synced = false;
  }

  get pos(): number {
    return this._pos;
  }

  get synced(): boolean {
    return this._synced && !this._desynced;
  }

  get desynced(): boolean {
    return this._desynced;
  }

  /**
   * Feed real bytes beginning at `this._pos`. An invalid vint flips a sticky
   * desync, after which the transform falls back to passthrough.
   */
  advance(buf: Buffer): void {
    if (this._desynced || !this._synced || buf.length === 0) {
      this._pos += buf.length;
      return;
    }
    // `_pos` already counted the carried bytes, so map back through absBase.
    const carriedLen = this.carry.length;
    let work = carriedLen > 0 ? Buffer.concat([this.carry, buf]) : buf;
    this.carry = Buffer.alloc(0);
    const absBase = this._pos - carriedLen;
    let i = 0;

    while (i < work.length) {
      if (this.leaf) {
        const remaining = this.leaf.end - (absBase + i);
        if (remaining > work.length - i) {
          i = work.length;
          break;
        }
        i += remaining;
        this.leaf = undefined;
        this.popExhausted(absBase + i);
        continue;
      }
      this.popExhausted(absBase + i);
      // Carry a partial header to the next chunk.
      if (work.length - i < MAX_HEADER_BYTES && !this.headerFits(work, i)) {
        this.carry = Buffer.from(work.subarray(i));
        i = work.length;
        break;
      }
      const idr = readElementId(work, i);
      if (!idr) {
        this._desynced = true;
        break;
      }
      const szr = readElementSize(work, i + idr.len);
      if (!szr) {
        this._desynced = true;
        break;
      }
      const headerLen = idr.len + szr.len;
      const payloadStart = absBase + i + headerLen;
      if (szr.unknown) {
        // An unknown-size Segment spans to EOF; an unknown-size master leaves
        // its end open (a hole under it forces a fallback).
        if (idr.id === SEGMENT_ID) {
          this.stack.push({ id: idr.id, end: this.fileSize });
          i += headerLen;
          continue;
        }
        if (DESCEND_MASTERS.has(idr.id)) {
          this.stack.push({ id: idr.id, end: undefined });
          i += headerLen;
          continue;
        }
        this._desynced = true;
        break;
      }
      const end = payloadStart + szr.size;
      if (DESCEND_MASTERS.has(idr.id)) {
        // A new Cluster closes an open unknown-size one.
        const top = this.stack[this.stack.length - 1];
        if (idr.id === CLUSTER_ID && top?.id === CLUSTER_ID && !top.end) {
          this.stack.pop();
        }
        this.stack.push({ id: idr.id, end });
        i += headerLen;
        continue;
      }
      i += headerLen;
      this.leaf = { id: idr.id, payloadStart, end };
    }

    this._pos = absBase + i;
  }

  /** True when a full element header is available at `work[i]`. */
  private headerFits(work: Buffer, i: number): boolean {
    const idLen = vintLen(work[i], 4);
    if (idLen < 0 || i + idLen >= work.length) return false;
    const szLen = vintLen(work[i + idLen], 8);
    if (szLen < 0) return false;
    return i + idLen + szLen <= work.length;
  }

  /** Pop masters whose declared end is at/behind `abs`. */
  private popExhausted(abs: number): void {
    while (
      this.stack.length > 0 &&
      this.stack[this.stack.length - 1].end !== undefined &&
      abs >= (this.stack[this.stack.length - 1].end as number)
    ) {
      this.stack.pop();
    }
  }

  /**
   * Classify the byte at the current cursor (the transform calls this the
   * moment it reaches a registered hole start).
   */
  positionAt(): HolePosition {
    if (this._desynced || !this._synced) return { kind: 'desynced' };
    if (this.carry.length > 0) return { kind: 'in-header' };
    this.popExhausted(this._pos);
    const top = this.stack[this.stack.length - 1];
    if (top && top.end === undefined) return { kind: 'unknown-size-master' };
    if (this.leaf) {
      return {
        kind: 'in-leaf',
        id: this.leaf.id,
        payloadStart: this.leaf.payloadStart,
        end: this.leaf.end,
      };
    }
    return { kind: 'boundary' };
  }

  /** Innermost enclosing master with `pos < end`, popping exhausted frames. */
  innermost(): MasterFrame | undefined {
    this.popExhausted(this._pos);
    return this.stack[this.stack.length - 1];
  }

  /** Drop the innermost frame (after a Void spans it to its end). */
  popInnermost(): void {
    this.stack.pop();
  }

  /**
   * Reset to a clean tracking state at a validated cluster start, under a
   * single EOF-spanning Segment.
   */
  resyncAt(offset: number): void {
    this._pos = offset;
    this._synced = true;
    this._desynced = false;
    this.leaf = undefined;
    this.carry = Buffer.alloc(0);
    this.stack = [{ id: SEGMENT_ID, end: this.fileSize }];
  }
}

export type ClusterValidation =
  | { ok: true; payloadStart: number; payloadEnd: number }
  | { ok: false }
  | { needMore: true };

/**
 * Validate a candidate Cluster start: the Cluster ID, a sane known size, and a
 * first child of Timestamp, or a CRC-32 (which some muxers emit) then
 * Timestamp. `needMore` means too close to the buffer end to decide yet.
 */
export function validateClusterStart(
  buf: Buffer,
  pos: number
): ClusterValidation {
  const idr = readElementId(buf, pos);
  if (!idr) return { needMore: true };
  if (idr.id !== CLUSTER_ID) return { ok: false };
  const szr = readElementSize(buf, pos + idr.len);
  if (!szr) return { needMore: true };
  if (szr.unknown || szr.size <= 0 || szr.size > 512 * (1 << 20)) {
    return { ok: false };
  }
  const payloadStart = pos + idr.len + szr.len;
  // First child: Timestamp, or CRC-32 then Timestamp.
  const first = readElementId(buf, payloadStart);
  if (!first) return { needMore: true };
  if (first.id === TIMESTAMP_ID) {
    return {
      ok: true,
      payloadStart,
      payloadEnd: payloadStart + szr.size,
    };
  }
  if (first.id === CRC32_ID) {
    const crcSize = readElementSize(buf, payloadStart + first.len);
    if (!crcSize) return { needMore: true };
    const afterCrc = payloadStart + first.len + crcSize.len + crcSize.size;
    const second = readElementId(buf, afterCrc);
    if (!second) return { needMore: true };
    if (second.id === TIMESTAMP_ID) {
      return { ok: true, payloadStart, payloadEnd: payloadStart + szr.size };
    }
    return { ok: false };
  }
  return { ok: false };
}
