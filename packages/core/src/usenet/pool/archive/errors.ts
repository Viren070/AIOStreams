/** Machine-readable reasons an archived result cannot be streamed. */
export type ArchiveErrorCode =
  | 'archive_compressed'
  | 'archive_encrypted'
  | 'archive_bad_password'
  | 'archive_solid'
  | 'archive_nested'
  | 'archive_unsupported'
  | 'archive_no_video'
  | 'archive_disabled'
  | 'archive_incomplete';

/**
 * Raised when an archived result cannot be streamed (compressed, encrypted,
 * solid, nested-while-disabled, or unsupported container). Surfaced as a
 * fast-fail so failover can move on, and mapped to a friendly library message.
 */
export class NotStreamableError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'NotStreamableError';
  }
}

/** Thrown when an archive is encrypted but no password was supplied. */
export class ArchiveEncryptedError extends Error {
  constructor(message = 'archive is encrypted (password required)') {
    super(message);
    this.name = 'ArchiveEncryptedError';
  }
}

/** Thrown when a supplied password fails the archive's password check. */
export class ArchiveBadPasswordError extends Error {
  constructor(message = 'archive password is incorrect') {
    super(message);
    this.name = 'ArchiveBadPasswordError';
  }
}
