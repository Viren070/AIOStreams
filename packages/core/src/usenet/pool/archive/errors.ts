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
