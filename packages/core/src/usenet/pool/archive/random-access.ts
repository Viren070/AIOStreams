/**
 * A seekable, random-access byte source. Both a single {@link FileStream} and a
 * multi-volume {@link VolumeSet} satisfy this, so archive header parsers can read
 * arbitrary regions without caring how the bytes are sourced.
 */
export interface RandomAccess {
  /** Total byte length. */
  size(): number;
  /**
   * Read up to `length` bytes at `offset`. May return fewer bytes only at EOF.
   */
  readAt(offset: number, length: number): Promise<Buffer>;
  /**
   * Zero-alloc variant: write up to `length` bytes at `offset` into `dst`
   * starting at `dstOffset`, returning the byte count written (fewer only at
   * EOF). Optional; hot serve-path sources implement it so the archive
   * streaming chain copies once into a caller-owned window buffer instead of
   * allocating a fresh buffer per layer. Call via {@link readAtIntoFrom} for
   * an automatic fallback.
   *
   * `signal` (serve path only) cancels segment fetches the read has not yet
   * started or that are still queued at the download semaphore, so an
   * abandoned read window stops consuming the download budget.
   * Implementations forward it to their underlying source.
   */
  readAtInto?(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number,
    signal?: AbortSignal
  ): Promise<number>;
}

/** `src.readAtInto` when implemented, else `readAt` plus a copy. */
export async function readAtIntoFrom(
  src: RandomAccess,
  dst: Buffer,
  dstOffset: number,
  offset: number,
  length: number,
  signal?: AbortSignal
): Promise<number> {
  if (src.readAtInto) {
    return src.readAtInto(dst, dstOffset, offset, length, signal);
  }
  const buf = await src.readAt(offset, length);
  buf.copy(dst, dstOffset);
  return buf.length;
}
