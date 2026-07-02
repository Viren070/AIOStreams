import { RandomAccess } from '../random-access.js';

/**
 * A {@link RandomAccess} over the **decrypted plaintext** of an AES-CBC
 * ciphertext stream. CBC is seekable at 16-byte block boundaries: to read
 * plaintext at offset `o`, decrypt from block `floor(o/16)` using the
 * preceding ciphertext block (or the stream IV for block 0) as the CBC IV.
 * No full-stream buffering, so the plaintext streams on demand.
 *
 * Subclasses supply the ciphertext ({@link readCipherInto}) and the cipher
 * variant/key ({@link decryptBlocks}); plaintext and ciphertext are
 * byte-aligned 1:1 in CBC, so logical (plaintext) offsets index the cipher
 * stream directly.
 */
export abstract class CbcSeekableSource implements RandomAccess {
  /**
   * Reusable ciphertext scratch buffers. Several windows call
   * {@link readAtInto} concurrently, so a single shared scratch would race;
   * the free list grows to the concurrent-window count and is then reused
   * steadily. {@link decryptBlocks}' plaintext output remains a per-window
   * allocation (node:crypto `update()` always returns a fresh Buffer).
   */
  private cipherScratch: Buffer[] = [];

  protected constructor(
    private readonly plainSize: number,
    /** CBC IV for ciphertext block 0. */
    private readonly iv0: Buffer
  ) {}

  size(): number {
    return this.plainSize;
  }

  /**
   * Read `length` ciphertext bytes at a global (stream) cipher offset into
   * `dst` at `dstOffset`, returning bytes written (fewer only at cipher EOF).
   */
  protected abstract readCipherInto(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number
  ): Promise<number>;

  /** AES-CBC decrypt `cipher` (a multiple of 16 bytes) with `iv`. */
  protected abstract decryptBlocks(iv: Buffer, cipher: Buffer): Buffer;

  async readAt(offset: number, length: number): Promise<Buffer> {
    if (length <= 0 || offset >= this.plainSize) return Buffer.alloc(0);
    const want = Math.min(length, this.plainSize - Math.max(0, offset));
    const dst = Buffer.allocUnsafe(want);
    const written = await this.readAtInto(dst, 0, offset, length);
    return written === dst.length ? dst : dst.subarray(0, written);
  }

  /** {@link readAt} into a caller-owned buffer (see RandomAccess.readAtInto). */
  async readAtInto(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number
  ): Promise<number> {
    if (length <= 0 || offset >= this.plainSize) return 0;
    const start = Math.max(0, offset);
    const want = Math.min(length, this.plainSize - start);
    const end = start + want;
    const firstBlock = Math.floor(start / 16);
    const lastBlock = Math.ceil(end / 16);

    // IV (16 bytes) + ciphertext land in one reused scratch: [iv][cipher...].
    const cipherLen = (lastBlock - firstBlock) * 16;
    const scratch = this.acquireScratch(16 + cipherLen);
    try {
      let iv: Buffer;
      if (firstBlock === 0) {
        iv = this.iv0;
      } else {
        const n = await this.readCipherInto(
          scratch,
          0,
          (firstBlock - 1) * 16,
          16
        );
        if (n < 16) return 0;
        iv = scratch.subarray(0, 16);
      }

      const got = await this.readCipherInto(
        scratch,
        16,
        firstBlock * 16,
        cipherLen
      );
      const aligned = got - (got % 16);
      if (aligned === 0) return 0;

      const plain = this.decryptBlocks(iv, scratch.subarray(16, 16 + aligned));
      const within = start - firstBlock * 16;
      const usable = Math.min(want, Math.max(0, plain.length - within));
      plain.copy(dst, dstOffset, within, within + usable);
      return usable;
    } finally {
      this.releaseScratch(scratch);
    }
  }

  private acquireScratch(min: number): Buffer {
    const buf = this.cipherScratch.pop();
    if (buf && buf.length >= min) return buf;
    // Undersized buffers are dropped; sizes settle after the first full window.
    return Buffer.allocUnsafe(min);
  }

  private releaseScratch(buf: Buffer): void {
    if (this.cipherScratch.length < 32) this.cipherScratch.push(buf);
  }
}
