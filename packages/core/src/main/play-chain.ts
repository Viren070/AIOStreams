import { Cache, appConfig, createLogger } from '../utils/index.js';
import { ParsedStream } from '../db/schemas.js';
import { DebridError } from '../debrid/base.js';
import {
  buildFallbackKey,
  encodeFallbackKey,
  setPlaybackFallbackKey,
  PLAYBACK_PATH_PREFIX,
} from '../debrid/utils.js';

const logger = createLogger('failover');

export type FailoverContentType = 'usenet' | 'debrid';

/** One link in an ordered failover chain (an AIOStreams-owned playback URL). */
export interface PlayChainItem {
  /** Owned playback URL carrying the placeholder fallback key. */
  url: string;
  type: FailoverContentType;
  serviceId?: string;
  filename?: string;
  /** Addon name that produced this stream (e.g. 'TorBox', 'Easynews'). */
  addonName?: string;
}

/** What we persist per chain so the resolver can slice + filter it on click. */
export interface PlayChainRecord {
  items: PlayChainItem[];
  contentTypes: FailoverContentType[];
  allowCrossType: boolean;
  /** Orchestration config snapshot (the public route has no userData). */
  parallel: number;
  staggerMs: number;
  preferredGraceMs: number;
  maxWaitMs: number;
}

/** Build-time options derived from the user's `failover` config. */
export interface BuildPlayChainOptions {
  contentTypes: FailoverContentType[];
  allowCrossType: boolean;
  /** Chain depth carried in each item's fallback key. */
  count: number;
  parallel: number;
  staggerMs: number;
  preferredGraceMs: number;
  maxWaitMs: number;
}

function chainCache() {
  return Cache.getInstance<string, PlayChainRecord>(
    'play-chain',
    1_000_000_000,
    appConfig.bootstrap.redisUri ? 'redis' : 'sql'
  );
}

/**
 * A stream is an eligible failover participant if:
 * - WE own its playback (URL contains PLAYBACK_PATH_PREFIX) so we can
 *   `resolve()` it, OR
 * - It is a debrid stream with any URL (we redirect to the raw URL directly).
 * Usenet streams without a playback URL are skipped because they need the
 * full resolve pipeline (nzb download, yenc decode).
 */
function isEligibleForChain(
  s: ParsedStream
): s is ParsedStream & { url: string; type: FailoverContentType } {
  if (!s.url) return false;
  // Owned playback URLs we can resolve (usenet + debrid)
  if (s.url.includes(PLAYBACK_PATH_PREFIX) && (s.type === 'usenet' || s.type === 'debrid')) {
    return true;
  }
  // Debrid streams with a raw URL — use directly without resolve
  if (s.type === 'debrid') {
    return true;
  }
  return false;
}

/** Content-stable-ish identity for the chain cache key. */
function streamIdentity(s: ParsedStream): string {
  if (s.type === 'usenet') return s.nzbUrl ?? s.url ?? '';
  return s.torrent?.infoHash ?? s.url ?? '';
}

/**
 * Build and persist an ordered failover chain across the (already sorted)
 * eligible results, and stamp each result's playback URL with its position in
 * that chain. Replaces the old NZB-only `populateNzbFallbacks`.
 */
export async function buildPlayChain(
  streams: ParsedStream[],
  opts: BuildPlayChainOptions,
  uuid?: string
): Promise<void> {
  const eligible = streams.filter(isEligibleForChain);
  if (eligible.length < 2) {
    return;
  }

  const items: PlayChainItem[] = eligible.map((s) => ({
    url: s.url,
    type: s.type,
    serviceId: s.service?.id,
    filename: s.filename,
    addonName: s.addon?.name,
  }));

  const listKey = buildFallbackKey(
    uuid,
    eligible.map(streamIdentity).join('|')
  );
  const record: PlayChainRecord = {
    items,
    contentTypes: opts.contentTypes,
    allowCrossType: opts.allowCrossType,
    parallel: opts.parallel,
    staggerMs: opts.staggerMs,
    preferredGraceMs: opts.preferredGraceMs,
    maxWaitMs: opts.maxWaitMs,
  };
  await chainCache().set(
    listKey,
    record,
    appConfig.builtins.debrid.playbackLinkValidity
  );

  logger.debug(
    { listKey, items: items.length, contentTypes: opts.contentTypes },
    'stored play chain'
  );

  // Stamp each eligible URL with its chain position. Items whose type/cross-type
  // filtering leaves no targets simply resolve to an empty slice (no failover).
  for (let i = 0; i < eligible.length; i++) {
    eligible[i].url = setPlaybackFallbackKey(
      eligible[i].url,
      encodeFallbackKey(i, opts.count, listKey)
    );
  }
}

export interface ResolvedPlayChain {
  /** Failover targets ranked after the clicked item (already filtered). */
  items: PlayChainItem[];
  parallel: number;
  staggerMs: number;
  preferredGraceMs: number;
  maxWaitMs: number;
}

/**
 * Resolve the failover targets for a clicked item: the items ranked after it,
 * filtered by the user's content-type allowlist and (unless cross-type is
 * enabled) restricted to the clicked item's own kind. Also returns the
 * orchestration config snapshot stored with the chain.
 */
export async function getPlayChain(
  decoded: { index: number; count: number; listKey: string },
  clickedType: FailoverContentType
): Promise<ResolvedPlayChain | undefined> {
  const record = await chainCache().get(decoded.listKey);
  if (!record) return undefined;
  const after = record.items.slice(decoded.index + 1);
  const items = after
    .filter(
      (it) =>
        record.contentTypes.includes(it.type) &&
        (record.allowCrossType || it.type === clickedType)
    )
    .slice(0, decoded.count);
  return {
    items,
    parallel: record.parallel,
    staggerMs: record.staggerMs,
    preferredGraceMs: record.preferredGraceMs,
    maxWaitMs: record.maxWaitMs,
  };
}

/**
 * Whether a resolve error warrants moving on to the next chain item. Auth /
 * quota / legal failures are terminal for that service, so they stop the chain.
 */
export function isFailoverRetryableError(error: DebridError | Error): boolean {
  const code = (error as any).code;
  switch (code) {
    case 'UNAUTHORIZED':
    case 'FORBIDDEN':
    case 'TOO_MANY_REQUESTS':
    case 'PAYMENT_REQUIRED':
    case 'STORE_LIMIT_EXCEEDED':
    case 'UNAVAILABLE_FOR_LEGAL_REASONS':
    case 'NOT_IMPLEMENTED':
      return false;
    default:
      return true;
  }
}
