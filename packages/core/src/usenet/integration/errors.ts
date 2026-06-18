import { DebridError } from '../../debrid/base.js';
import {
  ArticleNotFoundError,
  NotStreamableError,
  type ArchiveErrorCode,
  type NzbContent,
} from '../index.js';

const ARCHIVE_REASONS: Record<ArchiveErrorCode, string> = {
  archive_compressed: 'Archive is compressed: not streamable',
  archive_encrypted: 'Archive is encrypted: not streamable',
  archive_bad_password: 'Archive password is incorrect',
  archive_solid: 'Archive is solid: not streamable',
  archive_nested: 'Nested archive (disabled)',
  archive_unsupported: 'Archive type not supported',
  archive_no_video: 'No streamable video found in archive',
  archive_disabled: 'Archived results are disabled',
  archive_incomplete: 'Archive volumes missing or unreadable: not streamable',
};

/**
 * Classify why an inspected NZB yielded no streamable files. Missing articles
 * (incomplete or removed on every provider) get a dedicated code + message so
 * the dashboard can distinguish "gone from usenet" from "present but not
 * streamable" (encrypted/compressed/solid archives, or simply no video).
 */
export function classifyNoStreamable(content: NzbContent): {
  reason: string;
  code: string;
} {
  const total = content.files.length;
  const missing = content.files.filter(
    (f) => f.error === 'article_not_found'
  ).length;
  if (missing > 0) {
    return {
      reason:
        missing >= total
          ? 'Missing on all providers: incomplete or removed'
          : `Missing on providers: ${missing}/${total} files unavailable (incomplete or removed)`,
      code: 'missing_on_providers',
    };
  }
  // Articles present but not decodable (broken yEnc part headers, uuencode-era
  // posts): name the real problem instead of "no streamable files".
  const decodeFailed = content.files.filter(
    (f) => f.error === 'decode_failed'
  ).length;
  if (decodeFailed > 0 && decodeFailed * 2 >= total) {
    return {
      reason:
        'Articles are malformed or not yEnc encoded: encoding not supported',
      code: 'unsupported_encoding',
    };
  }
  // The archive parsed but its only candidates have fragment-map gaps
  // (truncated post / unreadable volumes): say that, not "no files".
  const incomplete = content.files.some((f) =>
    f.archiveInner?.some((i) => i.reason === 'archive_incomplete')
  );
  if (incomplete) {
    return {
      reason: 'Archive incomplete: volumes missing from the post',
      code: 'incomplete_archive',
    };
  }
  // Encrypted RAR5/7z: a supplied password that didn't match ranks above a
  // missing password (more actionable for the user).
  const hasInnerReason = (reason: ArchiveErrorCode): boolean =>
    content.files.some((f) => f.archiveInner?.some((i) => i.reason === reason));
  if (hasInnerReason('archive_bad_password')) {
    return {
      reason: 'Archive password is incorrect',
      code: 'bad_password',
    };
  }
  if (hasInnerReason('archive_encrypted')) {
    return {
      reason: 'Archive is encrypted: password required',
      code: 'archive_encrypted',
    };
  }
  return { reason: 'No streamable files in NZB', code: 'no_streamable_files' };
}

/**
 * If import-time availability sampling found a sampled segment missing on every
 * provider, the chosen video would die mid-playback; surface it as a
 * definitive `missing_on_providers` failure rather than letting playback start
 * and stall.
 */
export function classifyAvailability(
  content: NzbContent
): { reason: string; code: string } | undefined {
  const a = content.availability;
  if (!a || a.missing <= 0) return undefined;
  return {
    reason: `Missing on providers: ${a.missing}/${a.sampled} sampled segments unavailable (incomplete or removed)`,
    code: 'missing_on_providers',
  };
}

/** Map an engine error onto a user-friendly reason + machine code. */
export function friendlyUsenetError(err: unknown): {
  reason: string;
  code: string;
} {
  if (err instanceof NotStreamableError) {
    return { reason: ARCHIVE_REASONS[err.code] ?? err.message, code: err.code };
  }
  if (err instanceof ArticleNotFoundError) {
    return {
      reason: 'Missing on all providers (incomplete or removed)',
      code: 'article_not_found',
    };
  }
  return {
    reason: err instanceof Error ? err.message : 'Inspection failed',
    code: 'inspect_failed',
  };
}

/** Map an engine/transport error onto a {@link DebridError}. */
export function toDebridError(err: unknown): DebridError {
  if (err instanceof DebridError) return err;
  if (err instanceof ArticleNotFoundError) {
    return new DebridError('article not found on any provider', {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NOT_FOUND',
      headers: {},
      body: null,
      type: 'upstream_error',
      cause: err,
    });
  }
  return new DebridError(
    err instanceof Error ? err.message : 'usenet inspection failed',
    {
      statusCode: 502,
      statusText: 'Bad Gateway',
      code: 'BAD_GATEWAY',
      headers: {},
      body: null,
      type: 'upstream_error',
      cause: err,
    }
  );
}
