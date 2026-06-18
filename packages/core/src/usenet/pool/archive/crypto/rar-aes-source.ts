import { RandomAccess } from '../random-access.js';
import { DataFragment } from '../types.js';
import { NotStreamableError } from '../errors.js';
import { CbcSeekableSource } from './cbc-source.js';
import {
  RarCryptInfo,
  RarKeyIv,
  RarBadPasswordError,
  RarEncryptedError,
  cryptKeyIv,
  decryptCbc,
} from './rar-kdf.js';

/** Resolve key/IV, mapping crypto errors to streamability verdicts. */
function resolveKeyIv(crypt: RarCryptInfo, password: string): RarKeyIv {
  try {
    return cryptKeyIv(crypt, password);
  } catch (err) {
    if (err instanceof RarBadPasswordError) {
      throw new NotStreamableError(
        'archive_bad_password',
        'rar archive password is incorrect'
      );
    }
    if (err instanceof RarEncryptedError) {
      throw new NotStreamableError(
        'archive_encrypted',
        'rar archive is encrypted (password required)'
      );
    }
    throw err;
  }
}

/**
 * The decrypted plaintext of a stored encrypted RAR4/RAR5 inner file as a
 * seekable {@link CbcSeekableSource}. Both versions encrypt a stored file's
 * data as ONE continuous AES-CBC stream over its concatenated volume
 * fragments (AES-128 keyed from the RAR4 file salt / AES-256 from the RAR5
 * file record).
 *
 * The ciphertext lives across the entry's {@link DataFragment}s in the backing
 * VolumeSet; {@link readCipher} maps a global cipher offset through the
 * fragment prefix sums onto {@link parent}.
 */
export class RarAesSource extends CbcSeekableSource {
  private readonly key: Buffer;
  private readonly parent: RandomAccess;
  private readonly fragments: DataFragment[];
  private readonly cipherTotal: number;

  constructor(
    parent: RandomAccess,
    fragments: DataFragment[],
    crypt: RarCryptInfo,
    plainSize: number,
    password: string
  ) {
    const resolved = resolveKeyIv(crypt, password);
    super(plainSize, resolved.iv);
    this.key = resolved.key;
    this.parent = parent;
    this.fragments = fragments;
    this.cipherTotal = fragments.reduce((a, f) => a + f.length, 0);
  }

  /** Read `length` ciphertext bytes at a global offset, across fragments. */
  protected async readCipher(offset: number, length: number): Promise<Buffer> {
    if (length <= 0 || offset >= this.cipherTotal) return Buffer.alloc(0);
    const out: Buffer[] = [];
    let pos = offset;
    let remaining = Math.min(length, this.cipherTotal - offset);
    let logical = 0;
    for (const frag of this.fragments) {
      if (remaining <= 0) break;
      const fragStart = logical;
      const fragEnd = logical + frag.length;
      logical = fragEnd;
      if (pos >= fragEnd) continue;
      const within = pos - fragStart;
      const want = Math.min(remaining, frag.length - within);
      const chunk = await this.parent.readAt(frag.offset + within, want);
      if (chunk.length === 0) break;
      out.push(chunk);
      pos += chunk.length;
      remaining -= chunk.length;
    }
    return Buffer.concat(out);
  }

  protected decryptBlocks(iv: Buffer, cipher: Buffer): Buffer {
    return decryptCbc(this.key, iv, cipher);
  }
}
