import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createLogger } from '../../logging/logger.js';
import { DebridError } from '../../debrid/base.js';
import {
  ArticleNotFoundError,
  NotStreamableError,
  definitiveLossKind,
  deserializeArchiveLayout,
  serializeArchiveLayout,
  hasPendingFragments,
  HoleAccumulator,
  deserializeHoles,
  serializeHoles,
  MAX_PAD_RUN_SEGMENTS,
  MAX_PAD_RUN_BYTES,
  MAX_PAD_TOTAL_SEGMENTS,
  MAX_PAD_TOTAL_BYTES,
  MAX_PAD_FILE_BYTES_RATIO,
  HoleByteMap,
  MatroskaVoidPlan,
  wrapMatroskaHoleFill,
  type HoleHooks,
  type HoleInfo,
  type HoleDecision,
  type ArchiveStreamLayout,
  type LazyResolveHooks,
  type DataFragment,
  type SeekableStream,
  type EngineOptions,
  type ProviderConfig,
  type UsenetEngine,
} from '../index.js';
import {
  UsenetLibraryRepository,
  type UsenetLibraryEntry,
} from '../../db/index.js';
import { type UsenetStreamToken, decodeUsenetStreamToken } from './tokens.js';
import { friendlyUsenetError } from './errors.js';
import {
  markReleaseDead,
  markReleaseDeadForCode,
} from '../../release-blocklist/feedback.js';
import { nzbContentKey } from '../../release-blocklist/keys.js';
import { appConfig } from '../../utils/index.js';
import {
  streamRegistry,
  usenetTargetKey,
} from '../../stream-sessions/index.js';
import { usenetEngineRegistry, getUsenetEngineConfig } from './engine.js';
import { fetchNzb, parseNzbCached, canonicaliseNzbHash } from './library.js';
import {
  indexerLabelFor,
  recordGrabOutcome,
  grabHttpStatus,
  grabErrorMessage,
} from './grab-metrics.js';
import { noteStreamActivity, pruneStreamActivity } from './damage-policy.js';
import { condemnArrDownload } from './arr-bridge.js';

const logger = createLogger('usenet/stream');

export interface OpenedUsenetStream {
  /** Readable producing the requested byte range. */
  stream: Readable;
  /** Total decoded size of the file in bytes. */
  size: number;
  /** Inclusive start of the served range. */
  start: number;
  /** Exclusive end of the served range. */
  end: number;
  /** Best-effort filename for Content-Disposition. */
  filename: string;
  /** Strong validator for the resolved file */
  etag: string;
  /** Stable Last-Modified companion to {@link etag}. */
  lastModified: Date;
}

/**
 * Fallback `Last-Modified`
 */
const USENET_LAST_MODIFIED = new Date('2024-01-01T00:00:00Z');

/** Strong, stable ETag for a resolved stream at a known size. */
export function usenetStreamEtag(
  token: UsenetStreamToken,
  size: number
): string {
  const digest = createHash('sha1')
    .update(streamSessionKey(token))
    .digest('hex')
    .slice(0, 20);
  return `"u-${digest}-${size.toString(16)}"`;
}

/**
 * One opened, seekable file handle kept warm across the many HTTP Range
 * requests a single playback generates (players seek/resume constantly). The
 * `FileStream` itself holds no sockets; connections are leased per
 * `fetchSegment` and released, so an idle session only retains the parsed NZB
 * model + the size/segment-range index.
 */
interface UsenetStreamSession {
  stream: SeekableStream;
  size: number;
  filename: string;
  hash: string;
  lastUsedAt: number;
  lastModified: Date;
  engine: UsenetEngine;
  /** Zero-filled target-file byte ranges, shared across the range requests. */
  holeBytes: HoleByteMap;
  /** Segment-level Voids placed so far, so re-requests reproduce them. */
  voidPlan: MatroskaVoidPlan;
  /** Whether the target is a Matroska container (hole-fill eligible). */
  matroska: boolean;
}

/** Identity of a resolved (token → file) stream, independent of byte range. */
function streamSessionKey(token: UsenetStreamToken): string {
  return `${token.hash}:${token.fileIndex ?? 'auto'}:${token.innerPath ?? ''}`;
}

const streamSessions = new Map<string, UsenetStreamSession>();
/** Single-flight in-flight opens so concurrent first requests open once. */
const openingSessions = new Map<string, Promise<UsenetStreamSession>>();
/** Idle TTL for a warm session; comfortably below the 5-min engine idle evict. */
const STREAM_SESSION_IDLE_MS = 90_000;

/**
 * Serve-path guard for a release that is definitively unstreamable right now.
 */
const failingStreams = new Map<string, number>();
const FAILING_STREAM_TTL_MS = 30_000;

/** True while `key` is inside its post-failure cooldown. */
function isStreamFailing(key: string): boolean {
  const exp = failingStreams.get(key);
  if (exp === undefined) return false;
  if (exp <= Date.now()) {
    failingStreams.delete(key);
    return false;
  }
  return true;
}

/** Whether an error is a definitive "unservable by every provider" verdict. */
function isDefinitiveMiss(err: unknown): boolean {
  return definitiveLossKind(err) !== undefined;
}

const sessionEvictionTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, session] of streamSessions) {
    if (now - session.lastUsedAt > STREAM_SESSION_IDLE_MS) {
      streamSessions.delete(key);
    }
  }
  for (const [key, exp] of failingStreams) {
    if (exp <= now) failingStreams.delete(key);
  }
  pruneStreamActivity(now);
}, 30_000);
sessionEvictionTimer.unref?.();

/**
 * Load the cached archive rebuild recipe for an inner file, if one was captured
 * at inspection. Best-effort: any miss returns undefined so the caller falls
 * back to a full parse-based open.
 */
async function loadArchiveLayout(
  hash: string,
  innerPath: string
): Promise<ArchiveStreamLayout | undefined> {
  try {
    const entry = await UsenetLibraryRepository.get(hash);
    const file = entry?.files.find((f) => f.path === innerPath);
    return file?.layout ? deserializeArchiveLayout(file.layout) : undefined;
  } catch {
    return undefined;
  }
}

/** Debounce for persisting lazy-resolution progress, keyed `${hash}:${path}`. */
const layoutPatchTimers = new Map<string, NodeJS.Timeout>();
const LAYOUT_PATCH_DEBOUNCE_MS = 2_000;

/**
 * Hooks wiring a lazy (pending-fragment) layout's runtime resolution back to
 * the library entry: commits are persisted (debounced, latest-wins) so later
 * opens skip re-resolving; a structural invalidation clears the layout and
 * drops the warm session so the next open takes the full-parse path instead
 * of looping on a poisoned recipe.
 */
function lazyHooksFor(
  hash: string,
  innerPath: string,
  layout: ArchiveStreamLayout,
  sessionKey: string
): LazyResolveHooks {
  const key = `${hash}:${innerPath}`;
  return {
    onCommit: (fragments: DataFragment[]) => {
      const t = layoutPatchTimers.get(key);
      if (t) clearTimeout(t);
      const timer = setTimeout(() => {
        layoutPatchTimers.delete(key);
        const patched: ArchiveStreamLayout = {
          ...layout,
          target: { ...layout.target, fragments },
        };
        UsenetLibraryRepository.updateFileLayout(
          hash,
          innerPath,
          serializeArchiveLayout(patched)
        ).catch((err) =>
          logger.debug(
            { hash, innerPath, err: (err as Error)?.message },
            'lazy layout patch failed (re-resolves on next open)'
          )
        );
      }, LAYOUT_PATCH_DEBOUNCE_MS);
      timer.unref?.();
      layoutPatchTimers.set(key, timer);
    },
    onInvalid: (err: Error) => {
      const t = layoutPatchTimers.get(key);
      if (t) clearTimeout(t);
      layoutPatchTimers.delete(key);
      streamSessions.delete(sessionKey);
      logger.warn(
        { hash, innerPath, err: err.message },
        'lazy layout invalidated; clearing persisted layout'
      );
      UsenetLibraryRepository.updateFileLayout(hash, innerPath, null).catch(
        () => {}
      );
    },
  };
}

/** Debounce for persisting playback-discovered holes, keyed `${hash}:${sel}`. */
const holePatchTimers = new Map<string, NodeJS.Timeout>();
const HOLE_PATCH_DEBOUNCE_MS = 2_000;

/**
 * Playback hole policy owner (see `usenet/holes.ts` for the threshold table):
 * the streams ask per definitive all-providers miss and this closure decides
 * pad-vs-fail, accounts the caps, persists the hole map (debounced) and
 * transitions the library entry (`degraded` on the first pad, `failed` when a
 * cap trips).
 *
 * Plain targets account in SEGMENT space and persist runs (replays pre-pad
 * them via `knownHoles`, skipping the failover round-trip). Archive targets
 * account in WINDOW-byte space (windows span volume boundaries, so there is
 * no exact segment mapping); their persisted rows come from the census
 * shadow instead, so archive replays re-discover pads but the entry status
 * stays honest either way.
 *
 * Undecodable spans count toward the caps like any other damage but are never
 * persisted: a 430 means the article is gone, whereas a corrupt copy may well
 * decode on a provider added later.
 */
function holeHooksFor(
  hash: string,
  decoded: UsenetStreamToken,
  entry: UsenetLibraryEntry | undefined,
  sessionKey: string
): { hooks: HoleHooks; holeBytes: HoleByteMap } {
  // onHole is synchronous in the pad path, so every hole registers here
  // before its zeros reach the serving transform.
  const holeBytes = new HoleByteMap();
  // Seed with every persisted hole (idempotent adds keep replays stable).
  // `acc` drives the caps and the replay pre-pad set, so it holds damage of
  // both kinds; `persistable` is the subset written back to the entry.
  const acc = new HoleAccumulator();
  const persistable = new HoleAccumulator();
  for (const f of entry?.files ?? []) {
    if (f.holes) {
      const runs = deserializeHoles(f.holes);
      acc.load(runs);
      persistable.load(runs);
    }
  }
  const selector = decoded.innerPath
    ? { path: decoded.innerPath }
    : { index: decoded.fileIndex };
  const targetFile = entry?.files.find((f) =>
    decoded.innerPath
      ? f.path === decoded.innerPath
      : f.index === decoded.fileIndex
  );
  const targetBytes = targetFile?.size ?? 0;

  // Window-space (archive) session accounting.
  let windowRunBytes = 0;
  let windowRunEnd = -1;
  let paddedBytesTotal = 0;
  let degradedMarked = entry?.status === 'degraded';
  let sawUndecodable = false;

  const markDegraded = (): void => {
    if (degradedMarked) return;
    degradedMarked = true;
    UsenetLibraryRepository.setStatus(hash, 'degraded', {
      guard: { notIn: ['failed'] },
    }).catch(() => {});
  };

  const persistHoles = (nzbFileIndex: number): void => {
    const key = `${hash}:${selector.path ?? selector.index ?? ''}`;
    const t = holePatchTimers.get(key);
    if (t) clearTimeout(t);
    const timer = setTimeout(() => {
      holePatchTimers.delete(key);
      UsenetLibraryRepository.updateFileHoles(
        hash,
        selector,
        serializeHoles(persistable.runsForFiles(new Set([nzbFileIndex])))
      ).catch((err) =>
        logger.debug(
          { hash, err: (err as Error)?.message },
          'hole map patch failed (re-discovered on next play)'
        )
      );
    }, HOLE_PATCH_DEBOUNCE_MS);
    timer.unref?.();
    holePatchTimers.set(key, timer);
  };

  const fail = (info: HoleInfo, why: string): HoleDecision => {
    logger.warn(
      { hash, nzbFileIndex: info.nzbFileIndex, why, kind: info.kind },
      'playback hole exceeds padding caps; failing entry'
    );
    const [reason, code] = sawUndecodable
      ? [
          'Too many articles unreadable on every provider to play',
          'undecodable_on_providers',
        ]
      : [
          'Too many articles missing on every provider to play',
          'missing_on_providers',
        ];
    UsenetLibraryRepository.markFailed(
      hash,
      reason,
      decoded.filename,
      code
    ).catch(() => {});
    // Pad caps only trip on damage confirmed against every provider.
    markReleaseDead(decoded.releaseKey, nzbContentKey(hash));
    condemnArrDownload(hash, 'failed');
    // Drop the warm session so a player retry re-opens fresh and sees the
    // failed entry.
    streamSessions.delete(sessionKey);
    return 'fail';
  };

  const registerHoleBytes = (info: HoleInfo): void => {
    const off = info.targetOffset ?? info.windowOffset;
    if (off !== undefined) holeBytes.add(off, info.bytes);
  };

  const hooks: HoleHooks = {
    onHole(info: HoleInfo): HoleDecision {
      paddedBytesTotal += info.bytes;
      if (info.kind === 'undecodable') sawUndecodable = true;
      if (
        targetBytes > 0 &&
        paddedBytesTotal > MAX_PAD_FILE_BYTES_RATIO * targetBytes
      ) {
        return fail(info, 'padded-bytes share of target');
      }
      if (info.segmentIndex !== undefined) {
        // Plain path: segment space, exact run tracking, persisted map.
        acc.add(info.nzbFileIndex, info.segmentIndex);
        const run = acc.runAt(info.nzbFileIndex, info.segmentIndex);
        if ((run?.count ?? 1) > MAX_PAD_RUN_SEGMENTS) {
          return fail(info, 'consecutive unservable segments');
        }
        if (acc.total > MAX_PAD_TOTAL_SEGMENTS) {
          return fail(info, 'cumulative unservable segments');
        }
        markDegraded();
        if (info.kind === 'missing') {
          persistable.add(info.nzbFileIndex, info.segmentIndex);
          persistHoles(info.nzbFileIndex);
        }
        registerHoleBytes(info);
        return 'pad';
      }
      // Archive path: byte-window space.
      const offset = info.windowOffset ?? 0;
      windowRunBytes =
        offset === windowRunEnd ? windowRunBytes + info.bytes : info.bytes;
      windowRunEnd = offset + info.bytes;
      if (windowRunBytes > MAX_PAD_RUN_BYTES) {
        return fail(info, 'consecutive unreadable bytes');
      }
      if (paddedBytesTotal > MAX_PAD_TOTAL_BYTES) {
        return fail(info, 'cumulative unreadable bytes');
      }
      markDegraded();
      registerHoleBytes(info);
      return 'pad';
    },
    knownHoles(nzbFileIndex: number): ReadonlySet<number> | undefined {
      const set = acc.indicesForFile(nzbFileIndex);
      return set.size > 0 ? set : undefined;
    },
  };
  return { hooks, holeBytes };
}

/** Open (or reuse) the seekable handle for a resolved token. */
async function getStreamSession(
  decoded: UsenetStreamToken,
  providers: ProviderConfig[],
  options: Partial<EngineOptions>
): Promise<UsenetStreamSession> {
  const key = streamSessionKey(decoded);
  const existing = streamSessions.get(key);
  if (existing) {
    // Resolves the current engine (creating it after a provider edit) and
    // refreshes its idle clock so it isn't evicted out from under a session
    // that's serving range requests without re-entering the registry.
    const engine = usenetEngineRegistry.get(providers, options);
    if (existing.engine === engine) {
      existing.lastUsedAt = Date.now();
      logger.debug(
        { hash: decoded.hash, filename: existing.filename },
        'reused warm usenet stream session'
      );
      return existing;
    }
    // Engine swapped since this session opened (provider edit closed it, or
    // idle eviction dropped it); the session's stream is bound to the dead
    // engine's pool. Drop it and open fresh on the current engine.
    logger.debug(
      { hash: decoded.hash, filename: existing.filename },
      'dropping warm session bound to a closed engine'
    );
    streamSessions.delete(key);
  }

  const inflight = openingSessions.get(key);
  if (inflight) return inflight;

  const open = (async (): Promise<UsenetStreamSession> => {
    const startedAt = Date.now();
    // Open without the caller's request signal: a session is shared, so a
    // disconnect mid-open must not poison it for everyone (segment timeouts
    // still bound the work). Phase timings (grab/parse/open) are logged so a
    // cold-start slowdown can be attributed.
    let xml: Buffer;
    try {
      xml = await fetchNzb(decoded.nzb);
    } catch (err) {
      // Failures only: a byte-path grab usually hits the
      // grab cache, so counting successes would inflate the denominator.
      recordGrabOutcome({
        indexer: indexerLabelFor(decoded.indexer, decoded.nzb),
        outcome: 'failed',
        errorCode: 'nzb_fetch_failed',
        httpStatus: grabHttpStatus(err),
        errorMessage: grabErrorMessage(err),
      });
      throw err;
    }
    const grabbedAt = Date.now();
    // Reuses the model the resolve just parsed (same hash); parsing the same
    // multi-MB NZB twice per playback is pure waste.
    const nzb = await parseNzbCached(decoded.hash, xml);
    const parsedAt = Date.now();
    // tokens minted before the content-hash rekey carry a search-time
    // hash. Every library read/write below
    // must use the canonical hash or it would patch/poison a stray row.
    const hash = await canonicaliseNzbHash(decoded.hash, nzb, decoded.nzb);
    // Legacy tokens carry a pre-rekey hash; stickiness is keyed canonically.
    noteStreamActivity(hash);
    const engine = usenetEngineRegistry.get(providers, options);
    // Fetched up-front: seeds the hole hooks (persisted hole map → replay
    // pre-pad) and provides addedAt for Last-Modified below.
    const entry = await UsenetLibraryRepository.get(hash).catch(
      () => undefined
    );
    const { hooks: holeHooks, holeBytes } = holeHooksFor(
      hash,
      decoded,
      entry,
      key
    );

    let stream: SeekableStream | undefined;
    let filename = decoded.filename;
    try {
      // Fast path: rebuild an archive inner stream from the layout captured at
      // inspection, skipping re-fetching/parsing the archive header (and the
      // encrypted-7z AES+LZMA decode that makes cold opens of large password 7z
      // packs slow). Any miss/failure falls back to a full parse open.
      if (decoded.innerPath) {
        const layout = await loadArchiveLayout(hash, decoded.innerPath);
        if (layout) {
          try {
            const hooks = hasPendingFragments(layout.target)
              ? lazyHooksFor(hash, decoded.innerPath, layout, key)
              : undefined;
            stream = await engine.openArchiveStreamFromLayout(
              nzb,
              layout,
              undefined,
              hooks,
              holeHooks
            );
            filename = decoded.filename ?? stream.filename;
          } catch (err) {
            logger.warn(
              {
                hash,
                innerPath: decoded.innerPath,
                err: (err as Error)?.message,
              },
              'archive layout rebuild failed; falling back to full parse'
            );
            stream = undefined;
          }
        }
      }
      if (!stream) {
        if (
          decoded.fileIndex !== undefined ||
          decoded.innerPath ||
          decoded.filename
        ) {
          stream = await engine.openFileStream(
            nzb,
            {
              fileIndex: decoded.fileIndex,
              innerPath: decoded.innerPath,
              filename: decoded.filename,
            },
            undefined,
            holeHooks
          );
          filename = decoded.innerPath
            ? (decoded.filename ?? stream.filename)
            : (stream.filename ?? decoded.filename);
        } else {
          const handle = await engine.selectAndOpen(
            nzb,
            { auto: true },
            undefined,
            holeHooks
          );
          stream = handle.stream;
          filename = handle.file.filename ?? decoded.filename;
        }
      }
    } catch (err) {
      if (
        err instanceof ArticleNotFoundError ||
        err instanceof NotStreamableError
      ) {
        const friendly = friendlyUsenetError(err);
        UsenetLibraryRepository.markFailed(
          hash,
          friendly.reason,
          decoded.filename,
          friendly.code
        ).catch(() => {});
        condemnArrDownload(hash, 'failed');
        // The release exists on usenet, but a compressed/solid/unsupported
        // archive is un-streamable for everyone (global); an all-provider
        // article miss is backbone-scoped evidence.
        if (err instanceof ArticleNotFoundError && err.allProviders) {
          markReleaseDead(decoded.releaseKey, nzbContentKey(hash));
        } else if (err instanceof NotStreamableError) {
          markReleaseDeadForCode(
            err.code,
            decoded.releaseKey,
            nzbContentKey(hash)
          );
        }
      }
      throw err;
    }

    if (!stream) throw new Error('failed to open usenet stream');
    const addedAt = entry?.addedAt ? new Date(entry.addedAt) : undefined;
    const lastModified =
      addedAt && !Number.isNaN(addedAt.getTime())
        ? addedAt
        : USENET_LAST_MODIFIED;
    const session: UsenetStreamSession = {
      stream,
      size: stream.size(),
      filename,
      hash,
      lastUsedAt: Date.now(),
      lastModified,
      engine,
      holeBytes,
      voidPlan: new MatroskaVoidPlan(),
      matroska: /\.(mkv|mka|webm)$/i.test(filename ?? ''),
    };
    streamSessions.set(key, session);
    const openedAt = Date.now();
    logger.debug(
      {
        hash,
        filename,
        size: session.size,
        grabMs: grabbedAt - startedAt,
        parseMs: parsedAt - grabbedAt,
        openMs: openedAt - parsedAt,
        latency: openedAt - startedAt,
      },
      'opened native usenet stream session'
    );
    return session;
  })().finally(() => openingSessions.delete(key));

  openingSessions.set(key, open);
  return open;
}

/**
 * Core entry point for the byte-serving route: decode a stream token, open (or
 * reuse a warm) seekable handle for the selected file, and return a
 * {@link Readable} for the requested half-open byte range `[start, end)`. The
 * server route handles HTTP concerns (Range parsing, headers).
 */
export interface OpenUsenetStreamOptions {
  start?: number;
  end?: number;
  /** Serve the last N bytes (`bytes=-N`); overrides start/end. */
  suffixLength?: number;
  signal?: AbortSignal;
  /** Client address, for stream accounting. */
  clientIp?: string;
  /** Opened through the share tree (FUSE/NFS/WebDAV): no connection caps. */
  share?: boolean;
}

export async function openNativeUsenetStream(
  opts: OpenUsenetStreamOptions & { token: string }
): Promise<OpenedUsenetStream> {
  opts.signal?.throwIfAborted();
  const decoded = decodeUsenetStreamToken(opts.token);
  if (!decoded) {
    throw new DebridError('invalid or tampered usenet stream token', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'BAD_REQUEST',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }
  return openUsenetStream(decoded, opts);
}

/**
 * Open a stream for an already-decoded token. In-process callers (the WebDAV
 * provider) build the token themselves and skip the encrypted round trip.
 */
export async function openUsenetStream(
  decoded: UsenetStreamToken,
  opts: OpenUsenetStreamOptions = {}
): Promise<OpenedUsenetStream> {
  opts.signal?.throwIfAborted();
  const { providers, options } = getUsenetEngineConfig();
  if (providers.length === 0) {
    throw new DebridError('no usenet providers are configured', {
      statusCode: 503,
      statusText: 'Service Unavailable',
      code: 'SERVICE_UNAVAILABLE',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }

  const sessionKey = streamSessionKey(decoded);
  if (isStreamFailing(sessionKey)) {
    throw new DebridError(
      'this release is currently unstreamable (data missing on every provider)',
      {
        statusCode: 503,
        statusText: 'Service Unavailable',
        code: 'SERVICE_UNAVAILABLE',
        headers: {},
        body: null,
        type: 'api_error',
      }
    );
  }

  // Before the NZB is fetched and parsed, so a refused stream costs nothing.
  const admitted = streamRegistry.open({
    transport: 'usenet',
    username: decoded.owner ?? '',
    share: opts.share,
    clientIp: opts.clientIp,
    targetKey: usenetTargetKey(
      decoded.hash,
      decoded.fileIndex,
      decoded.innerPath
    ),
    filename: decoded.filename,
    start: opts.start,
  });
  if (!admitted.ok) {
    logger.info(
      {
        username: decoded.owner,
        hash: decoded.hash,
        reason: admitted.verdict.reason,
      },
      'usenet stream refused'
    );

    const forbidden =
      admitted.verdict.reason === 'banned' ||
      admitted.verdict.reason === 'blocked';
    const outOfSlots =
      admitted.verdict.reason === 'connection_user' ||
      admitted.verdict.reason === 'connection_global';
    throw new DebridError(admitted.verdict.message ?? 'stream not permitted', {
      statusCode: forbidden ? 403 : 429,
      statusText: forbidden ? 'Forbidden' : 'Too Many Requests',
      code: forbidden
        ? 'FORBIDDEN'
        : outOfSlots
          ? 'TOO_MANY_ACTIVE_CONNECTIONS'
          : 'TOO_MANY_REQUESTS',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }
  const handle = admitted.handle;

  noteStreamActivity(decoded.hash);
  let session: UsenetStreamSession;
  try {
    session = await getStreamSession(decoded, providers, options);
    opts.signal?.throwIfAborted();
  } catch (err) {
    handle.close();
    throw err;
  }
  const { size, filename } = session;
  const suffix = opts.suffixLength;
  const start =
    suffix !== undefined
      ? Math.max(0, size - suffix)
      : Math.max(0, opts.start ?? 0);
  const end = suffix !== undefined ? size : Math.min(size, opts.end ?? size);
  // A suffix range's position is only known now that the size is.
  handle.setInfo({ size, filename, start });

  let stream = session.stream.createReadStream({ start, end }, opts.signal);
  if (session.matroska && appConfig.usenet.matroskaHoleFill) {
    stream = wrapMatroskaHoleFill(stream, {
      startOffset: start,
      fileSize: size,
      holes: session.holeBytes,
      plan: session.voidPlan,
      nzbHash: session.hash,
    });
  }
  // Intercept push rather than listening for 'data', which would flip the
  // stream into flowing mode before the response attaches and lose chunks.
  const push = stream.push.bind(stream);
  stream.push = (chunk: unknown, encoding?: BufferEncoding): boolean => {
    const length = (chunk as { length?: number } | null)?.length;
    if (typeof length === 'number' && length > 0) handle.addBytes(length);
    return push(chunk as never, encoding);
  };
  handle.attach(stream);
  stream.once('close', () => {
    handle.close();
    noteStreamActivity(session.hash);
  });

  stream.once('error', (err) => {
    if (isDefinitiveMiss(err)) {
      failingStreams.set(sessionKey, Date.now() + FAILING_STREAM_TTL_MS);
    }
  });

  return {
    stream,
    size,
    start,
    end,
    filename,
    etag: usenetStreamEtag(decoded, size),
    lastModified: session.lastModified,
  };
}
