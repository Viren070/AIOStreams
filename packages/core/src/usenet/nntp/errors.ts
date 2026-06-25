/**
 * Error taxonomy for the NNTP/usenet engine. The failover and service layers
 * branch on these.
 */
export type NntpErrorKind =
  /** Article missing on this provider (430): content-level, try elsewhere. */
  | 'article_not_found'
  /** Authentication rejected (480/481): bad credentials, provider-level, terminal. */
  | 'auth_failed'
  /**
   * Provider connection limit reached (482/502 "too many connections"):
   * transient backpressure, retryable. NOT a credential failure: the provider
   * is healthy and serving, we've just hit our account's connection ceiling, so
   * the pool throttles its own concurrency and retries rather than latching the
   * provider dead.
   */
  | 'connection_limit'
  /** Connection/socket/timeout problem: transient, retryable. */
  | 'connection'
  /** Command/timeout while reading a response: transient, retryable. */
  | 'timeout'
  /** Group selection failed (411): usually content-level. */
  | 'no_such_group'
  /** Unexpected protocol response. */
  | 'protocol'
  /** No providers configured/available. */
  | 'no_providers';

export class NntpError extends Error {
  readonly kind: NntpErrorKind;
  /** NNTP numeric status code, when one was received. */
  readonly code?: number;
  /** Human-friendly provider label (display name, falling back to the id). */
  readonly provider?: string;
  cause?: unknown;

  constructor(
    kind: NntpErrorKind,
    message: string,
    opts: { code?: number; provider?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'NntpError';
    this.kind = kind;
    this.code = opts.code;
    this.provider = opts.provider;
    if (opts.cause !== undefined) this.cause = opts.cause;
    if (Error.captureStackTrace) Error.captureStackTrace(this, NntpError);
  }
}

/**
 * Raised when content is missing on ALL providers (every provider returned
 * 430 / not found). Distinct from {@link NntpError} so the failover layer can
 * treat it as a definitive "this NZB is dead" signal (and optionally persist it
 * as known-dead).
 */
export class ArticleNotFoundError extends Error {
  readonly messageId?: string;
  /** True when ALL providers (including backups) reported 430. */
  readonly allProviders: boolean;

  constructor(
    message: string,
    opts: { messageId?: string; allProviders?: boolean } = {}
  ) {
    super(message);
    this.name = 'ArticleNotFoundError';
    this.messageId = opts.messageId;
    this.allProviders = opts.allProviders ?? false;
    if (Error.captureStackTrace)
      Error.captureStackTrace(this, ArticleNotFoundError);
  }
}

/**
 * A transient error is one worth retrying (connection / timeout / connection
 * limit). A connection-limit hit is transient backpressure: the same request
 * succeeds once the pool stops dialing past the account ceiling.
 */
export function isTransientNntpError(err: unknown): boolean {
  if (err instanceof NntpError) {
    return (
      err.kind === 'connection' ||
      err.kind === 'timeout' ||
      err.kind === 'connection_limit'
    );
  }
  return false;
}

/**
 * Whether an error means "we could not reach/authenticate the provider" (as
 * opposed to "the provider answered that the content is missing/undecodable").
 * Used by inspect + the library so a transport/capacity problem fails an import
 * *retryably* instead of mislabeling articles as missing or poisoning the entry.
 */
export function isProviderUnavailableError(err: unknown): boolean {
  return (
    err instanceof NntpError &&
    (err.kind === 'connection_limit' ||
      err.kind === 'auth_failed' ||
      err.kind === 'no_providers' ||
      err.kind === 'connection' ||
      err.kind === 'timeout')
  );
}

/**
 * Recognise a *credential* rejection by its message text
 */
export function isCredentialRejectionText(text: string): boolean {
  return /invalid\s+(?:user|username|login|password|credential)s?|bad\s+(?:user|username|password|credential)s?|incorrect\s+(?:user|username|password)|wrong\s+(?:user|username|password)|authenticat(?:ion|e)\s+(?:failed|rejected|invalid)|auth(?:entication)?\s+failure/i.test(
    text
  );
}

/**
 * Recognise a "too many connections" / connection-limit response.
 */
export function isConnectionLimitResponse(code: number, text: string): boolean {
  if (
    /too many connection|connection limit|max(?:imum)?[^.]*connection|exceed[^.]*connection|too many[^.]*stream/i.test(
      text
    )
  ) {
    return true;
  }
  if (isCredentialRejectionText(text)) return false;
  return code === 482 || code === 502;
}

/** Map an NNTP status code to an error kind for thrown responses. */
export function classifyNntpStatus(code: number): NntpErrorKind {
  switch (code) {
    case 430: // no such article
    case 423: // no such article number in group
      return 'article_not_found';
    case 411: // no such group
      return 'no_such_group';
    case 480: // authentication required
    case 481: // authentication failed/rejected (bad credentials)
      return 'auth_failed';
    case 482: // commonly "too many connections" (RFC: auth out of sequence)
    case 502: // commonly "too many connections" / service unavailable
      return 'connection_limit';
    default:
      return 'protocol';
  }
}
