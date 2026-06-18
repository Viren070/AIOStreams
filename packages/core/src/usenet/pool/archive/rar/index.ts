/**
 * RAR4/RAR5 header parser, TS port of nwaples/rardecode/v2 (BSD-3).
 *
 * Locates stored (uncompressed) inner files in a (possibly multi-volume)
 * archive without decompression: walks block headers, records byte fragments of
 * stored files for interpolation-seek streaming. Compressed/solid entries are
 * surfaced but flagged non-streamable. RAR4/RAR5 header-encrypted (`-hp`)
 * archives are decrypted with the NZB password (see {@link ../crypto/rar-kdf.js}).
 *
 * Volumes are independent at the block level (only split-file continuation
 * linking crosses them), so the walk runs per-volume in parallel and
 * continuations are linked afterwards in volume order.
 *
 * Module layout:
 *   - `types.ts`  RAR-specific types, constants, `uvarint`
 *   - `scan.ts`   signature scan + windowed reads
 *   - `rar5.ts`   RAR5 block/file header parsing (incl. encrypted headers)
 *   - `rar4.ts`   RAR4 block/file header parsing (incl. encrypted headers)
 *   - `walk.ts`   per-volume block walk (`walkVolume`)
 *   - `reader.ts` `RarReader` (full + lazy parse, entry assembly)
 *
 * Format-neutral entry types ({@link ArchiveEntry}, {@link DataFragment},
 * {@link AesStoredRegion}) live in {@link ../types.js}; RAR4/RAR5 KDFs +
 * AES-CBC helpers in {@link ../crypto/rar-kdf.js}.
 */
export type { ArchiveEntry, DataFragment, AesStoredRegion } from '../types.js';
export type {
  RarVolumeError,
  RarParseOptions,
  ParsedFile,
  VolumeCtx,
  VolumeBlock,
  VolumeParse,
  BlockResult,
  HeaderCrypt,
} from './types.js';
export { walkVolume } from './walk.js';
export { RarReader } from './reader.js';
export type {
  Rar5CryptInfo,
  RarCryptInfo,
  RarKeyIv,
} from '../crypto/rar-kdf.js';
export {
  RarEncryptedError,
  RarBadPasswordError,
  deriveRar5Keys,
  deriveRar4KeyIv,
  cryptKeyIv,
  passwordMatches,
  decryptCbc,
} from '../crypto/rar-kdf.js';
