import yencode from 'yencode';

/**
 * Result of decoding a single yEnc article (segment).
 */
export interface DecodedSegment {
  /** Decoded raw bytes of this part. */
  body: Buffer;
  /**
   * Half-open byte range this part occupies within the full file: [begin, end)
   * using 0-based offsets. Derived from the `=ypart begin/end` (1-based,
   * inclusive) header. Undefined when the header is absent (single-part posts
   * sometimes omit =ypart).
   */
  byteRange?: [number, number];
  /** Total decoded file size from `=ybegin size=`, if present. */
  fileSize?: number;
  /** Filename from `=ybegin name=`, if present. */
  name?: string;
  /** Decoded byte length of this part (body.length). */
  size: number;
}

/**
 * Raised when an article body is not decodable yEnc (missing =ybegin/=yend,
 * malformed part headers, non-yEnc encodings like uuencode). Distinguished from
 * transport errors so inspection can report "post uses an unsupported/broken
 * encoding" instead of a generic open failure.
 */
export class YencDecodeError extends Error {
  constructor(
    readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = 'YencDecodeError';
  }
}

const CR = 0x0d;
const LF = 0x0a;
const EQ = 0x3d; // '='
const Y = 0x79; // 'y'
const YBEGIN_CRLF = Buffer.from('\r\n=ybegin ');
const YBEGIN_AT0 = Buffer.from('=ybegin ');
const YEND_CRLF = Buffer.from('\r\n=yend');

/**
 * Decode a complete article body (raw, possibly dot-stuffed NNTP payload) into
 * its yEnc-decoded bytes plus the part/file metadata we need for seeking.
 *
 * Parses only the `=ybegin`/`=ypart` header lines we actually consume, then
 * decodes the data region straight into one right-sized buffer via the native
 * `decodeTo`. This skips the two things `yencode.from_post` does per article that
 * nothing here uses: a full CRC32 pass over the decoded body, and a swarm of
 * short-lived JS objects (per-line strings, nested `props`, a `warnings` array).
 * Structural failures (no start / no end marker) still throw
 * {@link YencDecodeError}.
 *
 * @param raw the article body bytes as received from BODY (without the
 *   terminating `\r\n.\r\n`). Still dot-stuffed, so decoding strips dots.
 * @param out optional decode destination, used only when it can hold the
 *   whole decoded part (the encoded slice length is a safe upper bound);
 *   otherwise a fresh owned buffer is allocated. When used, the returned
 *   body is a view into it and the caller owns its lifetime.
 */
export function decodeArticle(raw: Buffer, out?: Buffer): DecodedSegment {
  // Locate the `=ybegin ` line: usually at offset 0, otherwise after a CRLF
  // (real posts sometimes carry junk before the header).
  let pos: number;
  if (
    raw.length >= 8 &&
    raw[0] === EQ &&
    raw.compare(YBEGIN_AT0, 0, 8, 0, 8) === 0
  ) {
    pos = 0;
  } else {
    const at = raw.indexOf(YBEGIN_CRLF);
    if (at < 0) {
      throw new YencDecodeError(
        'no_start_found',
        'yEnc decode failed: no_start_found'
      );
    }
    pos = at + 2; // skip the leading CRLF
  }

  let fileSize: number | undefined;
  let name: string | undefined;
  let byteRange: [number, number] | undefined;

  // Walk the header lines (`=ybegin`, optional `=ypart`, rarely more) until the
  // first line that does not start with `=y`, which is where the data begins.
  // `=ybegin` is always first; `=ypart` (when present) carries the byte range.
  let first = true;
  while (pos < raw.length && raw[pos] === EQ && raw[pos + 1] === Y) {
    let eol = raw.indexOf(LF, pos);
    if (eol < 0) eol = raw.length;
    // Header lines are short; latin1 keeps a 1:1 byte↔char mapping.
    const lineEnd = eol > pos && raw[eol - 1] === CR ? eol - 1 : eol;
    const line = raw.toString('latin1', pos, lineEnd);
    if (first) {
      // `=ybegin line=128 size=768000 name=...`
      fileSize = toInt(/(?:^|\s)size=(\d+)/.exec(line)?.[1]);
      name = /(?:^|\s)name=(.*)$/.exec(line)?.[1];
      first = false;
    } else if (line.startsWith('=ypart ')) {
      const pb = toInt(/(?:^|\s)begin=(\d+)/.exec(line)?.[1]);
      const pe = toInt(/(?:^|\s)end=(\d+)/.exec(line)?.[1]);
      if (pb !== undefined && pe !== undefined) {
        // =ypart begin/end are 1-based inclusive → 0-based half-open.
        byteRange = [pb - 1, pe];
      }
    }
    pos = eol + 1;
  }
  const dataStart = pos;

  // The data region ends at the trailing `\r\n=yend`. Search from the end so a
  // stray `=yend`-looking sequence inside the data can't end it early.
  const dataEnd = raw.lastIndexOf(YEND_CRLF);
  if (dataEnd < 0 || dataEnd < dataStart) {
    throw new YencDecodeError(
      'no_end_found',
      'yEnc decode failed: no_end_found'
    );
  }

  const slice = raw.subarray(dataStart, dataEnd);
  // Decoded length is always ≤ encoded length (escapes + line breaks shrink),
  // so the encoded slice length is a safe destination size; decodeTo returns
  // the exact written count.
  const dst =
    out && out.length >= slice.length ? out : Buffer.allocUnsafe(slice.length);
  const written = yencode.decodeTo(slice, dst, true);
  const body = dst.subarray(0, written);

  return { body, byteRange, fileSize, name, size: written };
}

/**
 * Some obfuscated posts declare a bogus, too-small yEnc `=ybegin size=` (e.g.
 * ~5 MB in the first part of a ~200 MB multipart volume).
 *
 * Returns true when `fileSize` is too small to be
 * this multipart file's real decoded size, so the caller must instead derive
 * the size from the last part's `=ypart end=`.
 */
export function isImplausibleYencFileSize(
  fileSize: number,
  numParts: number,
  ref: { encodedSize?: number; firstPartLen?: number }
): boolean {
  if (numParts <= 1) return false; // single part: `=ybegin size=` IS the part
  if (ref.encodedSize && ref.encodedSize > 0) {
    return fileSize < ref.encodedSize * 0.5;
  }
  if (ref.firstPartLen && ref.firstPartLen > 0) {
    return fileSize < ref.firstPartLen * (numParts - 1);
  }
  return false; // no reference to judge against → trust it (no regression)
}

/**
 * Streaming yEnc decoder for piping article bytes as they arrive off the wire.
 * Wraps `yencode.decodeChunk`, carrying state between chunks and performing
 * NNTP dot-unstuffing. Emits decoded payload bytes only.
 */
export class StreamingYencDecoder {
  private state: string | null = null;
  private _ended = false;

  get ended(): boolean {
    return this._ended;
  }

  /**
   * Feed a chunk of raw (dot-stuffed) article bytes; returns the decoded bytes
   * produced from this chunk (may be empty). Once the end marker is reached,
   * subsequent input is ignored.
   */
  push(chunk: Buffer): Buffer {
    if (this._ended || chunk.length === 0) return Buffer.alloc(0);
    const res = yencode.decodeChunk(chunk, undefined, this.state);
    this.state = res.state;
    if (res.ended) this._ended = true;
    return res.written === res.output.length
      ? res.output
      : res.output.subarray(0, res.written);
  }
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Cap on raw bytes searched for the `=ybegin`/`=ypart` header lines. */
const HEAD_CAPTURE_HEADER_CAP = 4096;

/**
 * Streaming "head-only" article consumer for import probes: decodes just the
 * leading `want` bytes (plus the yEnc header fields) and then stops decoding
 * while the remaining raw bytes drain on the wire (the CPU/RAM-side half of
 * the probe diet). When the headers carry no part range or total size, decoding
 * continues to the end purely to COUNT the part's decoded length (nothing
 * beyond the head is retained either way).
 */
export class YencHeadCapture {
  private decoder = new StreamingYencDecoder();
  /**
   * Raw bytes buffered until the `=ybegin`/`=ypart` lines are located. The
   * underlying `yencode.decodeChunk` is a DATA-region decoder: fed from the
   * article start it reads `=ybegin`'s `\r\n=y` shape as the end marker, so
   * the header lines must be stripped before feeding it.
   */
  private pendingRaw: Buffer[] = [];
  private pendingLen = 0;
  private headerParsed = false;
  private headChunks: Buffer[] = [];
  private headLen = 0;
  private decoding = true;
  private countToEnd = false;
  private decodedCount = 0;

  byteRange?: [number, number];
  fileSize?: number;
  name?: string;

  constructor(private want: number) {}

  push(raw: Buffer): void {
    if (this.headerParsed) {
      this.feed(raw);
      return;
    }
    // Copy: the reader may hand over views into reused socket chunks.
    this.pendingRaw.push(Buffer.from(raw));
    this.pendingLen += raw.length;
    this.tryParseHeader();
  }

  /** Assemble the result once the article's payload has fully drained. */
  finish(): {
    head: Buffer;
    byteRange?: [number, number];
    fileSize?: number;
    name?: string;
    size?: number;
  } {
    const head = Buffer.concat(this.headChunks).subarray(0, this.want);
    let size: number | undefined;
    if (this.byteRange) {
      size = this.byteRange[1] - this.byteRange[0];
    } else if (this.fileSize !== undefined) {
      // No =ypart ⇒ single-part post: the part IS the file.
      size = this.fileSize;
    } else if (this.decoding) {
      // Decoded all the way through (header-less/odd article).
      size = this.decodedCount;
    }
    return {
      head,
      byteRange: this.byteRange,
      fileSize: this.fileSize,
      name: this.name,
      size,
    };
  }

  private feed(raw: Buffer): void {
    if (!this.decoding) return;
    const out = this.decoder.push(raw);
    if (out.length === 0) return;
    this.decodedCount += out.length;
    if (this.headLen < this.want) {
      // Copy: `out` aliases the decoder's transferable scratch buffer.
      this.headChunks.push(Buffer.from(out));
      this.headLen += out.length;
    }
    if (this.headLen >= this.want && !this.countToEnd) {
      this.decoding = false;
    }
  }

  private tryParseHeader(): void {
    const joined =
      this.pendingRaw.length === 1
        ? this.pendingRaw[0]
        : Buffer.concat(this.pendingRaw);
    const text = joined.toString(
      'latin1',
      0,
      Math.min(joined.length, HEAD_CAPTURE_HEADER_CAP)
    );
    const giveUp = (): void => {
      // Not yEnc-shaped within the cap: decode-from-start to the end so size
      // falls back to whatever the decoder makes of it. Best-effort only.
      this.headerParsed = true;
      this.countToEnd = true;
      this.flushPending(0);
    };

    // Not anchored: real posts sometimes carry stray bytes before `=ybegin`
    // (from_post tolerates this too).
    const begin = text.match(/(?:^|\r?\n)(=ybegin ([^\r\n]*))\r?\n/);
    if (!begin) {
      if (joined.length >= HEAD_CAPTURE_HEADER_CAP) giveUp();
      return;
    }
    const attrs = begin[2].replace(/\r$/, '');
    let dataStart = begin.index! + begin[0].length;
    const isMultipart = / part=\d+/.test(` ${attrs}`);
    let byteRange: [number, number] | undefined;
    if (isMultipart) {
      const part = text.slice(dataStart).match(/^=ypart ([^\r\n]*)\r?\n/);
      if (!part) {
        if (joined.length >= HEAD_CAPTURE_HEADER_CAP) giveUp();
        return;
      }
      const partBegin = toInt(part[1].match(/(?:^| )begin=(\d+)/)?.[1]);
      const partEnd = toInt(part[1].match(/(?:^| )end=(\d+)/)?.[1]);
      if (partBegin !== undefined && partEnd !== undefined) {
        byteRange = [partBegin - 1, partEnd];
      } else {
        this.countToEnd = true;
      }
      dataStart += part[0].length;
    }
    this.fileSize = toInt(attrs.match(/(?:^| )size=(\d+)/)?.[1]);
    this.name = attrs.match(/(?:^| )name=(.*)$/)?.[1];
    this.byteRange = byteRange;
    this.headerParsed = true;
    // Hand everything past the header lines to the decoder (latin1 keeps a
    // 1:1 char↔byte mapping, so the text offset IS the byte offset).
    this.flushPending(dataStart);
  }

  private flushPending(from: number): void {
    const joined =
      this.pendingRaw.length === 1
        ? this.pendingRaw[0]
        : Buffer.concat(this.pendingRaw);
    this.pendingRaw = [];
    this.pendingLen = 0;
    if (from < joined.length) this.feed(joined.subarray(from));
  }
}
