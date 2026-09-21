/**
 * The failure vocabulary a provider speaks. Each adapter maps it outward to
 * its own codes (404 vs `NFS4ERR_NOENT` vs `ENOENT`); nothing protocol-shaped
 * crosses this boundary in either direction.
 */
export type ShareErrorCode =
  | 'NotFound'
  | 'NotPermitted'
  | 'Unavailable'
  | 'IoError';

export class ShareError extends Error {
  readonly code: ShareErrorCode;

  constructor(
    code: ShareErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ShareError';
    this.code = code;
  }

  /** Coerce whatever a backend threw; HTTP-shaped errors map by status. */
  static from(err: unknown): ShareError {
    if (err instanceof ShareError) return err;
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { statusCode?: unknown })?.statusCode;
    if (typeof status === 'number') {
      return new ShareError(codeForStatus(status), message, { cause: err });
    }
    return new ShareError('IoError', message, { cause: err });
  }
}

function codeForStatus(status: number): ShareErrorCode {
  if (status === 404 || status === 410) return 'NotFound';
  if (status === 401 || status === 403) return 'NotPermitted';
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return 'Unavailable';
  }
  return 'IoError';
}

export function shareErrorHttpStatus(code: ShareErrorCode): number {
  switch (code) {
    case 'NotFound':
      return 404;
    case 'NotPermitted':
      return 403;
    case 'Unavailable':
      return 503;
    case 'IoError':
      return 502;
    default:
      return assertNever(code);
  }
}

export function assertNever(value: never): never {
  throw new Error(`unhandled case: ${String(value)}`);
}
