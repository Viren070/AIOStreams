/**
 * Format-neutral archive types shared by the RAR ({@link ./rar/index.js}) and
 * 7z ({@link ./sevenzip/parse.js}) parsers. Both produce {@link ArchiveEntry}s
 * so {@link ./open.js} can treat all archives uniformly.
 */
import type { RarCryptInfo } from './crypto/rar-kdf.js';

/** A contiguous run of an inner file's stored data in the concatenated stream. */
export interface DataFragment {
  /** Absolute offset within the {@link RandomAccess} (VolumeSet) stream. */
  offset: number;
  length: number;
  /**
   * Set when this fragment is an UNRESOLVED middle volume of a lazily-parsed
   * split file: the volume's header has not been read, so `offset`/`length`
   * are estimates (per-file sum forced exact). The value is the index into the
   * set's volumeRanges. Estimates are never served; the lazy resolver reads
   * the volume's continuation header on first touch and replaces the fragment
   * with exact values.
   */
  pending?: number;
}

/**
 * Describes a **stored-but-AES-encrypted** inner file (7z store+encrypt: an
 * `AES → Copy` folder). The plaintext is recovered by AES-256-CBC decrypting the
 * folder's packed region (seekable at 16-byte block boundaries), so such files
 * still stream on-demand given the password. `plainOffset` is this file's offset
 * within the folder's decrypted output.
 */
export interface AesStoredRegion {
  /** Absolute offset of the folder's encrypted packed data in the source. */
  packOffset: number;
  /** Encrypted packed byte length (16-byte block aligned). */
  packSize: number;
  /** AES KDF salt. */
  salt: Buffer;
  /** AES-CBC initial vector. */
  iv: Buffer;
  /** KDF iteration exponent (`2^cycles`), or `0x3f` for raw. */
  cycles: number;
  /** Plaintext offset of this file within the decrypted folder output. */
  plainOffset: number;
}

/** The shared archive-entry shape produced by both the RAR and 7z parsers. */
export interface ArchiveEntry {
  name: string;
  /** Decoded (unpacked) size: the full file size, even across volumes. */
  size: number;
  /** Total packed size (== size for stored entries). */
  packedSize: number;
  isDir: boolean;
  /** Stored (method 0): readable via {@link fragments} without decompression. */
  stored: boolean;
  solid: boolean;
  encrypted: boolean;
  /** Ordered data fragments (one per volume the file spans). */
  fragments: DataFragment[];
  /**
   * Present when the file is stored but AES-encrypted (7z store+encrypt). The
   * bytes are recovered by decrypting {@link AesStoredRegion}; {@link fragments}
   * is then empty and {@link stored} is true.
   */
  aes?: AesStoredRegion;
  /**
   * Present for a stored encrypted RAR4/RAR5 entry (`-p`, or any file inside a
   * `-hp` archive). The {@link fragments} are AES-CBC ciphertext over the
   * concatenated volume data; decrypting them (seekable at 16-byte boundaries)
   * yields the plaintext, so the entry still streams on demand given the
   * password.
   */
  crypt?: RarCryptInfo;
  /**
   * One or more volumes backing this file failed to parse (missing article,
   * no signature) or a continuation never arrived: the fragment map has a
   * gap, so the entry must not be streamed.
   */
  incomplete?: boolean;
}
