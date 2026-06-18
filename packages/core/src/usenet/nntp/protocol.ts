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

/**
 * Incrementally accumulates socket bytes and yields complete protocol units.
 *
 * Usage: after issuing a command, call {@link takeLine} (single line) or begin
 * a multiline read via {@link takeMultiline}. The reader is fed via
 * {@link push} from the socket's 'data' handler and resolves the appropriate
 * pending request.
 *
 * For BODY/ARTICLE the multiline payload is exposed as raw bytes (including
 * the dot-stuffing) up to but not including the terminating `\r\n.\r\n`.
 *
 * Bytes are kept as the **list of socket chunks** rather than one growing
 * buffer: re-`concat`ing the accumulator on every chunk would cost O(n^2)
 * memcpy as a large multi-chunk article arrives. The chunk list does ONE
 * join when a unit completes; terminator scans only touch the newly arrived
 * region (plus a needle-sized overlap for matches that straddle chunks).
 */
export class NntpResponseReader {
  private chunks: Buffer[] = [];
  private buffered = 0;

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
  }

  reset(): void {
    this.chunks = [];
    this.buffered = 0;
  }

  /** Number of bytes currently buffered (diagnostics/back-pressure). */
  get bufferedBytes(): number {
    return this.buffered;
  }

  /**
   * Try to read a single CRLF-terminated status line from the buffer.
   * Returns null if a full line is not yet available.
   */
  takeLine(): string | null {
    const idx = this.indexOfFrom(CRLF, 0);
    if (idx === -1) return null;
    const line = this.consume(idx).toString('latin1');
    this.discard(CRLF.length);
    return line;
  }

  /**
   * Try to read a complete multiline body terminated by `\r\n.\r\n`.
   * Returns the raw payload bytes (still dot-stuffed) WITHOUT the terminator,
   * or null if the terminator has not been seen yet.
   *
   * `searchFrom` lets callers avoid rescanning already-scanned bytes; pass the
   * value returned by {@link scanWatermark} on the next call.
   */
  takeMultiline(searchFrom = 0): { body: Buffer; scanned: number } | null {
    // The terminator can straddle previously-buffered bytes, so back up by
    // (terminator length - 1) to catch a split sequence.
    const start = Math.max(0, searchFrom - (DOT_TERMINATOR.length - 1));
    const idx = this.indexOfFrom(DOT_TERMINATOR, start);
    if (idx === -1) {
      return null;
    }
    const body = this.consume(idx);
    this.discard(DOT_TERMINATOR.length);
    return { body, scanned: 0 };
  }

  /** Current scan watermark for the next takeMultiline call. */
  scanWatermark(): number {
    return this.buffered;
  }

  /**
   * Streaming variant of {@link takeMultiline}: hand the raw (dot-stuffed)
   * payload to `consume` as it arrives instead of accumulating it, retaining
   * only a terminator-overlap tail in the buffer. Returns true once the
   * terminator was consumed, false while the body is still incomplete. The
   * buffer therefore stays a few bytes deep regardless of article size.
   */
  takeMultilineStreaming(consume: (chunk: Buffer) => void): boolean {
    const idx = this.indexOfFrom(DOT_TERMINATOR, 0);
    if (idx === -1) {
      const keep = DOT_TERMINATOR.length - 1;
      if (this.buffered > keep) {
        consume(this.consume(this.buffered - keep));
      }
      return false;
    }
    const tail = this.consume(idx);
    this.discard(DOT_TERMINATOR.length);
    if (tail.length > 0) consume(tail);
    return true;
  }

  /**
   * Absolute index of the first occurrence of `needle` starting at or after
   * absolute offset `from`, searching across chunk boundaries; -1 when absent.
   */
  private indexOfFrom(needle: Buffer, from: number): number {
    const n = needle.length;
    let base = 0; // absolute offset of chunks[i][0]
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const end = base + chunk.length;
      // A match starts at some abs >= from; any chunk ending at/before `from`
      // cannot contain a match start.
      if (end <= from) {
        base = end;
        continue;
      }
      const localFrom = Math.max(0, from - base);
      // Match fully inside this chunk.
      const hit = chunk.indexOf(needle, localFrom);
      if (hit !== -1) return base + hit;
      // Match starting in this chunk's last (n-1) bytes and continuing into
      // the following chunk(s): search a small joined boundary window.
      if (n > 1 && i + 1 < this.chunks.length) {
        const winStart = Math.max(localFrom, chunk.length - (n - 1));
        if (winStart < chunk.length) {
          const window = this.boundaryWindow(
            i,
            winStart,
            chunk.length - winStart + (n - 1)
          );
          const winHit = window.indexOf(needle);
          if (winHit !== -1) return base + winStart + winHit;
        }
      }
      base = end;
    }
    return -1;
  }

  /**
   * Join up to `maxLen` bytes starting at `(chunkIdx, localOffset)` spanning
   * into subsequent chunks; used for needle-sized boundary windows only.
   */
  private boundaryWindow(
    chunkIdx: number,
    localOffset: number,
    maxLen: number
  ): Buffer {
    const parts: Buffer[] = [];
    let need = maxLen;
    for (let i = chunkIdx; i < this.chunks.length && need > 0; i++) {
      const part =
        i === chunkIdx ? this.chunks[i].subarray(localOffset) : this.chunks[i];
      const take = part.length > need ? part.subarray(0, need) : part;
      parts.push(take);
      need -= take.length;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }

  /** Remove the first `n` bytes and return them as one buffer (single copy). */
  private consume(n: number): Buffer {
    if (n <= 0) return Buffer.alloc(0);
    const parts: Buffer[] = [];
    let need = n;
    while (need > 0 && this.chunks.length > 0) {
      const head = this.chunks[0];
      if (head.length <= need) {
        parts.push(head);
        this.chunks.shift();
        need -= head.length;
      } else {
        parts.push(head.subarray(0, need));
        // Keep the remainder as a zero-copy view; it becomes the new head.
        this.chunks[0] = head.subarray(need);
        need = 0;
      }
    }
    this.buffered -= n - need;
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }

  /** Drop the first `n` bytes without materialising them. */
  private discard(n: number): void {
    let need = n;
    while (need > 0 && this.chunks.length > 0) {
      const head = this.chunks[0];
      if (head.length <= need) {
        this.chunks.shift();
        need -= head.length;
      } else {
        this.chunks[0] = head.subarray(need);
        need = 0;
      }
    }
    this.buffered -= n - need;
  }
}
