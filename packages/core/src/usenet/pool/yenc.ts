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

/**
 * Decode a complete article body (raw, possibly dot-stuffed NNTP payload) into
 * its yEnc-decoded bytes plus the part/file metadata we need for seeking.
 *
 * @param raw the article body bytes as received from BODY (without the
 *   terminating `\r\n.\r\n`). Still dot-stuffed, so `stripDots` is true.
 */
export function decodeArticle(raw: Buffer): DecodedSegment {
  const result = yencode.from_post(raw, true);
  if (result instanceof Error || (result as any).code) {
    const err = result as yencode.FromPostError;
    throw new YencDecodeError(
      err.code,
      `yEnc decode failed: ${err.code ?? err.message}`
    );
  }
  const ok = result as yencode.FromPostResult;
  const props = ok.props ?? {};

  const begin = props.begin ?? {};
  const part = props.part ?? {};

  const fileSize = toInt(begin.size);
  const name = begin.name;

  let byteRange: [number, number] | undefined;
  const partBegin = toInt(part.begin);
  const partEnd = toInt(part.end);
  if (partBegin !== undefined && partEnd !== undefined) {
    // =ypart begin/end are 1-based inclusive; convert to 0-based half-open.
    byteRange = [partBegin - 1, partEnd];
  }

  return {
    body: ok.data,
    byteRange,
    fileSize,
    name,
    size: ok.data.length,
  };
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
    const res = yencode.decodeChunk(chunk, this.state);
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
