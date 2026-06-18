import { RandomAccess } from '../random-access.js';

/**
 * A {@link RandomAccess} over the **decrypted plaintext** of an AES-CBC
 * ciphertext stream. CBC is seekable at 16-byte block boundaries: to read
 * plaintext at offset `o`, decrypt from block `floor(o/16)` using the
 * preceding ciphertext block (or the stream IV for block 0) as the CBC IV.
 * No full-stream buffering, so the plaintext streams on demand.
 *
 * Subclasses supply the ciphertext ({@link readCipher}) and the cipher
 * variant/key ({@link decryptBlocks}); plaintext and ciphertext are
 * byte-aligned 1:1 in CBC, so logical (plaintext) offsets index the cipher
 * stream directly.
 */
export abstract class CbcSeekableSource implements RandomAccess {
  protected constructor(
    private readonly plainSize: number,
    /** CBC IV for ciphertext block 0. */
    private readonly iv0: Buffer
  ) {}

  size(): number {
    return this.plainSize;
  }

  /** Read `length` ciphertext bytes at a global (stream) cipher offset. */
  protected abstract readCipher(
    offset: number,
    length: number
  ): Promise<Buffer>;

  /** AES-CBC decrypt `cipher` (a multiple of 16 bytes) with `iv`. */
  protected abstract decryptBlocks(iv: Buffer, cipher: Buffer): Buffer;

  async readAt(offset: number, length: number): Promise<Buffer> {
    if (length <= 0 || offset >= this.plainSize) return Buffer.alloc(0);
    const start = Math.max(0, offset);
    const want = Math.min(length, this.plainSize - start);
    const end = start + want;
    const firstBlock = Math.floor(start / 16);
    const lastBlock = Math.ceil(end / 16);

    const iv =
      firstBlock === 0
        ? this.iv0
        : await this.readCipher((firstBlock - 1) * 16, 16);
    if (iv.length < 16) return Buffer.alloc(0);

    const cipher = await this.readCipher(
      firstBlock * 16,
      (lastBlock - firstBlock) * 16
    );
    const aligned = cipher.length - (cipher.length % 16);
    if (aligned === 0) return Buffer.alloc(0);

    const plain = this.decryptBlocks(iv, cipher.subarray(0, aligned));
    const within = start - firstBlock * 16;
    return plain.subarray(within, within + want);
  }
}
