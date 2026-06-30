/**
 * Low-level NNTP protocol helpers: status-line parsing and a streaming reader
 * that splits a socket byte stream into either single status lines or
 * multiline responses terminated by the `\r\n.\r\n` dot sequence.
 *
 * Dot-unstuffing of the article body is intentionally NOT done here for BODY
 * responses: the raw (dot-stuffed) bytes are handed to the yEnc decoder, which
 * performs unstuffing itself. This helper only detects the terminating sequence.
 */

export interface NntpStatusLine {
  code: number;
  message: string;
}

export const CRLF = Buffer.from('\r\n');
/** Multiline terminator: CRLF '.' CRLF */
export const DOT_TERMINATOR = Buffer.from('\r\n.\r\n');

export function parseStatusLine(line: string): NntpStatusLine {
  const trimmed = line.replace(/\r?\n$/, '');
  const m = trimmed.match(/^(\d{3})(?:\s+(.*))?$/);
  if (!m) {
    return { code: 0, message: trimmed };
  }
  return { code: Number.parseInt(m[1], 10), message: m[2] ?? '' };
}

/** First digit class of a status code (1xx..5xx). */
export function statusClass(code: number): number {
  return Math.floor(code / 100);
}

export function isErrorStatus(code: number): boolean {
  return statusClass(code) >= 4;
}

const LF = 0x0a;
const CR = 0x0d;
/** Cap on an accumulated status line; longer without a CRLF is a protocol desync. */
const LINE_CAP = 4096;
const TERM_LEN = DOT_TERMINATOR.length; // 5
const TERM_OVERLAP = TERM_LEN - 1; // 4: max bytes a terminator can straddle a read boundary

/** One step from {@link NntpOnreadParser.feedLine}. */
export type LineStep =
  | { status: 'line'; text: string; off: number }
  | { status: 'need-more'; off: number }
  | { status: 'desync' };

/** One step from {@link NntpOnreadParser.feedBody}. */
export interface BodyStep {
  /** True once the `\r\n.\r\n` terminator has been consumed. */
  ended: boolean;
  /** New offset into the socket buffer (past the terminator when `ended`). */
  off: number;
}

/**
 * Streaming NNTP response parser for the `onread` read path: it is fed the
 * socket's reused read buffer `(nread, buf)` directly and consumes it
 * synchronously within the read callback, so no per-read Buffer is allocated. It
 * owns small, once-allocated scratch (a line carry plus a terminator-overlap
 * tail) and never retains a view of the socket buffer across reads.
 *
 * Two body modes:
 *  - buffered (`beginBufferedBody`): the hot `BODY` path. Each read is copied
 *    straight into the caller's pooled destination (`dest`) and the terminator
 *    is found by scanning `dest` itself with a {@link TERM_OVERLAP}-byte
 *    back-scan, so the carry is just `dest`'s own tail: one copy, a contiguous
 *    scan, and a rewind of `bodyLen` if the terminator straddled the prior read.
 *  - streaming (`beginStreamingBody`): the low-volume probe path. Confirmed body
 *    bytes are emitted to a consumer as they arrive while the last
 *    {@link TERM_OVERLAP} bytes are held back (they might begin the terminator).
 */
export class NntpOnreadParser {
  // --- line carry ---
  private lineBuf = Buffer.allocUnsafe(LINE_CAP);
  private lineLen = 0;

  // --- buffered body ---
  /** Caller-owned destination for the current buffered body (a pooled ring slot). */
  dest: Buffer | null = null;
  /** Confirmed decoded-into-`dest` length; on `ended` this is the body length. */
  bodyLen = 0;
  /** `dest` scan watermark: bytes already searched for the terminator. */
  private scanned = 0;

  // --- streaming body ---
  private consumer: ((chunk: Buffer) => void) | null = null;
  /** Reused scratch for the streaming-merge scan (sized lazily to the read buffer). */
  private streamScratch: Buffer | null = null;
  /** Held-back tail bytes that might begin the terminator (streaming mode). */
  private tail = Buffer.allocUnsafe(TERM_OVERLAP);
  private tailLen = 0;
  /** Total raw body bytes streamed for the current request. */
  streamed = 0;

  /** Arm for a single CRLF-terminated line (greeting / STAT / DATE / GROUP / AUTH). */
  beginLine(): void {
    this.lineLen = 0;
  }

  /** Arm for a buffered BODY payload copied into `dest`. */
  beginBufferedBody(dest: Buffer): void {
    this.dest = dest;
    this.consumer = null;
    this.bodyLen = 0;
    this.scanned = 0;
  }

  /** Replace the destination (used by the connection's oversize-grow path). */
  setDest(dest: Buffer): void {
    this.dest = dest;
  }

  /** Arm for a streamed BODY payload (probe path); body bytes go to `consumer`. */
  beginStreamingBody(consumer: (chunk: Buffer) => void): void {
    this.consumer = consumer;
    this.dest = null;
    this.tailLen = 0;
    this.streamed = 0;
  }

  /**
   * Consume one CRLF-terminated line from `buf[off..nread]`, accumulating across
   * reads. The returned line excludes the trailing `\r\n`; a bare `\n` (not
   * preceded by `\r`) is treated as line content.
   */
  feedLine(buf: Buffer, off: number, nread: number): LineStep {
    let p = off;
    for (;;) {
      let lf = buf.indexOf(LF, p);
      if (lf >= nread) lf = -1; // ignore stale bytes past this read
      const end = lf < 0 ? nread : lf + 1;
      const add = end - p;
      if (this.lineLen + add > LINE_CAP) return { status: 'desync' };
      buf.copy(this.lineBuf, this.lineLen, p, end);
      this.lineLen += add;
      if (lf < 0) return { status: 'need-more', off: nread };
      // A real line ends in CRLF; a bare LF is content, so keep scanning.
      if (this.lineLen >= 2 && this.lineBuf[this.lineLen - 2] === CR) {
        const text = this.lineBuf.toString('latin1', 0, this.lineLen - 2);
        this.lineLen = 0;
        return { status: 'line', text, off: end };
      }
      p = end;
    }
  }

  /**
   * Consume body bytes from `buf[off..nread]` for the current (buffered or
   * streaming) request. Returns whether the terminator was reached and the new
   * `off`. In buffered mode the body lives in `dest[0..bodyLen]`; in streaming
   * mode confirmed bytes have been handed to the consumer and `streamed` updated.
   */
  feedBody(buf: Buffer, off: number, nread: number): BodyStep {
    return this.dest !== null
      ? this.feedBuffered(buf, off, nread)
      : this.feedStreaming(buf, off, nread);
  }

  /** Buffered hot path: copy-into-`dest`, scan `dest` with overlap, rewind on hit. */
  private feedBuffered(buf: Buffer, off: number, nread: number): BodyStep {
    let dest = this.dest!;
    const win = nread - off;
    const start = this.bodyLen; // dest offset where this read lands
    if (start + win > dest.length) {
      // Oversize article: grow geometrically, copy what we have, keep going.
      const grown = Buffer.allocUnsafe(Math.max(dest.length * 2, start + win));
      dest.copy(grown, 0, 0, start);
      dest = grown;
      this.dest = grown;
    }
    buf.copy(dest, start, off, nread);
    const writtenEnd = start + win;
    // Back up the scan by TERM_OVERLAP so a terminator that straddled the prior
    // read's tail is still found; never re-scan confirmed bytes twice otherwise.
    // The subarray BOUNDS the scan to written bytes (the slot's tail is stale).
    const from = Math.max(0, this.scanned, start - TERM_OVERLAP);
    const hit = dest.subarray(0, writtenEnd).indexOf(DOT_TERMINATOR, from);
    if (hit >= 0) {
      const windowConsumed = hit + TERM_LEN - start; // terminator end, in this read's bytes
      this.bodyLen = hit; // body ends at the terminator (rewinds if it straddled)
      return { ended: true, off: off + windowConsumed };
    }
    this.bodyLen = writtenEnd;
    this.scanned = Math.max(0, writtenEnd - TERM_OVERLAP);
    return { ended: false, off: nread };
  }

  /** Streaming probe path: merge tail+window in scratch, emit all but the held tail. */
  private feedStreaming(buf: Buffer, off: number, nread: number): BodyStep {
    const win = nread - off;
    const need = this.tailLen + win;
    if (!this.streamScratch || this.streamScratch.length < need) {
      this.streamScratch = Buffer.allocUnsafe(Math.max(need, 64 * 1024));
    }
    const s = this.streamScratch;
    this.tail.copy(s, 0, 0, this.tailLen);
    buf.copy(s, this.tailLen, off, nread);
    const total = this.tailLen + win;
    const hit = s.subarray(0, total).indexOf(DOT_TERMINATOR); // bounded: scratch tail is stale
    if (hit >= 0) {
      if (hit > 0) {
        this.consumer!(s.subarray(0, hit));
        this.streamed += hit;
      }
      const windowConsumed = hit + TERM_LEN - this.tailLen;
      this.tailLen = 0;
      return { ended: true, off: off + windowConsumed };
    }
    const keep = Math.min(TERM_OVERLAP, total);
    const emitLen = total - keep;
    if (emitLen > 0) {
      this.consumer!(s.subarray(0, emitLen));
      this.streamed += emitLen;
    }
    s.copy(this.tail, 0, emitLen, total);
    this.tailLen = keep;
    return { ended: false, off: nread };
  }
}
