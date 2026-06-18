/**
 * Minimal ambient typings for the native `yencode` module (animetosho/
 * node-yencode). Only the surface we use is declared.
 * @see https://github.com/animetosho/node-yencode
 */
declare module 'yencode' {
  /** Incremental streaming decode state (opaque string of trailing chars). */
  export interface DecodeChunkResult {
    /** Bytes read from `data`. Less than data.length only when `ended`. */
    read: number;
    /** Bytes written to `output`. */
    written: number;
    /** Decoded output (same ref as `output` arg if supplied). */
    output: Buffer;
    /** Whether the end of the yEnc data was reached. */
    ended: boolean;
    /** Decoder state to feed into the next call (or end-marker when ended). */
    state: string;
  }

  /**
   * Incrementally decode a chunk of (dot-stuffed) NNTP article data. Performs
   * NNTP dot-unstuffing and stops at the yEnc/article end marker.
   */
  export function decodeChunk(
    data: Buffer,
    state?: string | null,
    output?: Buffer
  ): DecodeChunkResult;

  /** Raw yEnc decode of a buffer. `stripDots` enables NNTP dot-unstuffing. */
  export function decode(data: Buffer, stripDots?: boolean): Buffer;

  export interface FromPostProps {
    begin?: Record<string, string>;
    part?: Record<string, string>;
    end?: Record<string, string>;
  }

  export interface FromPostResult {
    yencStart: number;
    dataStart: number;
    dataEnd: number;
    yencEnd: number;
    data: Buffer;
    crc32: Buffer;
    props: FromPostProps;
    warnings: { code: string; message: string }[];
  }

  export interface FromPostError extends Error {
    code: 'no_start_found' | 'no_end_found' | 'missing_required_properties';
  }

  /**
   * Decode a complete yEnc post (parses =ybegin/=ypart/=yend). Set `stripDots`
   * when NNTP dot-unstuffing has not yet been performed. Returns a result or a
   * DecoderError (an Error with a `code`).
   */
  export function from_post(
    data: Buffer,
    stripDots?: boolean
  ): FromPostResult | FromPostError;

  /** Maximum decoded output size for a given input length. */
  export function maxSize(length: number, lineSize?: number): number;

  /** Produce a single yEnc-encoded post (for tests / round-trips). */
  export function post(
    filename: string,
    data: Buffer | number[] | string,
    lineSize?: number
  ): Buffer;
}
