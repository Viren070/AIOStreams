import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ParsedResult, parseTorrentTitle } from '@viren070/parse-torrent-title';
import { downloadManager, NzbTooLargeError } from '../../utils/index.js';
import { getDataFolder } from '../../utils/general.js';
import { createLogger } from '../../logging/logger.js';
import {
  DebridError,
  DebridDownload,
  DebridFile,
  PlaybackInfo,
} from '../../debrid/base.js';
import {
  NZB,
  selectFileInTorrentOrNZB,
  hashNzbUrl,
} from '../../debrid/utils.js';
import {
  ArticleNotFoundError,
  EngineOptions,
  ProviderConfig,
  serializeArchiveLayout,
  parseNzb,
  isEligibleVideoTarget,
  contentTotalSize,
  type Nzb,
  type NzbContent,
} from '../index.js';
import {
  markReleaseDead,
  retractRelease,
} from '../../release-blocklist/feedback.js';
import { nzbContentKey } from '../../release-blocklist/keys.js';
import { blocklistEvalOptions } from '../../release-blocklist/filter.js';
import { ReleaseBlocklistRepository } from '../../db/repositories/release-blocklist.js';
import {
  UsenetLibraryRepository,
  type UsenetLibraryEntry,
  type UsenetLibraryFile,
  type UsenetLibrarySource,
} from '../../db/index.js';
import { usenetEngineRegistry, getUsenetEngineConfig } from './engine.js';
import { attachProvisionalHoles, spawnCensusShadow } from './census-shadow.js';
import {
  classifyNoStreamable,
  classifyAvailability,
  friendlyUsenetError,
  toDebridError,
} from './errors.js';
import {
  baseName,
  stripReleaseExt,
  stripNzbExt,
  innerDisplayName,
  extractNzbPassword,
  nzbReleaseName,
} from './naming.js';
import { encodeUsenetStreamToken } from './tokens.js';
import { inspectScheduler, type InspectPriority } from './inspect-scheduler.js';

const logger = createLogger('usenet/library');

/**
 * Synthetic URL scheme for NZBs uploaded directly (no indexer URL). The
 * contents are persisted on disk so the entry stays streamable after upload.
 */
const LOCAL_NZB_SCHEME = 'local-nzb://';

/** Directory holding the raw XML of directly-uploaded NZBs. */
function localNzbDir(): string {
  return path.join(getDataFolder(), 'usenet-nzbs');
}

/** Build the synthetic source URL for an uploaded NZB. */
function localNzbUrl(hash: string): string {
  return `${LOCAL_NZB_SCHEME}${hash}`;
}

/** Persist uploaded NZB contents keyed by content hash. */
async function saveLocalNzb(hash: string, xml: string | Buffer): Promise<void> {
  const dir = localNzbDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${hash}.nzb`), xml);
}

/**
 * Tiny TTL'd LRU of parsed NZB models keyed by NZB *content* hash so the
 * resolve → stream-session sequence (and rapid re-opens) runs the multi-MB
 * XML parse once instead of once per step. Callers may look up under any
 * hash they know: a small alias map bridges the search-time hash a resolve
 * parses under and the content hash its stream token carries. Bounded by
 * retained segment count, not entry count alone, since a large NZB's segment
 * list dominates memory.
 */
const PARSED_NZB_TTL_MS = 5 * 60_000;
const PARSED_NZB_MAX_ENTRIES = 8;
const PARSED_NZB_MAX_TOTAL_SEGMENTS = 600_000;
const PARSED_NZB_MAX_ALIASES = 64;
const parsedNzbCache = new Map<
  string,
  { nzb: Nzb; segments: number; at: number }
>();
/** Lookup-key aliases (search-time hash → content hash), FIFO-capped. */
const parsedNzbAliases = new Map<string, string>();

function rememberParsedNzbAlias(hash: string, contentHash: string): void {
  if (hash === contentHash) return;
  parsedNzbAliases.delete(hash);
  parsedNzbAliases.set(hash, contentHash);
  while (parsedNzbAliases.size > PARSED_NZB_MAX_ALIASES) {
    const oldest = parsedNzbAliases.keys().next().value;
    if (oldest === undefined) break;
    parsedNzbAliases.delete(oldest);
  }
}

/** Parse an NZB document, reusing a recently parsed model for the same hash. */
export async function parseNzbCached(
  hash: string,
  xml: string | Buffer
): Promise<Nzb> {
  const now = Date.now();
  const key = parsedNzbAliases.get(hash) ?? hash;
  const hit = parsedNzbCache.get(key);
  if (hit && now - hit.at <= PARSED_NZB_TTL_MS) {
    hit.at = now;
    // LRU bump (Map iteration order is insertion order).
    parsedNzbCache.delete(key);
    parsedNzbCache.set(key, hit);
    return hit.nzb;
  }
  const nzb = await parseNzb(xml);
  rememberParsedNzbAlias(hash, nzb.hash);
  const segments = nzb.files.reduce((n, f) => n + f.segments.length, 0);
  parsedNzbCache.delete(nzb.hash);
  parsedNzbCache.set(nzb.hash, { nzb, segments, at: now });
  let totalSegments = 0;
  for (const v of parsedNzbCache.values()) totalSegments += v.segments;
  for (const [k, v] of [...parsedNzbCache]) {
    if (k === nzb.hash) continue;
    const expired = now - v.at > PARSED_NZB_TTL_MS;
    const over =
      parsedNzbCache.size > PARSED_NZB_MAX_ENTRIES ||
      totalSegments > PARSED_NZB_MAX_TOTAL_SEGMENTS;
    if (!expired && !over) break;
    parsedNzbCache.delete(k);
    totalSegments -= v.segments;
  }
  return nzb;
}

/**
 * Post-parse canonicalisation: when the caller's hash for an NZB turns out
 * not to be its content hash, move any legacy row onto the content hash and record the alias
 */
export async function canonicaliseNzbHash(
  incomingHash: string,
  nzb: Nzb,
  nzbUrl?: string
): Promise<string> {
  if (!incomingHash || incomingHash === nzb.hash) return nzb.hash;
  try {
    const outcome = await UsenetLibraryRepository.rekey(
      incomingHash,
      nzb.hash,
      {
        aliasUrl: nzbUrl,
      }
    );
    if (outcome !== 'noop') {
      logger.debug(
        { incomingHash, contentHash: nzb.hash, outcome },
        'rekeyed legacy usenet library entry onto its content hash'
      );
    }
  } catch (err) {
    logger.warn(
      { err, incomingHash, contentHash: nzb.hash },
      'nzb hash reconcile failed; entry stays under its legacy key'
    );
  }
  return nzb.hash;
}

/**
 * Fetch raw NZB XML for a source URL. Directly-uploaded NZBs
 * (`local-nzb://<hash>`) are read from disk; everything else is grabbed via the
 * shared disk-backed download manager (single-flighted + cached, so a resuming
 * player does not re-grab the same multi-MB NZB on every request). Maps
 * transport failures onto a {@link DebridError}.
 */
export async function fetchNzb(
  url: string,
  signal?: AbortSignal
): Promise<Buffer> {
  if (url.startsWith(LOCAL_NZB_SCHEME)) {
    const hash = url.slice(LOCAL_NZB_SCHEME.length);
    try {
      return await fs.readFile(path.join(localNzbDir(), `${hash}.nzb`));
    } catch (err) {
      throw new DebridError('uploaded nzb contents no longer available', {
        statusCode: 404,
        statusText: 'Not Found',
        code: 'NOT_FOUND',
        headers: {},
        body: null,
        type: 'upstream_error',
        cause: err,
      });
    }
  }
  try {
    return await downloadManager.fetchNzb(url, { signal });
  } catch (err) {
    if (err instanceof NzbTooLargeError) {
      throw new DebridError(err.message, {
        statusCode: 413,
        statusText: 'Payload Too Large',
        code: 'BAD_REQUEST',
        headers: {},
        body: null,
        type: 'api_error',
        cause: err,
      });
    }
    throw new DebridError('failed to fetch nzb', {
      statusCode: 502,
      statusText: 'Bad Gateway',
      code: 'BAD_GATEWAY',
      headers: {},
      body: null,
      type: 'upstream_error',
      cause: err,
    });
  }
}

/** Project a persisted library file onto the shared {@link DebridFile} shape. */
function toDebridFile(f: UsenetLibraryFile): DebridFile {
  return { name: f.name, size: f.size, index: f.index, path: f.path };
}

/** Map a persisted library entry onto the shared {@link DebridDownload} shape. */
export function libraryEntryToDownload(
  entry: UsenetLibraryEntry
): DebridDownload {
  return {
    id: entry.nzbHash,
    hash: entry.nzbHash,
    name: entry.name,
    size: entry.size,
    status: entry.status === 'failed' ? 'failed' : 'downloaded',
    library: true,
    files: entry.files.map(toDebridFile),
  };
}

/**
 * Flatten an inspect result into the persisted library file tree: plain
 * streamable files plus the stored inner files of any archive set.
 * `eligibleOnly` keeps only plausible playback targets
 *
 * `index` must be unique across the whole NZB: a single archive's inner files
 * must never collide on the parent's NZB-file index, or the library meta
 * collapses them to one video. Plain files keep their NZB-file index (what the
 * engine opens by); archive-inner files are offset beyond every NZB-file index
 * and the engine opens those by `innerPath`.
 */
function collectLibraryFiles(
  content: NzbContent,
  releaseName?: string,
  opts: { eligibleOnly?: boolean } = {}
): UsenetLibraryFile[] {
  const releaseSize = opts.eligibleOnly ? contentTotalSize(content) : 0;
  const files: UsenetLibraryFile[] = [];
  let innerSeq = content.files.length;
  for (const f of content.files) {
    if (f.error) continue;
    if (
      f.streamable &&
      (!opts.eligibleOnly ||
        isEligibleVideoTarget(f.filename, f.size, releaseSize))
    ) {
      files.push({
        name: f.filename,
        size: f.size,
        index: f.index,
        category: f.category,
        streamable: true,
      });
    }
    const innerCount = f.archiveInner?.length ?? 0;
    for (const inner of f.archiveInner ?? []) {
      if (
        opts.eligibleOnly &&
        (!inner.streamable ||
          inner.category !== 'video' ||
          !isEligibleVideoTarget(inner.path, inner.size, releaseSize))
      ) {
        continue;
      }
      files.push({
        name: innerDisplayName(inner.path, innerCount, releaseName),
        size: inner.size,
        index: innerSeq++,
        path: inner.path,
        category: inner.category,
        streamable: inner.streamable,
        layout: inner.layout ? serializeArchiveLayout(inner.layout) : undefined,
      });
    }
  }
  return files;
}

/** Persist a definitive failure verdict and build the error to throw for it. */
async function failImport(
  nzbHash: string,
  name: string | undefined,
  reason: string,
  code: string,
  body: unknown
): Promise<DebridError> {
  await UsenetLibraryRepository.markFailed(nzbHash, reason, name, code).catch(
    () => {}
  );
  return new DebridError(reason, {
    statusCode: 404,
    statusText: 'Not Found',
    code: 'NO_MATCHING_FILE',
    headers: {},
    body,
    type: 'api_error',
  });
}

/**
 * Import an NZB into the library
 */
async function importNzb(
  spec: {
    nzbHash: string;
    nzb: Nzb;
    name?: string;
    owner?: string;
    source: UsenetLibrarySource;
    nzbUrl?: string;
    category?: string;
    providers: ProviderConfig[];
    options: Partial<EngineOptions>;
    /** Persist only plausible playback targets (resolve) vs the full tree. */
    eligibleOnly?: boolean;
    /** Drop the row on job abort, it was created for this resolve only. */
    deleteOnAbort?: boolean;
    /**
     * Mark unexpected (non-verdict) errors on the row instead of leaving it
     * `inspecting` for a later retry: manual rows are user-visible and polled
     * to completion, so they must reach a terminal state.
     */
    internalErrorsFailRow?: boolean;
    /** Base for `importMs` (manual measures from the add; default dispatch). */
    startedAt?: number;
    /** Grab/parse timings for the resolve path's phase-breakdown log. */
    timings?: { importStart: number; grabbedAt: number; parsedAt: number };
    /** Shareable release key for blocklist feedback, when the search knew one. */
    releaseKey?: string;
  },
  jobSignal: AbortSignal
): Promise<UsenetLibraryFile[]> {
  const { nzbHash, nzb, name, owner, source, nzbUrl } = spec;
  try {
    const engine = usenetEngineRegistry.get(spec.providers, spec.options);
    // Dispatch (not schedule) time, so `importMs` measures the inspect
    // itself, not time spent queued behind other imports.
    const inspectStart = Date.now();
    await UsenetLibraryRepository.create({
      nzbHash,
      name,
      owner,
      source,
      nzbUrl,
      category: spec.category,
      releaseKey: spec.releaseKey,
    }).catch(() => {});
    await UsenetLibraryRepository.setStatus(nzbHash, 'inspecting').catch(
      () => {}
    );

    let content;
    try {
      content = await engine.inspect(nzb, { mode: 'quick', signal: jobSignal });
    } catch (err) {
      if (jobSignal.aborted) throw toDebridError(err);
      const friendly = friendlyUsenetError(err);
      await UsenetLibraryRepository.markFailed(
        nzbHash,
        friendly.reason,
        name,
        friendly.code
      ).catch(() => {});
      if (err instanceof ArticleNotFoundError && err.allProviders) {
        markReleaseDead(spec.releaseKey, nzbContentKey(nzbHash));
      }
      throw toDebridError(err);
    }
    if (spec.timings) {
      const inspectedAt = Date.now();
      logger.debug(
        {
          nzbHash,
          grabMs: spec.timings.grabbedAt - spec.timings.importStart,
          parseMs: spec.timings.parsedAt - spec.timings.grabbedAt,
          inspectMs: inspectedAt - inspectStart,
          latency: inspectedAt - spec.timings.importStart,
          nzbFiles: nzb.files.length,
          streamableCount: content.files.filter((f) => f.streamable).length,
        },
        'usenet import phase breakdown'
      );
    }

    // A sampled segment missing on every provider means the stream would die
    // mid-playback; fail the import now with a dedicated code (Export NZB on
    // the dashboard remains available) instead of serving a doomed stream.
    const availFail = classifyAvailability(content);
    if (availFail) {
      content.census?.cancel();
      logger.warn(
        { nzbHash, ...content.availability },
        'nzb failed availability verification'
      );
      markReleaseDead(spec.releaseKey, nzbContentKey(nzbHash));
      throw await failImport(nzbHash, name, availFail.reason, availFail.code, {
        reasonCode: availFail.code,
      });
    }

    const releaseName =
      (nzb.meta.name ?? '').trim() ||
      stripReleaseExt((name ?? '').trim()) ||
      undefined;
    const files = collectLibraryFiles(content, releaseName, {
      eligibleOnly: spec.eligibleOnly,
    });
    const playable = files.filter((f) => f.streamable !== false);
    if (playable.length === 0) {
      content.census?.cancel();
      const byCategory: Record<string, number> = {};
      for (const f of content.files)
        byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
      const archiveInner = content.files.reduce(
        (n, f) => n + (f.archiveInner?.length ?? 0),
        0
      );
      logger.warn(
        {
          nzbHash,
          fileCount: content.files.length,
          byCategory,
          archiveInner,
          missing: content.files.filter((f) => f.error === 'article_not_found')
            .length,
          openFailed: content.files.filter((f) => f.error === 'open_failed')
            .length,
        },
        'no streamable files in nzb'
      );
      const { reason, code } = classifyNoStreamable(content);
      // Only the article-missing classification is provider-verified
      // evidence; archive/encoding defect codes never feed the blocklist.
      if (code === 'missing_on_providers') {
        markReleaseDead(spec.releaseKey, nzbContentKey(nzbHash));
      }
      throw await failImport(nzbHash, name, reason, code, {
        byCategory,
        archiveInner,
        reasonCode: code,
      });
    }

    const best = playable.reduce((a, b) => (b.size > a.size ? b : a));
    // Small damage the census confirmed within the blocking window: the entry
    // lands as degraded with its per-file hole map attached (playback
    // pre-pads).
    const degraded = attachProvisionalHoles(engine, nzb, content, files);
    await UsenetLibraryRepository.upsertAvailable({
      nzbHash,
      name,
      size: files.reduce((s, f) => s + f.size, 0),
      fileIndex: best?.index,
      files,
      owner,
      source,
      importMs: Date.now() - (spec.startedAt ?? inspectStart),
      nzbUrl,
      password: extractNzbPassword(nzb.meta, name),
      status: degraded ? 'degraded' : 'available',
      releaseKey: spec.releaseKey,
    }).catch((err) =>
      logger.warn({ err, nzbHash }, 'failed to persist usenet library entry')
    );
    // The release demonstrably exists (degraded still plays), so any dead
    // verdict for it is wrong.
    retractRelease(spec.releaseKey, nzbContentKey(nzbHash));
    // The census tail keeps auditing in the background; its final verdict
    // updates the entry (degraded/failed/promoted) when it completes.
    spawnCensusShadow({
      nzbHash,
      name,
      nzb,
      content,
      engine,
      releaseKey: spec.releaseKey,
    });
    return files;
  } catch (err) {
    if (jobSignal.aborted) {
      // Aborted because every waiter is gone (parallel failover won, players
      // disconnected): the NZB was never proven unstreamable, so don't leave
      // a dead "inspecting" row behind for a resolve-created entry.
      if (spec.deleteOnAbort) {
        UsenetLibraryRepository.delete(nzbHash).catch(() => {});
      }
    } else if (spec.internalErrorsFailRow && !(err instanceof DebridError)) {
      // Verdicts above already persisted their failure; anything else would
      // leave the row wedged in `inspecting`.
      await UsenetLibraryRepository.markFailed(
        nzbHash,
        'Inspection failed unexpectedly',
        name,
        'INTERNAL'
      ).catch(() => {});
    }
    throw err;
  }
}

/**
 * Return the streamable file list for an NZB, preferring the cached library
 * entry and otherwise fetching + importing the NZB. `nzbHash` is the caller's
 * best key for the entry, the canonical row hash when a row was found, else
 * the raw search-time hash; the returned `nzbHash` is the canonical content
 * hash whenever the NZB was actually parsed. `owner` is the authorising user
 * recorded on any new library entry.
 */
export async function resolveFileList(
  playbackInfo: PlaybackInfo & { type: 'usenet' },
  nzbHash: string,
  providers: ProviderConfig[],
  options: Partial<EngineOptions>,
  owner: string | undefined,
  cached?: DebridFile[],
  signal?: AbortSignal
): Promise<{ files: DebridFile[]; nzbHash: string }> {
  if (cached?.length) return { files: cached, nzbHash };

  const importStart = Date.now();
  const xml = await fetchNzb(playbackInfo.nzb);
  const grabbedAt = Date.now();
  const nzb = await parseNzbCached(nzbHash, xml);
  const parsedAt = Date.now();

  const contentHash = await canonicaliseNzbHash(nzbHash, nzb, playbackInfo.nzb);

  // The canonical row may already exist: reuse its verdict before paying
  // for an inspect. The alias recorded above makes the next attempt for this
  // URL short-circuit before even fetching.
  const existing =
    contentHash !== nzbHash
      ? await UsenetLibraryRepository.get(contentHash).catch(() => undefined)
      : undefined;
  if (existing?.status === 'failed') {
    logger.debug(
      {
        hash: contentHash,
        incomingHash: nzbHash,
        failReason: existing.failReason,
        errorCode: existing.errorCode,
        failCount: existing.failCount,
        failedAt: existing.lastUsedAt,
      },
      'skipping nzb: same content previously failed via another source (delete the library entry to retry)'
    );
    if (
      existing.errorCode === 'missing_on_providers' ||
      existing.errorCode === 'article_not_found'
    ) {
      markReleaseDead(playbackInfo.releaseKey, nzbContentKey(contentHash));
    }
    throw new DebridError('nzb previously failed on all providers', {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NOT_FOUND',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }
  if (
    (existing?.status === 'available' || existing?.status === 'degraded') &&
    existing.files.length
  ) {
    UsenetLibraryRepository.touch(contentHash).catch(() => {});
    return { files: existing.files.map(toDebridFile), nzbHash: contentHash };
  }

  const contentKey = nzbContentKey(contentHash);
  if (contentKey) {
    const verdict = await ReleaseBlocklistRepository.evaluateKeys(
      [contentKey],
      blocklistEvalOptions()
    )
      .then((verdicts) => verdicts.get(contentKey))
      .catch(() => undefined);
    if (verdict?.filtered) {
      logger.debug(
        { hash: contentHash, key: contentKey, reason: verdict.reason },
        'skipping nzb: post is blocklisted'
      );
      throw new DebridError(
        `nzb is blocklisted (${verdict.reason ?? verdict.verdict})`,
        {
          statusCode: 404,
          statusText: 'Not Found',
          code: 'NOT_FOUND',
          headers: {},
          body: null,
          type: 'api_error',
        }
      );
    }
  }
  const existedBefore = !!existing;

  let libFiles: UsenetLibraryFile[];
  try {
    libFiles = await inspectScheduler.schedule({
      contentHash,
      priority: 'interactive',
      signal,
      run: (jobSignal) =>
        importNzb(
          {
            nzbHash: contentHash,
            nzb,
            name: playbackInfo.filename,
            owner,
            source: 'auto',
            nzbUrl: playbackInfo.nzb,
            providers,
            options,
            eligibleOnly: true,
            deleteOnAbort: !existedBefore,
            timings: { importStart, grabbedAt, parsedAt },
            releaseKey: playbackInfo.releaseKey,
          },
          jobSignal
        ),
    });
  } catch (err) {
    throw toDebridError(err);
  }
  return { files: libFiles.map(toDebridFile), nzbHash: contentHash };
}

/**
 * Pick the file to play. Honours an explicit `fileIndex`, short-circuits a
 * single-file NZB, and otherwise defers to the shared metadata-aware
 * {@link selectFileInTorrentOrNZB} scorer.
 */
export async function selectStreamFile(
  playbackInfo: PlaybackInfo & { type: 'usenet' },
  filename: string,
  files: DebridFile[]
): Promise<DebridFile | undefined> {
  if (files.length === 0) return undefined;
  if (playbackInfo.fileIndex !== undefined) {
    const match = files.find((f) => f.index === playbackInfo.fileIndex);
    if (match) return match;
  }
  if (files.length === 1) return files[0];

  const title = playbackInfo.filename ?? filename;
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const parsedFiles = new Map<string, ParsedResult>();
  for (const s of [title, ...files.map((f) => f.name ?? '')]) {
    if (!parsedFiles.has(s)) parsedFiles.set(s, parseTorrentTitle(s));
  }

  const nzbInfo: NZB = {
    type: 'usenet',
    nzb: playbackInfo.nzb,
    hash: playbackInfo.hash,
    title,
    size: totalSize,
  };
  const debridDownload: DebridDownload = {
    id: playbackInfo.hash,
    hash: playbackInfo.hash,
    name: title,
    status: 'downloaded',
    files,
  };

  return selectFileInTorrentOrNZB(
    nzbInfo,
    debridDownload,
    parsedFiles,
    playbackInfo.metadata,
    { chosenIndex: playbackInfo.fileIndex }
  );
}

/**
 * Import a queued NZB detached from {@link addUsenetNzb}, so the dashboard's
 * add returns immediately; never throws (failures are recorded on the library
 * row + logged). Goes through the shared {@link inspectScheduler}, so a
 * duplicate add while importing joins the in-flight job, and a racing
 * playback resolve of the same post shares this import instead of running
 * its own.
 */
async function importNzbInBackground(args: {
  nzbHash: string;
  nzb: Nzb;
  name: string;
  sourceUrl?: string;
  owner?: string;
  category?: string;
  providers: ProviderConfig[];
  options: Partial<EngineOptions>;
  startedAt: number;
  priority?: InspectPriority;
}): Promise<void> {
  try {
    await inspectScheduler.schedule({
      contentHash: args.nzbHash,
      priority: args.priority ?? 'background',
      run: (jobSignal) =>
        importNzb(
          {
            nzbHash: args.nzbHash,
            nzb: args.nzb,
            name: args.name,
            owner: args.owner,
            source: 'manual',
            nzbUrl: args.sourceUrl,
            category: args.category,
            providers: args.providers,
            options: args.options,
            internalErrorsFailRow: true,
            startedAt: args.startedAt,
          },
          jobSignal
        ),
    });
  } catch (err) {
    logger.warn(
      { err, nzbHash: args.nzbHash },
      'background nzb inspection failed'
    );
  }
}

/**
 * Fetch (or accept raw) + parse an NZB, persist it as a queued manual
 * library entry, and return immediately; driving the row through
 * inspecting → available|failed.
 */
export async function addUsenetNzb(opts: {
  url?: string;
  xml?: string | Buffer;
  name?: string;
  owner?: string;
  /** SABnzbd-style category, persisted for queue/history grouping. */
  category?: string;
  /** Explicit archive password; overrides any `<meta password>` in the NZB. */
  password?: string;
}): Promise<UsenetLibraryEntry> {
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
  if (!opts.url && opts.xml == null) {
    throw new DebridError('addNzb requires a url or raw nzb contents', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'BAD_REQUEST',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }

  const startedAt = Date.now();
  const xml = opts.xml ?? (await fetchNzb(opts.url!));
  const nzb = await parseNzb(xml);
  // An explicitly supplied password (SABnzbd `addurl&password=`) wins over the
  // NZB's own `<meta password>`: the engine and `extractNzbPassword` both read
  // `nzb.meta.password`, so injecting it here covers inspect + persistence.
  if (opts.password) {
    nzb.meta = { ...nzb.meta, password: opts.password };
  }
  const nzbHash = nzb.hash;
  const name = stripNzbExt(
    opts.name?.trim() ||
      nzbReleaseName(nzb.meta, nzb.files[0]?.filename) ||
      nzbHash
  );

  // Uploaded NZBs have no indexer URL; persist the contents under a synthetic
  // `local-nzb://` source so the entry stays streamable after upload.
  let sourceUrl = opts.url;
  if (opts.xml != null) {
    await saveLocalNzb(nzbHash, opts.xml);
    sourceUrl = localNzbUrl(nzbHash);
  }

  await UsenetLibraryRepository.create({
    nzbHash,
    name,
    owner: opts.owner,
    source: 'manual',
    nzbUrl: sourceUrl,
    category: opts.category,
  });
  // Record the search-time hash of the source URL so a later auto-resolve of
  // the same indexer link converges on this row instead of creating a second
  // one (same cleaned form the search builtins mint).
  if (opts.url && !opts.url.startsWith(LOCAL_NZB_SCHEME)) {
    await UsenetLibraryRepository.recordAlias(
      hashNzbUrl(opts.url),
      nzbHash,
      opts.url
    ).catch(() => {});
  }

  // Detached: inspect + persist in the background so the add returns instantly.
  void importNzbInBackground({
    nzbHash,
    nzb,
    name,
    sourceUrl,
    owner: opts.owner,
    category: opts.category,
    providers,
    options,
    startedAt,
  });

  return (await UsenetLibraryRepository.get(nzbHash))!;
}

/**
 * Mint a byte-serving stream token for a library entry + file selection.
 * Requires the entry to retain its source URL. `fileSel`
 * matches a file's inner path or its index.
 */
export async function mintUsenetLibraryToken(
  nzbHash: string,
  fileSel?: string
): Promise<{ token: string; filename: string } | undefined> {
  const entry = (await UsenetLibraryRepository.getResolved(nzbHash))?.entry;
  if (!entry?.nzbUrl) return undefined;
  let file: UsenetLibraryFile | undefined;
  if (fileSel) {
    file =
      entry.files.find((f) => f.path === fileSel) ??
      entry.files.find((f) => String(f.index) === fileSel) ??
      entry.files.find((f) => f.name === fileSel);
  }
  if (!file) {
    file = entry.files
      .filter((f) => f.streamable !== false)
      .reduce<
        UsenetLibraryFile | undefined
      >((a, b) => (a && a.size > b.size ? a : b), undefined);
  }
  if (!file) return undefined;
  const filename =
    (file.path ? baseName(file.path) : undefined) ??
    file.name ??
    entry.name ??
    entry.nzbHash;
  const token = encodeUsenetStreamToken({
    nzb: entry.nzbUrl,
    hash: entry.nzbHash,
    fileIndex: file.index,
    innerPath: file.path,
    filename,
  });
  return { token, filename };
}

/**
 * Return the raw NZB XML for a library entry, for the dashboard "export NZB"
 * action. Uploaded NZBs are read from disk; indexer-sourced ones are grabbed
 * via the cached download manager. Returns `undefined` when the entry or its
 * source URL is unknown. Especially useful for entries that failed because
 * their articles are missing on every provider; the user can take the NZB
 * elsewhere.
 */
export async function exportUsenetLibraryNzb(
  nzbHash: string
): Promise<{ xml: Buffer; filename: string } | undefined> {
  const entry = (await UsenetLibraryRepository.getResolved(nzbHash))?.entry;
  if (!entry?.nzbUrl) return undefined;
  const xml = await fetchNzb(entry.nzbUrl);
  const base = (entry.name ?? entry.nzbHash).replace(/\.nzb$/i, '');
  const safe = base.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || entry.nzbHash;
  return { xml, filename: `${safe}.nzb` };
}

/**
 * Re-fetch an existing row's source NZB, re-parse it and put it back through
 * the inspect queue, replacing the row. The row is reset to `queued` here
 * rather than when the job dispatches, so a requeue that lands behind a busy
 * inspect queue still reads as pending. Throws if the NZB cannot be re-fetched
 * or re-parsed, leaving the row as it was.
 */
async function requeueEntry(
  entry: UsenetLibraryEntry,
  nzbUrl: string,
  providers: ProviderConfig[],
  options: Partial<EngineOptions>
): Promise<void> {
  const xml = await fetchNzb(nzbUrl);
  const nzb = await parseNzb(xml);
  if (entry.password) {
    nzb.meta = { ...nzb.meta, password: entry.password };
  }
  const name =
    entry.name ??
    (stripNzbExt(nzbReleaseName(nzb.meta, nzb.files[0]?.filename) ?? '') ||
      nzb.hash);
  // The source URL may serve different content than when the row was
  // created; trust the fresh parse
  if (nzb.hash !== entry.nzbHash) {
    await UsenetLibraryRepository.delete(entry.nzbHash).catch(() => {});
  }
  if (!nzbUrl.startsWith(LOCAL_NZB_SCHEME)) {
    await UsenetLibraryRepository.recordAlias(
      hashNzbUrl(nzbUrl),
      nzb.hash,
      nzbUrl
    ).catch(() => {});
  }
  await UsenetLibraryRepository.create({
    nzbHash: nzb.hash,
    name,
    owner: entry.owner,
    source: 'manual',
    nzbUrl,
    category: entry.category,
    releaseKey: entry.releaseKey,
  });
  void importNzbInBackground({
    nzbHash: nzb.hash,
    nzb,
    name,
    sourceUrl: nzbUrl,
    owner: entry.owner,
    category: entry.category,
    providers,
    options,
    startedAt: Date.now(),
    priority: 'requeue',
  });
}

/**
 * Re-import a library entry on request (the dashboard's requeue). Unlike the
 * boot sweep this never records a failure on the row: the entry may already be
 * available, and a dead source URL is no reason to discard what it has.
 */
export async function requeueUsenetNzb(nzbHash: string): Promise<void> {
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
  const resolved = await UsenetLibraryRepository.getResolved(nzbHash);
  if (!resolved) {
    throw new DebridError('library entry not found', {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NOT_FOUND',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }
  const { entry } = resolved;
  if (!entry.nzbUrl) {
    throw new DebridError('this entry has no source NZB to re-import', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'BAD_REQUEST',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }
  await requeueEntry(entry, entry.nzbUrl, providers, options);
}

/**
 * Boot-time recovery for inspects interrupted by a restart. Any row still in
 * `queued`/`inspecting` at startup is stale
 */
export async function requeueInterruptedInspects(): Promise<void> {
  try {
    const { entries } = await UsenetLibraryRepository.list({
      statuses: ['queued', 'inspecting'],
      limit: 500,
    });
    if (entries.length === 0) return;
    const { providers, options } = getUsenetEngineConfig();
    if (providers.length === 0) {
      logger.warn(
        { stale: entries.length },
        'interrupted usenet inspects found but no providers are configured; leaving them untouched'
      );
      return;
    }
    let requeued = 0;
    let dropped = 0;
    let failed = 0;
    for (const entry of entries) {
      if (entry.source !== 'manual') {
        await UsenetLibraryRepository.delete(entry.nzbHash).catch(() => {});
        dropped++;
        continue;
      }
      if (!entry.nzbUrl) {
        await UsenetLibraryRepository.markFailed(
          entry.nzbHash,
          'Interrupted by a restart with no source NZB to retry',
          entry.name,
          'INTERNAL'
        ).catch(() => {});
        failed++;
        continue;
      }
      try {
        await requeueEntry(entry, entry.nzbUrl, providers, options);
        requeued++;
      } catch (err) {
        logger.warn(
          { err, nzbHash: entry.nzbHash },
          'failed to requeue interrupted manual inspect'
        );
        await UsenetLibraryRepository.markFailed(
          entry.nzbHash,
          'Interrupted by a restart and could not be re-fetched',
          entry.name,
          'inspect_failed'
        ).catch(() => {});
        failed++;
      }
    }
    logger.info(
      { requeued, dropped, failed },
      'recovered restart-interrupted usenet inspects'
    );
  } catch (err) {
    logger.warn({ err }, 'interrupted-inspect recovery sweep failed');
  }
}
