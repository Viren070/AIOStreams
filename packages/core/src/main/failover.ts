import { createLogger } from '../utils/index.js';
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

/** One attempt the orchestrator can race or sequence. */
export interface FailoverAttempt {
  resolve: (signal?: AbortSignal) => Promise<string | undefined>;
  label?: string;
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
}

export interface RunPlayChainResult {
  url?: string;
  error?: Error;
  /** True if any attempt beyond the first was used / failed over. */
  failedOver: boolean;
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
  let failedOver = false;
  for (let i = 0; i < attempts.length; i++) {
    const isLast = i === attempts.length - 1;
    try {
      const url = await attempts[i].resolve();
      return { url, failedOver: failedOver || i > 0 };
    } catch (err: any) {
      const retryable = isFailoverRetryableError(err);
      if (!retryable || isLast) {
        return { error: err, failedOver };
      }
      failedOver = true;
      logger.warn(
        { attempt: i, code: err?.code, message: err?.message },
        'failover attempt failed; trying next'
      );
    }
  }
  return { failedOver };
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
    let best: { index: number; url: string | undefined } | null = null;
    let settled = false;
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
    function finishWin(b: { index: number; url: string | undefined }) {
      if (settled) return;
      settled = true;
      clearTimers();
      for (let i = 0; i < controllers.length; i++) {
        if (i !== b.index) controllers[i]?.abort();
      }
      resolve({ url: b.url, failedOver: b.index > 0 });
    }

    function finishFail() {
      if (settled) return;
      settled = true;
      clearTimers();
      for (const c of controllers) c?.abort();
      resolve({ error: pickError(errors), failedOver: launched > 1 });
    }

    function onDeadline() {
      if (settled) return;
      if (best) finishWin(best);
      else finishFail();
    }

    // Is a higher-priority (lower-index) attempt still in flight? All indices
    // below `idx` have been launched (we launch sequentially), so "pending" =
    // launched but not yet settled.
    function hasLowerPending(idx: number): boolean {
      for (let j = 0; j < idx; j++) {
        if (!succeeded.has(j) && !failed.has(j)) return true;
      }
      return false;
    }

    function maybeAccept() {
      if (settled || !best) return;
      if (!hasLowerPending(best.index)) {
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
          succeeded.add(i);
          if (!best || i < best.index) best = { index: i, url };
          maybeAccept();
        },
        (err: Error) => {
          active--;
          failed.add(i);
          errors.push(err);
          if (settled) return;
          // A lower-index failure can unblock accepting the current best.
          maybeAccept();
          if (settled) return;
          if (best === null) {
            launchNext();
            if (active === 0 && launched >= attempts.length) finishFail();
          }
        }
      );

      // Stagger the next launch; failures above launch immediately instead.
      if (
        best === null &&
        launched < attempts.length &&
        active < cfg.parallel
      ) {
        if (cfg.staggerMs > 0) {
          staggerTimer = setTimeout(launchNext, cfg.staggerMs);
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
