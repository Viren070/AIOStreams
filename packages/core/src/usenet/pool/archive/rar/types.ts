/**
 * RAR-specific types + constants for the RAR4/RAR5 header parser. The
 * format-neutral entry types live in {@link ../types.js}.
 */
import type { Rar5CryptInfo, RarCryptInfo } from '../crypto/rar-kdf.js';
import type { DataFragment } from '../types.js';

/** A volume whose header walk failed during {@link RarReader.parse}. */
export interface RarVolumeError {
  /** Index into the volumeRanges passed to the constructor. */
  volume: number;
  error: Error;
}

export interface RarParseOptions {
  /** Parallelism for the per-volume header walk (volumes are independent). */
  concurrency?: number;
  /**
   * Already-fetched decoded leading bytes of each volume, index-aligned with
   * the constructor's volumeRanges. Reads that fit inside a head are served
   * from memory; everything else falls back to the backing RandomAccess.
   */
  heads?: (Buffer | undefined)[];
  /**
   * Lazy mode: every volume size is EXACT but only some volumes (first/last)
   * have probe heads. Walk only the volumes where a file starts/ends; the
   * volumes a split file fully spans become PENDING fragments (estimated
   * length, per-file sum forced exact) resolved on first touch by the serving
   * path, O(files) volume reads at parse time instead of O(volumes). Any
   * structural inconsistency falls back to the full per-volume parse.
   */
  lazy?: boolean;
  /** Archive password (RAR4/RAR5 `-hp` header decryption). */
  password?: string;
  signal?: AbortSignal;
}

/** Internal: abandon the lazy parse and fall back to the full parse. */
export class LazyAbortError extends Error {}

// "Rar!\x1A\x07": the marker shared by RAR4 (+ 0x00) and RAR5 (+ 0x01 0x00).
export const SIG_PREFIX = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]);
export const MAX_SFX_SCAN = 0x100000; // bytes to scan for the signature
export const MAX_HEADER = 0x200000; // RAR5 max header size
/**
 * A volume tail smaller than this can only hold an end-of-archive record
 * (RAR4 endarc ≥7B, RAR5 ≥8B; the smallest FILE block is larger), so the walk
 * stops without reading it; the endarc carries nothing the continuation
 * linking needs (that uses the file header's split flags), and skipping it
 * saves one cold tail fetch per volume. Recovery records / further files
 * leave a larger remainder and are still read.
 */
export const ENDARC_SKIP_BYTES = 24;
/** Per-volume guard against malformed headers looping forever. */
export const MAX_BLOCKS_PER_VOLUME = 100_000;

/** Read a RAR5 variable-length integer. Returns [value, bytesConsumed]. */
export function uvarint(buf: Buffer, pos: number): [number, number] {
  let x = 0;
  let s = 0;
  let n = 0;
  while (pos + n < buf.length && n < 10) {
    const b = buf[pos + n];
    if (b < 0x80) return [x + b * 2 ** s, n + 1];
    x += (b & 0x7f) * 2 ** s;
    s += 7;
    n++;
  }
  return [0, n]; // ran out of bytes
}

export type ParsedFile = {
  name: string;
  unpSize: number;
  packedSize: number;
  isDir: boolean;
  stored: boolean;
  solid: boolean;
  encrypted: boolean;
  first: boolean;
  last: boolean;
  /**
   * File-encryption parameters: present iff encrypted (RAR5 extra type-1
   * record / RAR4 file-header salt).
   */
  crypt?: RarCryptInfo;
};

/**
 * Signals that headers are encrypted from this block on: a RAR5 crypt header
 * (htype 4, carries the block-key record) or a RAR4 main header with the
 * `-hp` flag (per-header salts, no single key).
 */
export type HeaderCrypt = { v: 5; crypt: Rar5CryptInfo } | { v: 4 };

export type BlockResult =
  | { kind: 'file'; next: number; dataOff: number; file: ParsedFile }
  | { kind: 'end'; next: number }
  | {
      kind: 'other';
      next: number;
      headerCrypt?: HeaderCrypt;
      archiveVolumeNumber?: number;
    };

/** Per-volume context threaded through the block walk. */
export interface VolumeCtx {
  range: { start: number; end: number };
  head?: Buffer;
  /**
   * The range is ONE real volume (explicit volumeRanges). False for the
   * default whole-stream range (nested archives, joined raw splits), where a
   * split file continues WITHIN the range and the walk must keep going.
   */
  perVolume: boolean;
  /** Archive password (RAR4/RAR5 `-hp`); needed to decrypt block headers. */
  password?: string;
  /**
   * RAR5 block-encryption key, set once the volume's crypt header (htype 4) is
   * parsed. While set, every subsequent block header is AES-256-CBC encrypted
   * ([IV 16][ciphertext]).
   */
  blockKey?: Buffer;
  /**
   * RAR4 `-hp`: set once the main header's encrypted flag is seen. Unlike
   * RAR5 there is no single block key; every subsequent header is
   * [salt 8][AES-128-CBC ciphertext] with a per-salt derived key/IV.
   */
  rar4Encrypted?: boolean;
  /**
   * RAR4 `-hp`: the first decrypted header passed its CRC16, proving the
   * password. Before this, a CRC mismatch means a bad password; after it,
   * corruption (parse ends).
   */
  rar4Verified?: boolean;
}

export type VolumeBlock = { file: ParsedFile; fragment: DataFragment };

export interface VolumeParse {
  version?: 4 | 5;
  blocks: VolumeBlock[];
  error?: Error;
  encrypted?: boolean;
  volumeNumber?: number;
}
