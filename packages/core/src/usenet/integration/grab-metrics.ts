import {
  UsenetIndexerMetricsRepository,
  type UsenetIndexerGrabDelta,
} from '../../db/index.js';
import { GrabHttpError, NotAnNzbError } from '../../utils/download-manager.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('usenet/grab-metrics');

export const MANUAL_INDEXER_LABEL = 'Manual';

const MAX_LABEL_LENGTH = 64;
const MAX_ERROR_MESSAGE_LENGTH = 200;

/**
 * Attribution label for a grab: the search-time indexer name when the stream
 * URL carried one, else the NZB URL's hostname (real attribution for *arr →
 * SABnzbd `addurl` adds), else `Manual` (uploads / `local-nzb://`).
 */
export function indexerLabelFor(indexer?: string, nzbUrl?: string): string {
  const named = indexer?.trim();
  if (named) return named.slice(0, MAX_LABEL_LENGTH);
  if (nzbUrl) {
    try {
      const url = new URL(nzbUrl);
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.hostname
      ) {
        return url.hostname.slice(0, MAX_LABEL_LENGTH);
      }
    } catch {
      // not a URL; fall through to Manual
    }
  }
  return MANUAL_INDEXER_LABEL;
}

/** Walk an error's cause chain for the HTTP status of a failed NZB grab. */
export function grabHttpStatus(err: unknown): number | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur instanceof Error; depth++) {
    if (cur instanceof GrabHttpError) return cur.status;
    if (cur instanceof NotAnNzbError) return cur.status;
    cur = cur.cause;
  }
  return undefined;
}

/**
 * Deepest cause message of a grab failure — `fetchNzb` wraps transport errors
 * in a generic DebridError, so the root cause carries the useful text.
 */
export function grabErrorMessage(err: unknown): string {
  let cur: unknown = err;
  let message = String(err);
  for (let depth = 0; depth < 5 && cur instanceof Error; depth++) {
    if (cur.message) message = cur.message;
    cur = cur.cause;
  }
  return message;
}

const MISSING_CODES = new Set(['missing_on_providers', 'article_not_found']);

export interface GrabOutcome {
  indexer: string;
  outcome: 'ok' | 'degraded' | 'failed';
  errorCode?: string;
  /** HTTP status of a failed .nzb download. */
  httpStatus?: number;
  /** Concrete failure text persisted as the indexer's last error. */
  errorMessage?: string;
  grabMs?: number;
  importMs?: number;
}

/** Map a concluded grab attempt onto its rollup delta. */
export function grabOutcomeDelta(o: GrabOutcome): UsenetIndexerGrabDelta {
  const failed = o.outcome === 'failed' ? 1 : 0;
  const fetchFailed = failed && o.errorCode === 'nzb_fetch_failed' ? 1 : 0;
  return {
    indexer: o.indexer,
    ok: o.outcome === 'ok' ? 1 : 0,
    degraded: o.outcome === 'degraded' ? 1 : 0,
    failed,
    failedMissing:
      failed && o.errorCode && MISSING_CODES.has(o.errorCode) ? 1 : 0,
    failedFetch: fetchFailed,
    fetchAuth:
      fetchFailed && (o.httpStatus === 401 || o.httpStatus === 403) ? 1 : 0,
    fetchLimited: fetchFailed && o.httpStatus === 429 ? 1 : 0,
    grabMs: o.grabMs,
    importMs: o.importMs,
  };
}

/**
 * Record one concluded grab attempt into the per-indexer rollup.
 */
export function recordGrabOutcome(o: GrabOutcome): void {
  const delta = grabOutcomeDelta(o);
  UsenetIndexerMetricsRepository.record(delta).catch((err) =>
    logger.warn({ err, indexer: o.indexer }, 'failed to record grab outcome')
  );
  if (delta.failedFetch && o.errorMessage) {
    UsenetIndexerMetricsRepository.setLastError(o.indexer, {
      status: o.httpStatus,
      message: o.errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    }).catch((err) =>
      logger.warn({ err, indexer: o.indexer }, 'failed to record grab error')
    );
  }
}
