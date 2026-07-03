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
import { NZB, selectFileInTorrentOrNZB } from '../../debrid/utils.js';
import {
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
  UsenetLibraryRepository,
  type UsenetLibraryEntry,
  type UsenetLibraryFile,
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
 * Tiny TTL'd LRU of parsed NZB models keyed by content hash so the resolve →
 * stream-session sequence (and rapid re-opens) runs the multi-MB XML parse
 * once instead of once per step. Bounded by retained segment count, not entry
 * count alone, since a large NZB's segment list dominates memory.
 */
const PARSED_NZB_TTL_MS = 5 * 60_000;
const PARSED_NZB_MAX_ENTRIES = 8;
const PARSED_NZB_MAX_TOTAL_SEGMENTS = 600_000;
const parsedNzbCache = new Map<
  string,
  { nzb: Nzb; segments: number; at: number }
>();

/** Parse an NZB document, reusing a recently parsed model for the same hash. */
export async function parseNzbCached(
  hash: string,
  xml: string | Buffer
): Promise<Nzb> {
  const now = Date.now();
  const hit = parsedNzbCache.get(hash);
  if (hit && now - hit.at <= PARSED_NZB_TTL_MS) {
    hit.at = now;
    // LRU bump (Map iteration order is insertion order).
    parsedNzbCache.delete(hash);
    parsedNzbCache.set(hash, hit);
    return hit.nzb;
  }
  const nzb = await parseNzb(xml);
  const segments = nzb.files.reduce((n, f) => n + f.segments.length, 0);
  parsedNzbCache.delete(hash);
  parsedNzbCache.set(hash, { nzb, segments, at: now });
  let totalSegments = 0;
  for (const v of parsedNzbCache.values()) totalSegments += v.segments;
  for (const [k, v] of [...parsedNzbCache]) {
    if (k === hash) continue;
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
    files: entry.files.map((f) => ({
      name: f.name,
      size: f.size,
      index: f.index,
      path: f.path,
    })),
  };
}

/**
 * Flatten an inspect result into the persisted library file tree: plain
 * streamable files plus the stored inner files of any archive set.
 *
 * `index` must be unique across the whole NZB: a single archive's inner files
 * must never collide on the parent's NZB-file index, or the library meta
 * collapses them to one video. Plain files keep their NZB-file index (what the
 * engine opens by); archive-inner files are offset beyond every NZB-file index
 * and the engine opens those by `innerPath`.
 */
function collectLibraryFiles(
  content: NzbContent,
  releaseName?: string
): UsenetLibraryFile[] {
  const files: UsenetLibraryFile[] = [];
  let innerSeq = content.files.length;
  for (const f of content.files) {
    if (f.error) continue;
    if (f.streamable) {
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

/**
 * Return the streamable file list for an NZB, preferring the cached library
 * entry and otherwise fetching + inspecting the NZB (and persisting the result,
 * or marking it failed on a definitive miss). `owner` is the authorising user
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
): Promise<DebridFile[]> {
  if (cached?.length) return cached;

  // Split the import into grab (NZB fetch), parse, and inspect (the
  // segment-probing phase that dominates) so a slow cold load can be pinned to
  // the right phase from the logs alone.
  const importStart = Date.now();
  const xml = await fetchNzb(playbackInfo.nzb);
  const grabbedAt = Date.now();
  const nzb = await parseNzbCached(nzbHash, xml);
  const parsedAt = Date.now();
  const engine = usenetEngineRegistry.get(providers, options);

  const inspectStart = parsedAt;
  UsenetLibraryRepository.create({
    nzbHash,
    name: playbackInfo.filename,
    owner,
    source: 'auto',
    nzbUrl: playbackInfo.nzb,
  }).catch(() => {});
  UsenetLibraryRepository.setStatus(nzbHash, 'inspecting').catch(() => {});

  let content;
  try {
    content = await engine.inspect(nzb, { mode: 'quick', signal });
  } catch (err) {
    // Aborted because another (parallel failover) attempt won first: this NZB
    // was never proven unstreamable, so don't poison its library entry. The
    // caller drops the freshly-created entry.
    if (signal?.aborted) {
      throw toDebridError(err);
    }
    const friendly = friendlyUsenetError(err);
    UsenetLibraryRepository.markFailed(
      nzbHash,
      friendly.reason,
      playbackInfo.filename,
      friendly.code
    ).catch(() => {});
    throw toDebridError(err);
  }
  const inspectedAt = Date.now();
  logger.debug(
    {
      nzbHash,
      grabMs: grabbedAt - importStart,
      parseMs: parsedAt - grabbedAt,
      inspectMs: inspectedAt - inspectStart,
      latency: inspectedAt - importStart,
      nzbFiles: nzb.files.length,
      streamableCount: content.files.filter((f) => f.streamable).length,
    },
    'usenet import phase breakdown'
  );

  // A sampled segment missing on every provider means the stream would die
  // mid-playback; fail the import now with a dedicated code (Export NZB on the
  // dashboard remains available) instead of serving a doomed stream.
  const availFail = classifyAvailability(content);
  if (availFail) {
    content.census?.cancel();
    logger.warn(
      { nzbHash, ...content.availability },
      'nzb failed availability verification'
    );
    UsenetLibraryRepository.markFailed(
      nzbHash,
      availFail.reason,
      playbackInfo.filename,
      availFail.code
    ).catch(() => {});
    throw new DebridError(availFail.reason, {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NO_MATCHING_FILE',
      headers: {},
      body: { reasonCode: availFail.code },
      type: 'api_error',
    });
  }

  // Sample/proof clips are not playback targets unless they're large enough to
  // plausibly be real content; otherwise a release whose main feature is
  // missing "succeeds" by serving a 30-second sample (and the import below
  // correctly fails as missing_on_providers instead).
  const releaseSize = contentTotalSize(content);
  const streamable = content.files.filter(
    (f) =>
      f.streamable &&
      !f.error &&
      isEligibleVideoTarget(f.filename, f.size, releaseSize)
  );

  const files: DebridFile[] = [];
  // Archive rebuild recipes, keyed by inner path, captured at inspection so a
  // cold stream open skips the archive header parse (persisted with the entry).
  const layoutByPath = new Map<string, unknown>();
  const releaseName =
    (nzb.meta.name ?? '').trim() ||
    stripReleaseExt((playbackInfo.filename ?? '').trim()) ||
    undefined;
  let innerSeq = content.files.length;
  for (const f of streamable) {
    files.push({
      id: f.index,
      name: f.filename,
      size: f.size,
      index: f.index,
    });
  }
  for (const f of content.files) {
    const innerCount = f.archiveInner?.length ?? 0;
    for (const inner of f.archiveInner ?? []) {
      if (!inner.streamable || inner.category !== 'video') continue;
      if (!isEligibleVideoTarget(inner.path, inner.size, releaseSize)) continue;
      files.push({
        id: innerSeq,
        name: innerDisplayName(inner.path, innerCount, releaseName),
        size: inner.size,
        index: innerSeq,
        path: inner.path,
      });
      if (inner.layout)
        layoutByPath.set(inner.path, serializeArchiveLayout(inner.layout));
      innerSeq++;
    }
  }
  if (files.length === 0) {
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
    UsenetLibraryRepository.markFailed(
      nzbHash,
      reason,
      playbackInfo.filename,
      code
    ).catch(() => {});
    throw new DebridError(reason, {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NO_MATCHING_FILE',
      headers: {},
      body: { byCategory, archiveInner, reasonCode: code },
      type: 'api_error',
    });
  }
  const best = files.reduce((a, b) => (b.size > a.size ? b : a), files[0]);

  const libFiles: UsenetLibraryFile[] = files.map((f) => ({
    name: f.name,
    size: f.size,
    index: f.index,
    path: f.path,
    layout: f.path ? layoutByPath.get(f.path) : undefined,
  }));
  // Small damage the census confirmed within the blocking window: the entry
  // lands as degraded with its per-file hole map attached (playback pre-pads).
  const degraded = attachProvisionalHoles(engine, nzb, content, libFiles);
  UsenetLibraryRepository.upsertAvailable({
    nzbHash,
    name: playbackInfo.filename,
    size: files.reduce((s, f) => s + f.size, 0),
    fileIndex: best?.index,
    files: libFiles,
    owner,
    source: 'auto',
    importMs: Date.now() - inspectStart,
    nzbUrl: playbackInfo.nzb,
    password: extractNzbPassword(nzb.meta, playbackInfo.filename),
    status: degraded ? 'degraded' : 'available',
  }).catch((err) =>
    logger.warn({ err, nzbHash }, 'failed to persist usenet library entry')
  );
  // The census tail keeps auditing in the background; its final verdict
  // updates the entry (degraded/failed/promoted) when it completes.
  spawnCensusShadow({
    nzbHash,
    name: playbackInfo.filename,
    nzb,
    content,
    engine,
  });

  return files;
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

/** Hashes currently being inspected, so a re-add doesn't double-inspect. */
const inspectInFlight = new Set<string>();

/**
 * Inspect a queued NZB and persist the result (available|failed). Runs detached
 * from {@link addUsenetNzb} so the dashboard's add returns immediately; never
 * throws (failures are recorded on the library row + logged). Singleflighted per
 * hash so a duplicate add while inspecting is a no-op.
 */
async function inspectNzbInBackground(args: {
  nzbHash: string;
  nzb: Nzb;
  name: string;
  sourceUrl?: string;
  owner?: string;
  providers: ProviderConfig[];
  options: Partial<EngineOptions>;
  startedAt: number;
}): Promise<void> {
  const {
    nzbHash,
    nzb,
    name,
    sourceUrl,
    owner,
    providers,
    options,
    startedAt,
  } = args;
  if (inspectInFlight.has(nzbHash)) return;
  inspectInFlight.add(nzbHash);
  try {
    await UsenetLibraryRepository.setStatus(nzbHash, 'inspecting');
    const engine = usenetEngineRegistry.get(providers, options);
    let content;
    try {
      content = await engine.inspect(nzb, { mode: 'quick' });
    } catch (err) {
      const friendly = friendlyUsenetError(err);
      await UsenetLibraryRepository.markFailed(
        nzbHash,
        friendly.reason,
        name,
        friendly.code
      );
      return;
    }

    const availFail = classifyAvailability(content);
    if (availFail) {
      content.census?.cancel();
      await UsenetLibraryRepository.markFailed(
        nzbHash,
        availFail.reason,
        name,
        availFail.code
      );
      return;
    }

    const releaseName =
      (nzb.meta.name ?? '').trim() || stripReleaseExt(name) || undefined;
    const files = collectLibraryFiles(content, releaseName);

    if (!files.some((f) => f.streamable)) {
      content.census?.cancel();
      const { reason, code } = classifyNoStreamable(content);
      await UsenetLibraryRepository.markFailed(nzbHash, reason, name, code);
      return;
    }

    const best = files
      .filter((f) => f.streamable)
      .reduce((a, b) => (b.size > a.size ? b : a));
    const degraded = attachProvisionalHoles(engine, nzb, content, files);
    await UsenetLibraryRepository.upsertAvailable({
      nzbHash,
      name,
      size: files.reduce((s, f) => s + f.size, 0),
      fileIndex: best?.index,
      files,
      owner,
      source: 'manual',
      importMs: Date.now() - startedAt,
      nzbUrl: sourceUrl,
      password: extractNzbPassword(nzb.meta, name),
      status: degraded ? 'degraded' : 'available',
    });
    spawnCensusShadow({ nzbHash, name, nzb, content, engine });
  } catch (err) {
    logger.warn({ err, nzbHash }, 'background nzb inspection failed');
    await UsenetLibraryRepository.markFailed(
      nzbHash,
      'Inspection failed unexpectedly',
      name,
      'INTERNAL'
    ).catch(() => {});
  } finally {
    inspectInFlight.delete(nzbHash);
  }
}

/**
 * Fetch (or accept raw) + parse an NZB, persist it as a **queued** manual
 * library entry, and return immediately; the slow inspect (segment probing)
 * runs detached via {@link inspectNzbInBackground}, driving the row through
 * inspecting → available|failed. The dashboard polls the row to completion, so
 * the add never blocks on the engine. Pass `url` to grab it, or `xml` to import
 * already-uploaded contents (dashboard dropzone). Exported so the admin
 * dashboard can add NZBs without instantiating a credentialed service.
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

  // Detached: inspect + persist in the background so the add returns instantly.
  void inspectNzbInBackground({
    nzbHash,
    nzb,
    name,
    sourceUrl,
    owner: opts.owner,
    providers,
    options,
    startedAt,
  });

  return (await UsenetLibraryRepository.get(nzbHash))!;
}

/**
 * Mint a byte-serving stream token for a library entry + file selection (used
 * by the dashboard preview/download). Requires the entry to retain its source
 * URL (manual adds and auto-resolved streams both persist `nzbUrl`). `fileSel`
 * matches a file's inner path or its index.
 */
export async function mintUsenetLibraryToken(
  nzbHash: string,
  fileSel?: string
): Promise<{ token: string; filename: string } | undefined> {
  const entry = await UsenetLibraryRepository.get(nzbHash);
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
    nzbHash;
  const token = encodeUsenetStreamToken({
    nzb: entry.nzbUrl,
    hash: nzbHash,
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
  const entry = await UsenetLibraryRepository.get(nzbHash);
  if (!entry?.nzbUrl) return undefined;
  const xml = await fetchNzb(entry.nzbUrl);
  const base = (entry.name ?? nzbHash).replace(/\.nzb$/i, '');
  const safe = base.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || nzbHash;
  return { xml, filename: `${safe}.nzb` };
}
