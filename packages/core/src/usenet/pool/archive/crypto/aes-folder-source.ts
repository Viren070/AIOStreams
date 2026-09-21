import { RandomAccess, readAtIntoFrom } from '../random-access.js';
import { AesStoredRegion } from '../types.js';
import { CbcSeekableSource } from './cbc-source.js';
import { deriveAesKey } from './aes7z.js';

/**
 * The decrypted plaintext of a 7z store+encrypt folder (an `AES → Copy`
 * chain) as a seekable {@link CbcSeekableSource}. Offsets are folder-plaintext
 * offsets (the plaintext length equals the block-aligned ciphertext length);
 * a specific inner file is then a fragment `[plainOffset, plainOffset + size)`
 * read through an {@link ArchiveInnerStream}.
 */
export class AesFolderSource extends CbcSeekableSource {
  constructor(
    private readonly parent: RandomAccess,
    private readonly region: AesStoredRegion,
    password: string
  ) {
    super(
      region.packSize,
      region.iv,
      deriveAesKey(password, region.cycles, region.salt)
    );
  }

  protected readCipherInto(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number,
    signal?: AbortSignal
  ): Promise<number> {
    return readAtIntoFrom(
      this.parent,
      dst,
      dstOffset,
      this.region.packOffset + offset,
      length,
      signal
    );
  }
}
