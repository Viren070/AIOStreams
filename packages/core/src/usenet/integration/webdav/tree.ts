import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import {
  UsenetLibraryRepository,
  usenetLibraryBus,
  type UsenetLibraryEntry,
  type UsenetLibraryFile,
} from '../../../db/index.js';
import { createLogger } from '../../../logging/logger.js';
import {
  WEBDAV_LIBRARY_ROOT,
  WEBDAV_MEDIA_ROOT,
  WEBDAV_MEDIA_MOVIES,
  WEBDAV_MEDIA_SERIES,
  assignFileNames,
  assignReleaseFolders,
  categoryFolder,
  isBrowsableFile,
  sanitizeSegment,
  webdavContentType,
} from './paths.js';

const logger = createLogger('usenet/webdav');

/** Safety ceiling on entries paged into one WebDAV projection. */
const MAX_LIBRARY_ENTRIES = 10000;

interface WebdavNodeBase {
  /** Display name (final path segment). */
  name: string;
  /** Full path segments below the `/dav` mount, e.g. `['library','tv','Show']`. */
  segments: string[];
  /** Last-modified, when known (drives `getlastmodified`). */
  mtime?: Date;
}

export interface WebdavCollection extends WebdavNodeBase {
  kind: 'collection';
  /** The backing entry when this collection is a single release folder (DELETE). */
  entry?: UsenetLibraryEntry;
}

export interface WebdavFile extends WebdavNodeBase {
  kind: 'file';
  size: number;
  contentType: string;
  /** The library entry + file this path streams from. */
  entry: UsenetLibraryEntry;
  file: UsenetLibraryFile;
}

export type WebdavNode = WebdavCollection | WebdavFile;

export interface WebdavResolved {
  self: WebdavNode;
  /** Immediate children (empty for files; populated for collections). */
  children: WebdavNode[];
}

const collection = (
  name: string,
  segments: string[],
  mtime?: Date,
  entry?: UsenetLibraryEntry
): WebdavCollection => ({ kind: 'collection', name, segments, mtime, entry });

function fileNode(
  name: string,
  segments: string[],
  entry: UsenetLibraryEntry,
  file: UsenetLibraryFile
): WebdavFile {
  return {
    kind: 'file',
    name,
    segments,
    size: file.size ?? 0,
    contentType: webdavContentType(name),
    mtime: parseDate(entry.lastUsedAt) ?? parseDate(entry.addedAt),
    entry,
    file,
  };
}

function parseDate(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const releaseMtime = (e: UsenetLibraryEntry): Date | undefined =>
  parseDate(e.lastUsedAt) ?? parseDate(e.addedAt);

/**
 * Load available library entries (those with at least one browsable file). This
 * is the single source both trees are projected from, so the library and media
 * views never disagree about what exists. Pages through the repository so a
 * specific deep path still resolves past the first page; only a very large
 * library hitting {@link MAX_LIBRARY_ENTRIES} is capped (and logged).
 */
// Short-lived projection cache so a burst of PROPFIND/GET/HEAD lookups reuses
// one scan instead of re-listing the whole library each time. Two slots: the
// capped snapshot drives broad listings; the uncapped one is the fallback for
// resolving a specific deep path beyond MAX_LIBRARY_ENTRIES. Both are
// invalidated on any library change so deletes/adds show up immediately.
const PROJECTION_TTL_MS = 5000;
type Projection = {
  at: number;
  entries: UsenetLibraryEntry[];
  media?: MediaTriple[];
};
let cappedCache: Projection | null = null;
let uncappedCache: Projection | null = null;
usenetLibraryBus.on('change', () => {
  cappedCache = null;
  uncappedCache = null;
});

async function loadAvailableEntries(
  uncapped = false
): Promise<UsenetLibraryEntry[]> {
  const slot = uncapped ? uncappedCache : cappedCache;
  if (slot && Date.now() - slot.at < PROJECTION_TTL_MS) return slot.entries;
  const PAGE = 500;
  const result: UsenetLibraryEntry[] = [];
  let offset = 0;
  let total = 0;
  let fetched = 0;
  for (;;) {
    const res = await UsenetLibraryRepository.list({
      statuses: ['available'],
      limit: PAGE,
      offset,
      sort: 'name',
      dir: 'asc',
    });
    total = res.total;
    fetched += res.entries.length;
    // Count only browsable entries toward the cap; non-media `available` posts
    // (par2-only, etc.) must not push real items out of the projection.
    for (const e of res.entries) {
      if (e.files.some(isBrowsableFile)) result.push(e);
    }
    if (res.entries.length < PAGE) break;
    if (!uncapped && result.length >= MAX_LIBRARY_ENTRIES) break;
    offset += res.entries.length;
  }
  if (!uncapped && total > fetched) {
    logger.debug(
      { total, fetched, browsable: result.length, cap: MAX_LIBRARY_ENTRIES },
      'webdav listing capped; direct paths still resolve via the uncapped fallback'
    );
  }
  const proj: Projection = { at: Date.now(), entries: result };
  if (uncapped) uncappedCache = proj;
  else cappedCache = proj;
  return result;
}

function browsableFiles(entry: UsenetLibraryEntry): UsenetLibraryFile[] {
  return entry.files.filter(isBrowsableFile);
}

// ---------------------------------------------------------------------------
// Media (Movies/Series) classification
// ---------------------------------------------------------------------------

interface MediaClass {
  kind: 'movie' | 'series';
  /** Movie title or series show name. */
  title: string;
  /** Series season (undefined for movies / unparseable). */
  season?: number;
  year?: string;
}

/** Classify a library file as a movie or a series episode via title parsing. */
function classify(entry: UsenetLibraryEntry, file: UsenetLibraryFile): MediaClass {
  const basis = file.name ?? entry.name ?? entry.nzbHash;
  const parsed = parseTorrentTitle(basis);
  const fallbackParsed = parseTorrentTitle(entry.name ?? '');
  const season = parsed.seasons?.[0] ?? fallbackParsed.seasons?.[0];
  const episode = parsed.episodes?.[0] ?? fallbackParsed.episodes?.[0];
  const title =
    parsed.title?.trim() || fallbackParsed.title?.trim() || (entry.name ?? '');
  const year = parsed.year ?? fallbackParsed.year;
  // A season or episode marker (including season packs with no episode) means
  // series; only titles with neither are treated as movies.
  if (season != null || episode != null) {
    return { kind: 'series', title: title || 'Unknown', season, year };
  }
  return { kind: 'movie', title: title || 'Unknown', year };
}

const seasonFolder = (season: number): string =>
  `Season ${String(season).padStart(2, '0')}`;

const movieFolder = (m: MediaClass): string =>
  sanitizeSegment(m.year ? `${m.title} (${m.year})` : m.title);

type MediaTriple = {
  entry: UsenetLibraryEntry;
  file: UsenetLibraryFile;
  cls: MediaClass;
};

/** Flatten all available entries into (entry, file, class) triples. */
function mediaTriples(entries: UsenetLibraryEntry[]): MediaTriple[] {
  const out: MediaTriple[] = [];
  for (const entry of entries) {
    for (const file of browsableFiles(entry)) {
      out.push({ entry, file, cls: classify(entry, file) });
    }
  }
  return out;
}

/** Media triples for the current snapshot, memoized on the projection cache. */
async function loadMediaTriples(uncapped = false): Promise<MediaTriple[]> {
  const entries = await loadAvailableEntries(uncapped);
  const slot = uncapped ? uncappedCache : cappedCache;
  if (slot && slot.entries === entries) {
    if (!slot.media) slot.media = mediaTriples(entries);
    return slot.media;
  }
  return mediaTriples(entries);
}

/**
 * De-duplicate sibling file names within a media folder. Colliding names get a
 * suffix derived from the backing file's stable identity (content hash + index)
 * rather than iteration order, so a given file keeps the same path across
 * refreshes regardless of how the snapshot is ordered.
 */
function uniqueFileNodes(
  parentSegments: string[],
  items: Array<{ entry: UsenetLibraryEntry; file: UsenetLibraryFile }>
): WebdavFile[] {
  const counts = new Map<string, number>();
  for (const { entry, file } of items) {
    const base = sanitizeSegment(file.name ?? entry.nzbHash);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const used = new Set<string>();
  return items.map(({ entry, file }) => {
    const base = sanitizeSegment(file.name ?? entry.nzbHash);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let name = base;
    if ((counts.get(base) ?? 0) > 1) {
      // Stable per-file discriminator: prefer the inner archive path (unique
      // within an entry), else the NZB file index, qualified by the content
      // hash so it stays the same across refreshes.
      const disc = file.path ?? (file.index != null ? String(file.index) : '');
      const tag = disc
        ? `${entry.nzbHash.slice(0, 8)}-${sanitizeSegment(disc)}`
        : entry.nzbHash.slice(0, 8);
      name = `${stem} [${tag}]${ext}`;
    }
    // Safety net: guarantee uniqueness within the folder if even that collides.
    if (used.has(name)) {
      let k = 2;
      while (used.has(`${stem} [${entry.nzbHash.slice(0, 8)}-${k}]${ext}`)) k++;
      name = `${stem} [${entry.nzbHash.slice(0, 8)}-${k}]${ext}`;
    }
    used.add(name);
    return fileNode(name, [...parentSegments, name], entry, file);
  });
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a WebDAV path (segments below `/dav`) to a node plus, for collections,
 * its immediate children. Returns `undefined` when the path does not exist.
 * Both trees are projected from the same available-entries snapshot, so listing
 * and GET/DELETE resolution always agree.
 */
export async function resolveWebdavNode(
  segments: string[]
): Promise<WebdavResolved | undefined> {
  const shallow = await resolveAt(segments, false);
  // A deep path that missed the capped snapshot may still name a real entry
  // beyond MAX_LIBRARY_ENTRIES. Retry once against the uncapped snapshot before
  // 404ing, so direct GET/DELETE/PROPFIND of a known path never false-negatives.
  if (shallow || segments.length <= 1) return shallow;
  return resolveAt(segments, true);
}

async function resolveAt(
  segments: string[],
  uncapped: boolean
): Promise<WebdavResolved | undefined> {
  // Root: /dav
  if (segments.length === 0) {
    return {
      self: collection('', []),
      children: [
        collection(WEBDAV_LIBRARY_ROOT, [WEBDAV_LIBRARY_ROOT]),
        collection(WEBDAV_MEDIA_ROOT, [WEBDAV_MEDIA_ROOT]),
      ],
    };
  }

  const [root, ...rest] = segments;
  if (root === WEBDAV_LIBRARY_ROOT) return resolveLibrary(rest, uncapped);
  if (root === WEBDAV_MEDIA_ROOT) return resolveMedia(rest, uncapped);
  return undefined;
}

async function resolveLibrary(
  rest: string[],
  uncapped: boolean
): Promise<WebdavResolved | undefined> {
  const entries = await loadAvailableEntries(uncapped);

  // /dav/library → category folders
  if (rest.length === 0) {
    const cats = new Set<string>();
    for (const e of entries) cats.add(categoryFolder(e.category));
    return {
      self: collection(WEBDAV_LIBRARY_ROOT, [WEBDAV_LIBRARY_ROOT]),
      children: [...cats]
        .sort()
        .map((c) => collection(c, [WEBDAV_LIBRARY_ROOT, c])),
    };
  }

  const [catSeg, releaseSeg, fileSeg, ...extra] = rest;
  if (extra.length) return undefined;

  const inCat = entries.filter((e) => categoryFolder(e.category) === catSeg);

  // /dav/library/<cat> → release folders
  if (releaseSeg === undefined) {
    if (inCat.length === 0) return undefined;
    const folders = assignReleaseFolders(inCat);
    return {
      self: collection(catSeg, [WEBDAV_LIBRARY_ROOT, catSeg]),
      children: folders.map(({ folder, entry }) =>
        collection(folder, [WEBDAV_LIBRARY_ROOT, catSeg, folder], releaseMtime(entry))
      ),
    };
  }

  const match = assignReleaseFolders(inCat).find((f) => f.folder === releaseSeg);
  if (!match) return undefined;
  const { entry } = match;
  const files = assignFileNames(entry, browsableFiles(entry));

  // /dav/library/<cat>/<release> → files
  if (fileSeg === undefined) {
    return {
      self: collection(
        releaseSeg,
        [WEBDAV_LIBRARY_ROOT, catSeg, releaseSeg],
        releaseMtime(entry),
        entry
      ),
      children: files.map(({ name, file }) =>
        fileNode(name, [WEBDAV_LIBRARY_ROOT, catSeg, releaseSeg, name], entry, file)
      ),
    };
  }

  // /dav/library/<cat>/<release>/<file>
  const fileMatch = files.find((f) => f.name === fileSeg);
  if (!fileMatch) return undefined;
  return {
    self: fileNode(
      fileSeg,
      [WEBDAV_LIBRARY_ROOT, catSeg, releaseSeg, fileSeg],
      entry,
      fileMatch.file
    ),
    children: [],
  };
}

async function resolveMedia(
  rest: string[],
  uncapped: boolean
): Promise<WebdavResolved | undefined> {
  // /dav/media → Movies + Series
  if (rest.length === 0) {
    return {
      self: collection(WEBDAV_MEDIA_ROOT, [WEBDAV_MEDIA_ROOT]),
      children: [
        collection(WEBDAV_MEDIA_MOVIES, [WEBDAV_MEDIA_ROOT, WEBDAV_MEDIA_MOVIES]),
        collection(WEBDAV_MEDIA_SERIES, [WEBDAV_MEDIA_ROOT, WEBDAV_MEDIA_SERIES]),
      ],
    };
  }

  const triples = await loadMediaTriples(uncapped);
  const [kindSeg, ...tail] = rest;

  if (kindSeg === WEBDAV_MEDIA_MOVIES) return resolveMovies(triples, tail);
  if (kindSeg === WEBDAV_MEDIA_SERIES) return resolveSeries(triples, tail);
  return undefined;
}

function resolveMovies(
  triples: ReturnType<typeof mediaTriples>,
  tail: string[]
): WebdavResolved | undefined {
  const movies = triples.filter((t) => t.cls.kind === 'movie');
  const base = [WEBDAV_MEDIA_ROOT, WEBDAV_MEDIA_MOVIES];

  // /dav/media/Movies → movie folders
  if (tail.length === 0) {
    const byFolder = new Map<string, true>();
    for (const t of movies) byFolder.set(movieFolder(t.cls), true);
    return {
      self: collection(WEBDAV_MEDIA_MOVIES, base),
      children: [...byFolder.keys()]
        .sort()
        .map((f) => collection(f, [...base, f])),
    };
  }

  const [titleSeg, fileSeg, ...extra] = tail;
  if (extra.length) return undefined;
  const inMovie = movies.filter((t) => movieFolder(t.cls) === titleSeg);
  if (inMovie.length === 0) return undefined;

  // /dav/media/Movies/<title> → files
  if (fileSeg === undefined) {
    return {
      self: collection(titleSeg, [...base, titleSeg]),
      children: uniqueFileNodes([...base, titleSeg], inMovie),
    };
  }

  // /dav/media/Movies/<title>/<file>
  const node = uniqueFileNodes([...base, titleSeg], inMovie).find(
    (n) => n.name === fileSeg
  );
  return node ? { self: node, children: [] } : undefined;
}

function resolveSeries(
  triples: ReturnType<typeof mediaTriples>,
  tail: string[]
): WebdavResolved | undefined {
  const series = triples.filter((t) => t.cls.kind === 'series');
  const base = [WEBDAV_MEDIA_ROOT, WEBDAV_MEDIA_SERIES];
  const showFolder = (t: (typeof series)[number]) =>
    sanitizeSegment(t.cls.year ? `${t.cls.title} (${t.cls.year})` : t.cls.title);

  // /dav/media/Series → show folders
  if (tail.length === 0) {
    const shows = new Set<string>();
    for (const t of series) shows.add(showFolder(t));
    return {
      self: collection(WEBDAV_MEDIA_SERIES, base),
      children: [...shows].sort().map((s) => collection(s, [...base, s])),
    };
  }

  const [showSeg, seasonSeg, fileSeg, ...extra] = tail;
  if (extra.length) return undefined;
  const inShow = series.filter((t) => showFolder(t) === showSeg);
  if (inShow.length === 0) return undefined;

  // /dav/media/Series/<show> → season folders
  if (seasonSeg === undefined) {
    const seasons = new Set<string>();
    for (const t of inShow) seasons.add(seasonFolder(t.cls.season ?? 1));
    return {
      self: collection(showSeg, [...base, showSeg]),
      children: [...seasons].sort().map((s) => collection(s, [...base, showSeg, s])),
    };
  }

  const inSeason = inShow.filter(
    (t) => seasonFolder(t.cls.season ?? 1) === seasonSeg
  );
  if (inSeason.length === 0) return undefined;

  // /dav/media/Series/<show>/<season> → episode files
  if (fileSeg === undefined) {
    return {
      self: collection(seasonSeg, [...base, showSeg, seasonSeg]),
      children: uniqueFileNodes([...base, showSeg, seasonSeg], inSeason),
    };
  }

  // /dav/media/Series/<show>/<season>/<file>
  const node = uniqueFileNodes([...base, showSeg, seasonSeg], inSeason).find(
    (n) => n.name === fileSeg
  );
  return node ? { self: node, children: [] } : undefined;
}
