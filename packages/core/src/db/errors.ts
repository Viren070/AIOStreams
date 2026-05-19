export type DbErrorKind =
  | 'unique-violation'
  | 'fk-violation'
  | 'not-found'
  | 'connection'
  | 'unknown';

export class DbError extends Error {
  readonly kind: DbErrorKind;
  readonly cause?: unknown;

  constructor(kind: DbErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'DbError';
    this.kind = kind;
    this.cause = cause;
  }
}

export function classifyPgError(err: unknown): DbErrorKind {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === '23505') return 'unique-violation';
  if (code === '23503') return 'fk-violation';
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT'
  ) {
    return 'connection';
  }
  return 'unknown';
}

export function classifySqliteError(err: unknown): DbErrorKind {
  const code = (err as { code?: string } | undefined)?.code;
  if (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  ) {
    return 'unique-violation';
  }
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'fk-violation';
  return 'unknown';
}
