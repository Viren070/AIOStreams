import { RandomAccess } from '../random-access.js';
import { ArchiveEntry, DataFragment, AesStoredRegion } from '../types.js';
import { RarCryptInfo } from '../crypto/rar-kdf.js';
import { LazyFragmentResolver } from '../lazy-resolver.js';
import { ArchiveInnerStream, ArchiveStreamOptions } from '../inner-stream.js';
import { AesFolderSource } from '../crypto/aes-folder-source.js';
import { RarAesSource } from '../crypto/rar-aes-source.js';

/** Whether a descriptor still carries unresolved (estimated) lazy fragments. */
export function hasPendingFragments(d: {
  fragments?: DataFragment[];
}): boolean {
  return !!d.fragments?.some((f) => f.pending !== undefined);
}

/**
 * The minimal, JSON-serialisable description of one inner file's bytes within
 * its immediate parent source: stored plaintext {@link DataFragment}s, or an
 * AES store+encrypt region. An {@link ArchiveEntry} satisfies it structurally.
 */
export interface InnerDescriptor {
  name: string;
  size: number;
  /** Stored plaintext fragments (one per volume the file spans). */
  fragments?: DataFragment[];
  /** Present for 7z store+encrypt entries (AES-CBC decrypt on the fly). */
  aes?: AesStoredRegion;
  /**
   * Present for a stored encrypted RAR4/RAR5 entry: the {@link fragments} are
   * AES-CBC ciphertext, decrypted on the fly with the password.
   */
  crypt?: RarCryptInfo;
}

/**
 * Build a {@link RandomAccess} over an inner file's bytes: plaintext fragments
 * for a stored entry, or AES-CBC-decrypted bytes for a store+encrypt entry.
 * Returned as an {@link ArchiveInnerStream} so it is both seekable (for a final
 * streamed file) and a {@link RandomAccess} (for a nested {@link VolumeSet}).
 */
export function entrySource(
  parent: RandomAccess,
  entry: InnerDescriptor,
  password: string,
  streamOpts?: ArchiveStreamOptions,
  resolver?: LazyFragmentResolver
): ArchiveInnerStream {
  if (entry.aes) {
    return new ArchiveInnerStream(
      new AesFolderSource(parent, entry.aes, password),
      [{ offset: entry.aes.plainOffset, length: entry.size }],
      entry.name,
      entry.size,
      streamOpts
    );
  }
  if (entry.crypt && entry.fragments) {
    // The fragments are AES-CBC ciphertext over the VolumeSet; decrypt on the
    // fly, then index the plaintext as one contiguous logical file.
    return new ArchiveInnerStream(
      new RarAesSource(
        parent,
        entry.fragments,
        entry.crypt,
        entry.size,
        password
      ),
      [{ offset: 0, length: entry.size }],
      entry.name,
      entry.size,
      streamOpts
    );
  }
  return new ArchiveInnerStream(
    parent,
    entry.fragments ?? [],
    entry.name,
    entry.size,
    streamOpts,
    resolver
  );
}

/** Project a parsed entry onto its serialisable {@link InnerDescriptor}. */
export function descriptorOf(e: ArchiveEntry): InnerDescriptor {
  if (e.aes) return { name: e.name, size: e.size, aes: e.aes };
  if (e.crypt) {
    return {
      name: e.name,
      size: e.size,
      fragments: e.fragments,
      crypt: e.crypt,
    };
  }
  return { name: e.name, size: e.size, fragments: e.fragments };
}
