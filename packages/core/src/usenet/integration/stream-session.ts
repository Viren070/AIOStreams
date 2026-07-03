import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createLogger } from '../../logging/logger.js';
import { DebridError } from '../../debrid/base.js';
import {
  ArticleNotFoundError,
  NotStreamableError,
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
  type HoleHooks,
  type HoleInfo,
  type HoleDecision,
  type ArchiveStreamLayout,
  type LazyResolveHooks,
  type DataFragment,
  type SeekableStream,
  type EngineOptions,
  type ProviderConfig,
} from '../index.js';
import {
  UsenetLibraryRepository,
  type UsenetLibraryEntry,
} from '../../db/index.js';
import { type UsenetStreamToken, decodeUsenetStreamToken } from './tokens.js';
import { friendlyUsenetError } from './errors.js';
import { usenetEngineRegistry, getUsenetEngineConfig } from './engine.js';
import { fetchNzb, parseNzbCached } from './library.js';

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
function streamEtag(token: UsenetStreamToken, size: number): string {
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
  lastUsedAt: number;
  lastModified: Date;
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

const sessionEvictionTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, session] of streamSessions) {
    if (now - session.lastUsedAt > STREAM_SESSION_IDLE_MS) {
      streamSessions.delete(key);
    }
  }
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
 */
function holeHooksFor(
  hash: string,
  decoded: UsenetStreamToken,
  entry: UsenetLibraryEntry | undefined,
  sessionKey: string
): HoleHooks {
  // Seed with every persisted hole (idempotent adds keep replays stable).
  const acc = new HoleAccumulator();
  for (const f of entry?.files ?? []) {
    if (f.holes) acc.load(deserializeHoles(f.holes));
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
        serializeHoles(acc.runsForFiles(new Set([nzbFileIndex])))
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
      { hash, nzbFileIndex: info.nzbFileIndex, why },
      'playback hole exceeds padding caps; failing entry'
    );
    UsenetLibraryRepository.markFailed(
      hash,
      'Too many articles missing on every provider to play',
      decoded.filename,
      'missing_on_providers'
    ).catch(() => {});
    // Drop the warm session so a player retry re-opens fresh and sees the
    // failed entry.
    streamSessions.delete(sessionKey);
    return 'fail';
  };

  return {
    onHole(info: HoleInfo): HoleDecision {
      paddedBytesTotal += info.bytes;
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
          return fail(info, 'consecutive missing segments');
        }
        if (acc.total > MAX_PAD_TOTAL_SEGMENTS) {
          return fail(info, 'cumulative missing segments');
        }
        markDegraded();
        persistHoles(info.nzbFileIndex);
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
      return 'pad';
    },
    knownHoles(nzbFileIndex: number): ReadonlySet<number> | undefined {
      const set = acc.indicesForFile(nzbFileIndex);
      return set.size > 0 ? set : undefined;
    },
  };
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
    existing.lastUsedAt = Date.now();
    // Refresh the engine's idle clock so it isn't evicted out from under a
    // session that's serving range requests without re-entering the registry.
    usenetEngineRegistry.get(providers, options);
    logger.debug(
      { hash: decoded.hash, filename: existing.filename },
      'reused warm usenet stream session'
    );
    return existing;
  }

  const inflight = openingSessions.get(key);
  if (inflight) return inflight;

  const open = (async (): Promise<UsenetStreamSession> => {
    const startedAt = Date.now();
    // Open without the caller's request signal: a session is shared, so a
    // disconnect mid-open must not poison it for everyone (segment timeouts
    // still bound the work). Phase timings (grab/parse/open) are logged so a
    // cold-start slowdown can be attributed.
    const xml = await fetchNzb(decoded.nzb);
    const grabbedAt = Date.now();
    // Reuses the model the resolve just parsed (same hash); parsing the same
    // multi-MB NZB twice per playback is pure waste.
    const nzb = await parseNzbCached(decoded.hash, xml);
    const parsedAt = Date.now();
    const engine = usenetEngineRegistry.get(providers, options);
    // Fetched up-front: seeds the hole hooks (persisted hole map → replay
    // pre-pad) and provides addedAt for Last-Modified below.
    const entry = await UsenetLibraryRepository.get(decoded.hash).catch(
      () => undefined
    );
    const holeHooks = holeHooksFor(decoded.hash, decoded, entry, key);

    let stream: SeekableStream | undefined;
    let filename = decoded.filename;
    try {
      // Fast path: rebuild an archive inner stream from the layout captured at
      // inspection, skipping re-fetching/parsing the archive header (and the
      // encrypted-7z AES+LZMA decode that makes cold opens of large password 7z
      // packs slow). Any miss/failure falls back to a full parse open.
      if (decoded.innerPath) {
        const layout = await loadArchiveLayout(decoded.hash, decoded.innerPath);
        if (layout) {
          try {
            const hooks = hasPendingFragments(layout.target)
              ? lazyHooksFor(decoded.hash, decoded.innerPath, layout, key)
              : undefined;
            stream = await engine.openArchiveStreamFromLayout(
              nzb,
              layout,
              undefined,
              hooks,
              holeHooks
            );
            filename = stream.filename ?? decoded.filename;
          } catch (err) {
            logger.warn(
              {
                hash: decoded.hash,
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
          filename = stream.filename ?? decoded.filename;
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
          decoded.hash,
          friendly.reason,
          decoded.filename,
          friendly.code
        ).catch(() => {});
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
      lastUsedAt: Date.now(),
      lastModified,
    };
    streamSessions.set(key, session);
    const openedAt = Date.now();
    logger.debug(
      {
        hash: decoded.hash,
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
export async function openNativeUsenetStream(opts: {
  token: string;
  start?: number;
  end?: number;
  signal?: AbortSignal;
}): Promise<OpenedUsenetStream> {
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

  const session = await getStreamSession(decoded, providers, options);
  const { size, filename } = session;
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(size, opts.end ?? size);

  return {
    stream: session.stream.createReadStream({ start, end }),
    size,
    start,
    end,
    filename,
    etag: streamEtag(decoded, size),
    lastModified: session.lastModified,
  };
}
