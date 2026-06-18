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
}
