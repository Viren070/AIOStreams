import { Cache, appConfig, createLogger } from '../utils/index.js';
import { ParsedStream, StreamProxyConfig } from '../db/schemas.js';
import { DebridError } from '../debrid/base.js';
import { shouldProxyStream } from '../streams/proxifier.js';
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
  /** Whether a URL resolved from this item should be proxied. */
  proxied?: boolean;
  /**
   * 'owned' = an AIOStreams playback URL re-resolved in-process (default).
   * 'external' = a non-owned addon debrid URL resolved by probing.
   */
  kind?: 'owned' | 'external';
  /**
   * Same-release alternative sources. Tried at the SAME rank as this item,
   * so they bypass the preferred-grace window (a duplicate isn't a worse release).
   */
  variants?: PlayChainItem[];
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
  /** Proxy config snapshot so the public route can wrap a resolved URL. */
  proxyConfig?: StreamProxyConfig;
  /** Max same-release variant attempts per release. 0 disables. */
  sameReleaseLimit: number;
  /** Delay between launching same-release variant attempts (ms). */
  duplicateStaggerMs: number;
}

/** Build-time options derived from the user's `failover` config. */
export interface BuildPlayChainOptions {
  contentTypes: FailoverContentType[];
  allowCrossType: boolean;
  /** Max total failover attempts, carried in each item's fallback key. */
  maxAttempts: number;
  parallel: number;
  staggerMs: number;
  preferredGraceMs: number;
  maxWaitMs: number;
  /** User proxy config, used to decide which items' resolved URLs to proxy. */
  proxyConfig?: StreamProxyConfig;
  /** Include non-owned addon debrid URLs (probed) as failover targets. */
  includeExternal?: boolean;
  /** Max same-release variant attempts per release. 0 disables. */
  sameReleaseLimit: number;
  /** Delay between launching same-release variant attempts (ms). */
  duplicateStaggerMs: number;
}

function chainCache() {
  return Cache.getInstance<string, PlayChainRecord>(
    'play-chain',
    1_000_000_000,
    appConfig.bootstrap.redisUri ? 'redis' : 'sql'
  );
}

/**
 * A stream is an eligible failover participant only if WE own its playback —
 * i.e. its URL is one we generated via {@link generatePlaybackUrl}. Arbitrary
 * external addon URLs are skipped because we cannot `resolve()` them.
 */
function isOwnedPlayback(
  s: ParsedStream
): s is ParsedStream & { url: string; type: FailoverContentType } {
  return (
    !!s.url &&
    s.url.includes(PLAYBACK_PATH_PREFIX) &&
    (s.type === 'usenet' || s.type === 'debrid')
  );
}

/**
 * A non-owned addon debrid URL that may be used as a failover target. It must
 * be a `debrid` stream, not one of our own playback URLs, and live
 * on the source addon's own host (so probing only hits addon-owned endpoints).
 */
export function isExternalDebridFailover(
  s: ParsedStream
): s is ParsedStream & { url: string } {
  if (!s.url || s.type !== 'debrid' || s.url.includes(PLAYBACK_PATH_PREFIX)) {
    return false;
  }
  try {
    const manifestUrl = s.addon.manifestUrl.replace('stremio://', 'https://');
    return new URL(s.url).host === new URL(manifestUrl).host;
  } catch {
    return false;
  }
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
  // Preserve sorted order; the clicked item's index into this list is what its
  // fallback key encodes. Owned items are re-resolved in-process; external items
  // (when enabled) are probed.
  const eligible = streams.filter(
    (s) =>
      isOwnedPlayback(s) ||
      (opts.includeExternal && isExternalDebridFailover(s))
  );
  if (eligible.length < 2) {
    logger.debug(
      { uuid, eligible: eligible.length, total: streams.length },
      'no play chain built: fewer than 2 streams eligible for failover'
    );
    return;
  }

  const items: PlayChainItem[] = eligible.map((s) => {
    const variants: PlayChainItem[] = (s.failoverVariants ?? [])
      .filter((v) => opts.contentTypes.includes(v.type))
      .map((v) => ({
        url: v.url,
        type: v.type,
        serviceId: v.serviceId,
        filename: v.filename,
        proxied: v.proxied,
        kind: v.kind ?? 'owned',
      }));
    return {
      url: s.url!,
      type: (s.type === 'usenet' ? 'usenet' : 'debrid') as FailoverContentType,
      serviceId: s.service?.id,
      filename: s.filename,
      proxied: shouldProxyStream(s, opts.proxyConfig),
      kind: isOwnedPlayback(s) ? 'owned' : 'external',
      variants: variants.length ? variants : undefined,
    };
  });

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
    proxyConfig: opts.proxyConfig?.enabled ? opts.proxyConfig : undefined,
    sameReleaseLimit: opts.sameReleaseLimit,
    duplicateStaggerMs: opts.duplicateStaggerMs,
  };
  await chainCache().set(
    listKey,
    record,
    appConfig.builtins.debrid.playbackLinkValidity,
    true
  );

  logger.debug(
    { listKey, items: items.length, contentTypes: opts.contentTypes },
    'stored play chain'
  );

  // Stamp each owned eligible URL with its chain position. External items carry no
  // fallback key and are not controlled by us, so they can be failover targets but
  // a direct click on one won't fail over. Items whose type/cross-type filtering
  // leaves no targets simply resolve to an empty slice (no failover).
  for (let i = 0; i < eligible.length; i++) {
    const url = eligible[i].url;
    if (items[i].kind !== 'owned' || !url) continue;
    eligible[i].url = setPlaybackFallbackKey(
      url,
      encodeFallbackKey(i, opts.maxAttempts, listKey)
    );
  }
}

/** One resolved failover attempt: a chain item plus its execution metadata. */
export interface ResolvedFallback extends PlayChainItem {
  /**
   * Failover rank: same-release alternatives share a rank (grace-bypassed),
   * distinct releases get increasing ranks. The clicked item is rank 0, so its
   * same-release variants are rank 0 too.
   */
  rank: number;
  /** True for a same-release alternative source (vs the primary of its release). */
  isVariant: boolean;
}

export interface ResolvedPlayChain {
  /**
   * Ordered, de-duplicated, `maxAttempts`-capped failover targets to try after
   * the clicked item. All filtering and capping is done here so the route can map
   * straight to attempts.
   */
  fallbacks: ResolvedFallback[];
  parallel: number;
  staggerMs: number;
  preferredGraceMs: number;
  maxWaitMs: number;
  /** Proxy config snapshot for wrapping resolved URLs. */
  proxyConfig?: StreamProxyConfig;
  /** Whether a URL resolved from the clicked item should be proxied. */
  clickedProxied?: boolean;
  /** Delay between launching same-release variant attempts (ms). */
  duplicateStaggerMs: number;
}

/** Stable identity of a resolvable target, ignoring the display-only fallback-key
 *  segment of owned playback URLs. (Inlined here to avoid importing failover.ts,
 *  which would create a cycle.) */
function targetIdentity(it: PlayChainItem): string {
  if (it.kind === 'external') return `ext|${it.url}`;
  const idx = it.url.indexOf(PLAYBACK_PATH_PREFIX);
  if (idx === -1) return `raw|${it.url}`;
  // {storeAuth}/{fallbackKey}/{fileInfo}/{metadataId}/{filename} — ignore [1].
  const seg = it.url.slice(idx + PLAYBACK_PATH_PREFIX.length).split('/');
  if (seg.length < 5) return `raw|${it.url}`;
  return `own|${seg[0]}|${seg[2]}|${seg[3]}|${seg[4]}`;
}

/**
 * Resolve the failover targets for a clicked item into a single ordered list,
 * ready for the route to map to attempts. Applies, in one place: content-type /
 * cross-type filtering, per-release variant capping (`sameReleaseLimit`),
 * de-duplication by resolvable target (so a release surviving dedup or harvested
 * under multiple winners is never tried twice), and the overall `maxAttempts` cap
 * — done last so dedup never shrinks the effective budget.
 */
export async function getPlayChain(
  decoded: { index: number; count: number; listKey: string },
  clickedType: FailoverContentType
): Promise<ResolvedPlayChain | undefined> {
  const record = await chainCache().get(decoded.listKey);
  if (!record) {
    logger.warn(
      { listKey: decoded.listKey, index: decoded.index },
      'no play chain found for fallback key (cache miss or expired); failover unavailable'
    );
    return undefined;
  }
  const passesFilter = (it: PlayChainItem): boolean =>
    record.contentTypes.includes(it.type) &&
    (record.allowCrossType || it.type === clickedType);

  const maxAttempts = decoded.count;
  const clickedItem = record.items[decoded.index];
  // Seed with the clicked target so it can't be re-queued as a variant/item.
  const seen = new Set<string>();
  if (clickedItem) seen.add(targetIdentity(clickedItem));

  const fallbacks: ResolvedFallback[] = [];

  /** Add up to `sameReleaseLimit` fresh same-release variants at `rank`. */
  const addVariants = (
    vs: PlayChainItem[] | undefined,
    rank: number
  ): void => {
    let perRelease = 0;
    for (const v of vs ?? []) {
      if (fallbacks.length >= maxAttempts || perRelease >= record.sameReleaseLimit)
        return;
      if (!passesFilter(v)) continue;
      const key = targetIdentity(v);
      if (seen.has(key)) continue;
      seen.add(key);
      fallbacks.push({ ...v, rank, isVariant: true });
      perRelease++;
    }
  };

  // Rank 0: same-release alternatives of the clicked item.
  addVariants(clickedItem?.variants, 0);

  // Then each subsequent distinct release (increasing rank) + its variants.
  let rank = 1;
  for (const item of record.items.slice(decoded.index + 1)) {
    if (fallbacks.length >= maxAttempts) break;
    if (!passesFilter(item)) continue;
    const key = targetIdentity(item);
    if (seen.has(key)) continue; // already covered (e.g. as a clicked variant)
    seen.add(key);
    fallbacks.push({ ...item, rank, isVariant: false });
    addVariants(item.variants, rank);
    rank++;
  }

  if (fallbacks.length === 0 && record.items.length > 1) {
    logger.debug(
      {
        listKey: decoded.listKey,
        clickedType,
        contentTypes: record.contentTypes,
        allowCrossType: record.allowCrossType,
        items: record.items.length,
      },
      'play chain has no failover targets after filtering'
    );
  }

  return {
    fallbacks,
    parallel: record.parallel,
    staggerMs: record.staggerMs,
    preferredGraceMs: record.preferredGraceMs,
    maxWaitMs: record.maxWaitMs,
    proxyConfig: record.proxyConfig,
    clickedProxied: clickedItem?.proxied,
    duplicateStaggerMs: record.duplicateStaggerMs,
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
