import { createLogger, makeRequest } from '../utils/index.js';
import { fromUrlSafeBase64 } from '../utils/general.js';
import { decryptString } from '../utils/crypto.js';
import {
  DebridError,
  FileInfo,
  FileInfoSchema,
  PlaybackInfo,
  ServiceAuth,
  ServiceAuthSchema,
  TitleMetadata,
} from '../debrid/base.js';
import { getDebridService } from '../debrid/index.js';
import {
  metadataStore,
  fileInfoStore,
  PLAYBACK_PATH_PREFIX,
} from '../debrid/utils.js';
import { isFailoverRetryableError } from './play-chain.js';

const logger = createLogger('failover');

/** The raw, URL-borne pieces needed to resolve one owned playback item. */
export interface PlaybackTarget {
  encryptedStoreAuth: string;
  /** base64url-encoded FileInfo, or a fileInfo-store hash key. */
  fileInfoRaw: string;
  metadataId: string;
  filename: string;
}

/** Split an owned playback URL back into its resolvable pieces. */
export function parsePlaybackUrl(url: string): PlaybackTarget | undefined {
  const idx = url.indexOf(PLAYBACK_PATH_PREFIX);
  if (idx === -1) return undefined;
  const rest = url.slice(idx + PLAYBACK_PATH_PREFIX.length);
  // {storeAuth}/{fallbackKey}/{fileInfo}/{metadataId}/{filename}
  const segments = rest.split('/');
  if (segments.length < 5) return undefined;
  return {
    encryptedStoreAuth: segments[0],
    // segments[1] is the fallback key — ignored when re-resolving a target.
    fileInfoRaw: segments[2],
    metadataId: segments[3],
    filename: decodeURIComponent(segments[4]),
  };
}

function badRequest(message: string): DebridError {
  return new DebridError(message, {
    statusCode: 400,
    statusText: 'Bad Request',
    code: 'BAD_REQUEST',
    headers: {},
    body: null,
    type: 'api_error',
  });
}

/** Decode a FileInfo from a URL segment (inline base64 or store-backed hash). */
export async function decodeFileInfo(
  fileInfoRaw: string
): Promise<FileInfo | undefined> {
  try {
    return FileInfoSchema.parse(JSON.parse(fromUrlSafeBase64(fileInfoRaw)));
  } catch {
    return fileInfoStore()?.get(fileInfoRaw);
  }
}

function buildPlaybackInfo(
  fileInfo: FileInfo,
  metadata: TitleMetadata | undefined,
  filename: string
): PlaybackInfo {
  return fileInfo.type === 'torrent'
    ? {
        type: 'torrent',
        metadata,
        title: fileInfo.title,
        downloadUrl: fileInfo.downloadUrl,
        hash: fileInfo.hash,
        private: fileInfo.private,
        sources: fileInfo.sources,
        index: fileInfo.index,
        filename,
        fileIndex: fileInfo.fileIndex,
        serviceItemId: fileInfo.serviceItemId,
      }
    : {
        type: 'usenet',
        metadata,
        title: fileInfo.title,
        hash: fileInfo.hash,
        nzb: fileInfo.nzb,
        releaseKey: fileInfo.releaseKey,
        easynewsUrl: fileInfo.easynewsUrl,
        index: fileInfo.index,
        filename,
        fileIndex: fileInfo.fileIndex,
        serviceItemId: fileInfo.serviceItemId,
      };
}

/**
 * Decode + resolve a single owned playback target to a servable URL (or
 * undefined if the source is still downloading). Used uniformly for the clicked
 * item and every failover target.
 */
export async function resolvePlaybackTarget(
  target: PlaybackTarget,
  ctx: { clientIp?: string },
  signal?: AbortSignal
): Promise<string | undefined> {
  const fileInfo = await decodeFileInfo(target.fileInfoRaw);
  if (!fileInfo) {
    throw badRequest('Failed to parse file info and not found in store.');
  }

  const decrypted = decryptString(target.encryptedStoreAuth);
  if (!decrypted.success) {
    throw badRequest('Failed to decrypt store auth');
  }
  let storeAuth: ServiceAuth;
  try {
    storeAuth = ServiceAuthSchema.parse(JSON.parse(decrypted.data));
  } catch {
    throw badRequest('Failed to parse store auth');
  }

  const metadata = await metadataStore().get(target.metadataId);
  const playbackInfo = buildPlaybackInfo(fileInfo, metadata, target.filename);

  const service = getDebridService(
    storeAuth.id,
    storeAuth.credential,
    ctx.clientIp
  );
  return service.resolve(
    playbackInfo,
    target.filename,
    fileInfo.cacheAndPlay ?? false,
    fileInfo.autoRemoveDownloads,
    signal
  );
}

/**
 * Smallest body we will accept as a real release.
 */
const MIN_PLAUSIBLE_FILE_SIZE = 16 * 1024 * 1024;

/** Total size out of a `Content-Range: bytes 0-0/12345` header, when stated. */
function parseContentRangeTotal(value: string | null): number | undefined {
  const total = value?.match(/\/\s*(\d+)\s*$/)?.[1];
  return total === undefined ? undefined : Number(total);
}

/**
 * Resolve an external addon debrid URL by probing it without following redirects.
 * Heuristic: a redirect that stays on the addon's own host is probably a static
 * error video served in place of a dead link; a redirect to a different host is the
 * real debrid CDN URL (success). A 2xx video response with some content length / range heuristics
 * means the addon serves the bytes directly, so the original URL is returned. Anything else is a retryable
 * failure (a plain Error, so the chain advances to the next target).
 *
 * `ctx.clientIp` is forwarded so IP-bound CDN links resolve for the client, not the
 * server.
 */
export async function resolveExternalTarget(
  url: string,
  ctx: { clientIp?: string },
  signal?: AbortSignal
): Promise<string | undefined> {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return undefined;
    }
  })();
  logger.debug({ host }, 'probing external failover target');
  const res = await makeRequest(url, {
    timeout: 10000,
    method: 'GET',
    forwardIp: ctx.clientIp,
    signal,
    headers: { Range: 'bytes=0-0' },
    rawOptions: { redirect: 'manual' },
  });

  try {
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('Location');
      if (!location) {
        throw new Error('external target redirect had no Location header');
      }
      let sameHost = false;
      try {
        // Resolve relative redirects against the probe URL before comparing hosts.
        sameHost = new URL(location, url).host === new URL(url).host;
      } catch {
        // Unparseable Location, treat as a real (off-host) CDN URL.
      }
      if (sameHost) {
        // Redirect back onto the addon's own host, probably a static error video.
        throw new Error('external target redirected to an error video');
      }
      logger.debug({ host }, 'external target resolved to off-host redirect');
      return location;
    }

    if (res.status >= 200 && res.status < 300) {
      const contentType = res.headers.get('content-type') ?? '';
      if (
        !contentType.startsWith('video/') &&
        !contentType.startsWith('application/octet-stream')
      ) {
        throw new Error(
          `external target returned non-video response (${contentType || res.status})`
        );
      }

      if (res.status === 206) {
        const total = parseContentRangeTotal(res.headers.get('content-range'));
        if (total !== undefined && total < MIN_PLAUSIBLE_FILE_SIZE) {
          throw new Error(
            `external target served a ${total}-byte file, too small to be the release`
          );
        }
        logger.debug(
          { host, contentType, total },
          'external target serves ranged bytes; using probe url'
        );
        return url;
      }

      // 200: the server ignored our Range. A link that cannot seek is unusable for
      // playback anyway, so accept it only if it at least declares a real size.
      const lengthHeader = res.headers.get('content-length');
      const length = lengthHeader === null ? undefined : Number(lengthHeader);
      if (
        length !== undefined &&
        Number.isFinite(length) &&
        length >= MIN_PLAUSIBLE_FILE_SIZE
      ) {
        logger.debug(
          { host, contentType, length },
          'external target serves bytes directly without range support; using probe url'
        );
        return url;
      }
      throw new Error(
        `external target ignored Range and returned ${lengthHeader ?? 'an unsized'} body (${contentType}); treating as an error video`
      );
    }

    throw new Error(`external target probe failed with status ${res.status}`);
  } finally {
    // Never read the body. A server that ignores Range answers 200 with the whole
    // file, and we only ever needed the headers.
    try {
      await res.body?.cancel();
    } catch {
      // already closed
    }
  }
}

/** One attempt the orchestrator can race or sequence. */
export interface FailoverAttempt {
  resolve: (signal?: AbortSignal) => Promise<string | undefined>;
  label?: string;
  /**
   * Failover rank. Distinct releases get increasing ranks; same-release
   * variants share their parent's rank. The grace window only holds a result while
   * a STRICTLY-lower-rank attempt is still in flight, meaning a same-rank variant is
   * accepted immediately. Defaults to the array index when absent.
   */
  rank?: number;
}

export interface RunPlayChainConfig {
  /** Concurrent attempts in flight. 1 = sequential (current behaviour). */
  parallel: number;
  /** Delay before launching the next parallel attempt (ms). */
  staggerMs: number;
  /**
   * How long a ready lower-priority result is held to let a still-in-flight
   * higher-priority (lower-index) attempt catch up before being accepted.
   * 0 = first-ready wins. Only meaningful in parallel mode.
   */
  preferredGraceMs: number;
  /** Overall deadline before giving up (ms). */
  maxWaitMs: number;
  /**
   * Delay before launching the next attempt when it shares the previous attempt's
   * rank (a same-release variant). Defaults to 0 (no head-start needed).
   */
  duplicateStaggerMs?: number;
}

export interface RunPlayChainResult {
  url?: string;
  error?: Error;
  /** True if any attempt beyond the first was used / failed over. */
  failedOver: boolean;
  /** If a URL is available, this is the label of the attempt that provided it. */
  label?: string;
}

/**
 * Run the failover chain. The first attempt whose `resolve()` settles without
 * throwing wins (its URL may be undefined = "still downloading"). In sequential
 * mode a non-retryable error stops the chain immediately; in parallel mode an
 * attempt's failure just frees its slot for the next item.
 */
export async function runPlayChain(
  attempts: FailoverAttempt[],
  cfg: RunPlayChainConfig
): Promise<RunPlayChainResult> {
  if (attempts.length === 0) return { failedOver: false };
  if (cfg.parallel <= 1) return runSequential(attempts);
  return runParallel(attempts, cfg);
}

async function runSequential(
  attempts: FailoverAttempt[]
): Promise<RunPlayChainResult> {
  let sawDownloading = false;
  let lastError: Error | undefined;
  let tried = 0;
  for (let i = 0; i < attempts.length; i++) {
    tried++;
    try {
      const url = await attempts[i].resolve();
      if (url)
        return {
          url,
          failedOver: i > 0,
          label: attempts[i]?.label ?? `attempt ${i}`,
        };
      // undefined = source still downloading.
      sawDownloading = true;
      logger.warn(
        { attempt: i, label: attempts[i]?.label },
        'failover attempt still downloading; trying next for a ready result'
      );
    } catch (err: any) {
      lastError = err as Error;
      if (!isFailoverRetryableError(err)) break; // terminal for this service — stop
      logger.warn(
        { attempt: i, err, label: attempts[i]?.label },
        'failover attempt failed; trying next'
      );
    }
  }
  // No attempt produced a ready URL. Prefer reporting "downloading" over an error.
  if (sawDownloading)
    return {
      url: undefined,
      failedOver: tried > 1,
      label: attempts[tried - 1]?.label ?? `attempt ${tried - 1}`,
    };
  return { error: lastError, failedOver: tried > 1 };
}

function runParallel(
  attempts: FailoverAttempt[],
  cfg: RunPlayChainConfig
): Promise<RunPlayChainResult> {
  return new Promise<RunPlayChainResult>((resolve) => {
    const controllers: AbortController[] = [];
    const errors: Error[] = [];
    const succeeded = new Set<number>();
    const failed = new Set<number>();
    // Indices whose resolve settled as "still downloading" (undefined url). These
    // are not real wins, but are remembered so we report "downloading" over an error
    // if nothing ready arrives. They count as settled for hasLowerPending().
    const downloading = new Set<number>();
    let best: { index: number; rank: number; url: string } | null = null;
    let settled = false;
    const rankOf = (idx: number): number => attempts[idx]?.rank ?? idx;
    const labelOf = (idx: number): string =>
      attempts[idx]?.label ?? `attempt ${idx}`;
    const labelsOf = (set: Set<number>): string[] => [...set].map(labelOf);
    let launched = 0; // indices [0, launched) have been started (sequential)
    let active = 0;
    let staggerTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const deadline = setTimeout(onDeadline, cfg.maxWaitMs);

    function clearTimers() {
      clearTimeout(deadline);
      if (staggerTimer) clearTimeout(staggerTimer);
      if (graceTimer) clearTimeout(graceTimer);
    }

    // Accept a winner. Abort every OTHER attempt — a loser's signal firing is how
    // each service cleans up a discarded resolve (removeMagnet, drop the auto
    // library entry); the winner's signal must never fire.
    function finishWin(b: { index: number; url: string }) {
      if (settled) return;
      settled = true;
      clearTimers();
      for (let i = 0; i < controllers.length; i++) {
        if (i !== b.index) controllers[i]?.abort();
      }
      if (b.index > 0) {
        logger.info(
          { attempt: b.index, label: attempts[b.index]?.label },
          'failover succeeded on a lower-priority attempt'
        );
      }
      resolve({
        url: b.url,
        failedOver: b.index > 0,
        label: attempts[b.index]?.label ?? `attempt ${b.index}`,
      });
    }

    // No ready URL won. Prefer reporting "downloading" (a source is in progress)
    // over a static error video. Only report an error if nothing was downloading.
    function finishNoWinner() {
      if (settled) return;
      settled = true;
      clearTimers();
      for (const c of controllers) c?.abort();
      if (downloading.size > 0) {
        logger.warn(
          {
            attempts: launched,
            downloading: downloading.size,
            downloadingLabels: labelsOf(downloading),
          },
          'no ready failover result; reporting downloading'
        );
        resolve({
          url: undefined,
          failedOver: launched > 1,
        });
        return;
      }
      logger.warn(
        {
          attempts: launched,
          failed: failed.size,
          failedLabels: labelsOf(failed),
        },
        'all failover attempts failed'
      );
      resolve({ error: pickError(errors), failedOver: launched > 1 });
    }

    function onDeadline() {
      if (settled) return;
      logger.warn(
        {
          maxWaitMs: cfg.maxWaitMs,
          hasBest: best !== null,
          bestLabel: best ? labelOf(best.index) : undefined,
        },
        'failover deadline reached'
      );
      if (best) finishWin(best);
      else finishNoWinner();
    }

    // Is a higher-priority (strictly-lower-RANK) attempt still in flight? Same-rank
    // attempts (same-release variants) never block — that's what bypasses grace for
    // duplicates. A "downloading" outcome counts as settled.
    function hasLowerPending(rank: number): boolean {
      for (let j = 0; j < launched; j++) {
        if (succeeded.has(j) || failed.has(j) || downloading.has(j)) continue;
        if (rankOf(j) < rank) return true;
      }
      return false;
    }

    function maybeAccept() {
      if (settled || !best) return;
      if (!hasLowerPending(best.rank)) {
        // Nothing better can still arrive — take it now.
        finishWin(best);
        return;
      }
      // A preferred attempt may still win: hold this result for the grace window.
      if (!graceTimer) {
        graceTimer = setTimeout(
          () => {
            graceTimer = undefined;
            if (!settled && best) finishWin(best);
          },
          Math.max(0, cfg.preferredGraceMs)
        );
      }
    }

    function launchNext() {
      if (settled || best !== null) return; // a candidate exists → don't start new attempts
      if (launched >= attempts.length || active >= cfg.parallel) return;
      const i = launched++;
      const controller = new AbortController();
      controllers[i] = controller;
      active++;

      attempts[i].resolve(controller.signal).then(
        (url) => {
          active--;
          if (settled) return;
          if (url) {
            succeeded.add(i);
            const rank = rankOf(i);
            if (!best || rank < best.rank) best = { index: i, rank, url };
            maybeAccept();
            return;
          }
          // undefined = still downloading.
          downloading.add(i);
          logger.warn(
            { attempt: i, label: attempts[i]?.label },
            'failover attempt still downloading; continuing'
          );
          // Settling a lower index may unblock accepting the current best.
          maybeAccept();
          if (settled) return;
          if (best === null) {
            launchNext();
            if (active === 0 && launched >= attempts.length) finishNoWinner();
          }
        },
        (err: Error) => {
          active--;
          failed.add(i);
          errors.push(err);
          logger.warn(
            { attempt: i, label: attempts[i]?.label, err },
            'failover attempt failed'
          );
          if (settled) return;
          // A lower-index failure can unblock accepting the current best.
          maybeAccept();
          if (settled) return;
          if (best === null) {
            launchNext();
            if (active === 0 && launched >= attempts.length) finishNoWinner();
          }
        }
      );

      // Stagger the next launch; failures above launch immediately instead. A
      // same-rank next attempt (same-release variant) uses duplicateStaggerMs (0 by
      // default) instead of the cross-release staggerMs.
      if (
        best === null &&
        launched < attempts.length &&
        active < cfg.parallel
      ) {
        const sameRank = rankOf(launched) === rankOf(i);
        const delay = sameRank ? (cfg.duplicateStaggerMs ?? 0) : cfg.staggerMs;
        if (delay > 0) {
          staggerTimer = setTimeout(launchNext, delay);
        } else {
          launchNext();
        }
      }
    }

    launchNext();
  });
}

/** Prefer a terminal (non-retryable) DebridError so the static error is apt. */
function pickError(errors: Error[]): Error | undefined {
  if (errors.length === 0) return undefined;
  const terminal = errors.find((e) => !isFailoverRetryableError(e));
  return terminal ?? errors[errors.length - 1];
}
