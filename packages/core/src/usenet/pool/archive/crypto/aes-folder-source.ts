import { RandomAccess } from '../random-access.js';
import { AesStoredRegion } from '../types.js';
import { CbcSeekableSource } from './cbc-source.js';
import { deriveAesKey, decryptAesRegion } from './aes7z.js';

/**
 * The decrypted plaintext of a 7z store+encrypt folder (an `AES → Copy`
 * chain) as a seekable {@link CbcSeekableSource}. Offsets are folder-plaintext
 * offsets (the plaintext length equals the block-aligned ciphertext length);
 * a specific inner file is then a fragment `[plainOffset, plainOffset + size)`
 * read through an {@link ArchiveInnerStream}.
 */
export class AesFolderSource extends CbcSeekableSource {
  private readonly key: Buffer;

  constructor(
    private readonly parent: RandomAccess,
    private readonly region: AesStoredRegion,
    password: string
  ) {
    super(region.packSize, region.iv);
    this.key = deriveAesKey(password, region.cycles, region.salt);
  }

  protected readCipher(offset: number, length: number): Promise<Buffer> {
    return this.parent.readAt(this.region.packOffset + offset, length);
  }

  protected decryptBlocks(iv: Buffer, cipher: Buffer): Buffer {
    return decryptAesRegion(this.key, iv, cipher);
  }
}
