import {
  UsenetLibraryRepository,
  usenetLibraryBus,
  type UsenetLibraryEntry,
  type UsenetLibraryFile,
  type UsenetLibraryStatus,
} from '../../db/index.js';
import {
  registerShareProvider,
  mimeForFilename,
  invalidateShareDirs,
  invalidateShareEntry,
  shareParentPath,
  ShareError,
  SHARE_EPOCH,
  type ShareCollection,
  type ShareContext,
  type ShareFile,
  type ShareNode,
  type ShareLink,
  type ShareProvider,
  type ShareRemoveOutcome,
} from '../../shares/index.js';
import { createHash } from 'node:crypto';
import { appConfig } from '../../utils/index.js';
import { openUsenetStream, usenetStreamEtag } from './stream-session.js';
import { libraryFileToken, libraryFileName, removeForArr } from './library.js';
import { encodeUsenetStreamToken } from './tokens.js';
import { stripNzbExt } from './naming.js';

/**
 * The usenet library as a share subtree, for whatever protocol serves it:
 *
 *   /usenet/by-id/<hash>/<index>/<name>     stable per-file address (link targets)
 *   /usenet/content/<category>/<job>/...    browsable view, archive members nested
 *   /usenet/completed/<category>/<job>/...  what a download client imports from:
 *                                           links / `.strm` files (or the bytes,
 *                                           per `arr.importMode`); DELETE hides
 *                                           the job once the arr is done
 *
 * Uncategorised jobs sit directly under `content/` and `completed/`.
 */
export const USENET_SHARE_ROOT = '/usenet';
const TREE_STATUSES: UsenetLibraryStatus[] = ['available', 'degraded'];
const PROJECTION_TTL_MS = 15_000;
/** Minted `.strm` tokens, so a leaf's bytes stay identical across requests. */
const STRM_TOKEN_CACHE_MAX = 10_000;

interface JobDir {
  dirs: Map<string, JobDir>;
  files: Map<string, UsenetLibraryFile>;
}

interface Projection {
  byHash: Map<string, UsenetLibraryEntry>;
  /** category ('' for none) -> job folder name -> entry */
  byCategory: Map<string, Map<string, UsenetLibraryEntry>>;
  /** The `completed/` subset: download-client rows, same job names. */
  completed: Map<string, Map<string, UsenetLibraryEntry>>;
}

let cached: { at: number; value: Promise<Projection> } | undefined;
/** Modified date of the synthetic folders, so cached listings expire. */
let libraryChangedAt = new Date();
usenetLibraryBus.on('change', () => {
  cached = undefined;
  libraryChangedAt = new Date();
  // A mounted client's listing is now stale, and the arr reads the mount
  // rather than us. The bus carries no payload, so whole-tree is as precise
  // as it gets.
  invalidateShareDirs(
    `${USENET_SHARE_ROOT}/completed`,
    `${USENET_SHARE_ROOT}/content`
  );
});

function projection(): Promise<Projection> {
  const now = Date.now();
  if (cached && now - cached.at < PROJECTION_TTL_MS) return cached.value;
  const value = buildProjection();
  cached = { at: now, value };
  value.catch(() => {
    if (cached?.value === value) cached = undefined;
  });
  return value;
}

async function buildProjection(): Promise<Projection> {
  const entries = (
    await UsenetLibraryRepository.listForTree({ statuses: TREE_STATUSES })
  ).filter((e) => !!e.nzbUrl);
  // by-id keeps hidden rows: the arr's imported links still point at them.
  const byHash = new Map(entries.map((e) => [e.nzbHash, e]));
  const grouped = new Map<string, UsenetLibraryEntry[]>();
  for (const entry of entries) {
    if (entry.hiddenAt) continue;
    const category = sanitizeShareName(entry.category ?? '');
    let list = grouped.get(category);
    if (!list) grouped.set(category, (list = []));
    list.push(entry);
  }
  const byCategory = new Map<string, Map<string, UsenetLibraryEntry>>();
  const completed = new Map<string, Map<string, UsenetLibraryEntry>>();
  for (const [category, list] of grouped) {
    const jobs = jobNames(list);
    byCategory.set(category, jobs);
    const arrJobs = new Map(
      [...jobs].filter(([, entry]) => entry.origin === 'sabnzbd')
    );
    if (arrJobs.size > 0) completed.set(category, arrJobs);
  }
  return { byHash, byCategory, completed };
}

/** Job folder names within one parent; colliders get a hash suffix. */
function jobNames(
  entries: UsenetLibraryEntry[]
): Map<string, UsenetLibraryEntry> {
  const wanted = new Map<string, UsenetLibraryEntry[]>();
  for (const entry of entries) {
    const name =
      sanitizeShareName(entry.name ?? entry.nzbHash) || entry.nzbHash;
    let list = wanted.get(name);
    if (!list) wanted.set(name, (list = []));
    list.push(entry);
  }
  const out = new Map<string, UsenetLibraryEntry>();
  for (const [name, list] of wanted) {
    if (list.length === 1) {
      out.set(name, list[0]);
      continue;
    }
    for (const entry of list) {
      out.set(`${name}-${entry.nzbHash.slice(0, 8)}`, entry);
    }
  }
  return out;
}

/**
 * Category + job folder an entry is listed under, shared with the SABnzbd
 * `storage` path so the arr finds the folder the API named.
 */
export async function completedJobPath(
  entry: UsenetLibraryEntry
): Promise<{ category: string; job: string } | undefined> {
  const { completed } = await projection();
  const category = sanitizeShareName(entry.category ?? '');
  const jobs = completed.get(category);
  if (!jobs) return undefined;
  for (const [job, candidate] of jobs) {
    if (candidate.nzbHash === entry.nzbHash) return { category, job };
  }
  return undefined;
}

/** A filesystem-safe folder name (same rule as the NZB export filename). */
export function sanitizeShareName(name: string): string {
  return stripNzbExt(name)
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 180);
}

function isAddressable(file: UsenetLibraryFile): boolean {
  return file.streamable !== false && file.index !== undefined;
}

function withIndex(name: string, index: number | undefined): string {
  const dot = name.lastIndexOf('.');
  return dot > 0
    ? `${name.slice(0, dot)}.${index}${name.slice(dot)}`
    : `${name}.${index}`;
}

/** Nested folders from archive-inner paths; leaves carry display names. */
function jobDir(entry: UsenetLibraryEntry): JobDir {
  const root: JobDir = { dirs: new Map(), files: new Map() };
  for (const file of entry.files) {
    if (!isAddressable(file)) continue;
    const folders = file.path
      ? file.path.split('/').slice(0, -1).filter(Boolean)
      : [];
    let dir = root;
    for (const segment of folders) {
      let sub = dir.dirs.get(segment);
      if (!sub)
        dir.dirs.set(segment, (sub = { dirs: new Map(), files: new Map() }));
      dir = sub;
    }
    let leaf = libraryFileName(entry, file);
    if (dir.files.has(leaf) || dir.dirs.has(leaf)) {
      leaf = withIndex(leaf, file.index);
    }
    dir.files.set(leaf, file);
  }
  return root;
}

function entryDate(entry: UsenetLibraryEntry): Date {
  const date = new Date(entry.addedAt);
  return Number.isNaN(date.getTime()) ? SHARE_EPOCH : date;
}

function collection(
  path: string,
  name: string,
  modified: Date,
  children: () => Promise<ShareNode[]>
): ShareCollection {
  return { kind: 'collection', path, name, modified, children };
}

function fileNode(
  path: string,
  name: string,
  entry: UsenetLibraryEntry,
  file: UsenetLibraryFile,
  ctx: ShareContext
): ShareFile {
  const token = libraryFileToken(entry, file, ctx.owner);
  return {
    kind: 'file',
    path,
    name,
    size: file.size,
    modified: entryDate(entry),
    etag: usenetStreamEtag(token, file.size),
    contentType: mimeForFilename(name),
    body: {
      type: 'stream',
      open: (range, signal) =>
        openUsenetStream(token, {
          start: range?.start,
          end: range?.endExclusive,
          suffixLength: range?.suffixLength,
          signal,
          clientIp: ctx.clientIp,
          share: true,
        }).catch((err) => {
          throw ShareError.from(err);
        }),
    },
  };
}

function dirNode(
  path: string,
  name: string,
  entry: UsenetLibraryEntry,
  dir: JobDir,
  ctx: ShareContext
): ShareCollection {
  return collection(path, name, entryDate(entry), async () => [
    ...[...dir.dirs].map(([n, d]) => dirNode(`${path}/${n}`, n, entry, d, ctx)),
    ...[...dir.files].map(([n, f]) =>
      fileNode(`${path}/${n}`, n, entry, f, ctx)
    ),
  ]);
}

// --- by-id ------------------------------------------------------------------

const BY_ID = `${USENET_SHARE_ROOT}/by-id`;

function byIdRoot(ctx: ShareContext): ShareCollection {
  return collection(BY_ID, 'by-id', libraryChangedAt, async () =>
    [...(await projection()).byHash.values()].map((e) => byIdEntry(e, ctx))
  );
}

function byIdEntry(
  entry: UsenetLibraryEntry,
  ctx: ShareContext
): ShareCollection {
  const path = `${BY_ID}/${entry.nzbHash}`;
  return collection(path, entry.nzbHash, entryDate(entry), async () =>
    entry.files.filter(isAddressable).map((f) => byIdFile(entry, f, ctx))
  );
}

function byIdFile(
  entry: UsenetLibraryEntry,
  file: UsenetLibraryFile,
  ctx: ShareContext
): ShareCollection {
  const index = String(file.index);
  const path = `${BY_ID}/${entry.nzbHash}/${index}`;
  const name = libraryFileName(entry, file);
  return collection(path, index, entryDate(entry), async () => [
    fileNode(`${path}/${name}`, name, entry, file, ctx),
  ]);
}

async function resolveById(
  rest: string[],
  ctx: ShareContext
): Promise<ShareNode | undefined> {
  if (rest.length === 0) return byIdRoot(ctx);
  const entry = (await projection()).byHash.get(rest[0]);
  if (!entry) return undefined;
  if (rest.length === 1) return byIdEntry(entry, ctx);
  const file = entry.files.find(
    (f) => isAddressable(f) && String(f.index) === rest[1]
  );
  if (!file) return undefined;
  if (rest.length === 2) return byIdFile(entry, file, ctx);
  const name = libraryFileName(entry, file);
  if (rest.length === 3 && rest[2] === name) {
    return fileNode(
      `${BY_ID}/${entry.nzbHash}/${file.index}/${name}`,
      name,
      entry,
      file,
      ctx
    );
  }
  return undefined;
}

// --- content ----------------------------------------------------------------

const CONTENT = `${USENET_SHARE_ROOT}/content`;

function jobNode(
  parent: string,
  name: string,
  entry: UsenetLibraryEntry,
  ctx: ShareContext
): ShareCollection {
  return dirNode(`${parent}/${name}`, name, entry, jobDir(entry), ctx);
}

function categoryNode(
  category: string,
  jobs: Map<string, UsenetLibraryEntry>,
  ctx: ShareContext
): ShareCollection {
  const path = `${CONTENT}/${category}`;
  return collection(path, category, libraryChangedAt, async () =>
    [...jobs].map(([name, entry]) => jobNode(path, name, entry, ctx))
  );
}

function contentRoot(ctx: ShareContext): ShareCollection {
  return collection(CONTENT, 'content', libraryChangedAt, async () => {
    const { byCategory } = await projection();
    const categories = [...byCategory.keys()].filter((c) => c !== '').sort();
    return [
      ...categories.map((c) => categoryNode(c, byCategory.get(c)!, ctx)),
      ...[...(byCategory.get('') ?? [])].map(([name, entry]) =>
        jobNode(CONTENT, name, entry, ctx)
      ),
    ];
  });
}

function resolveJob(
  path: string,
  name: string,
  entry: UsenetLibraryEntry,
  rest: string[],
  ctx: ShareContext
): ShareNode | undefined {
  let dir = jobDir(entry);
  let current = path;
  let currentName = name;
  for (let i = 0; i < rest.length; i++) {
    const segment = rest[i];
    const sub = dir.dirs.get(segment);
    if (sub) {
      dir = sub;
      current = `${current}/${segment}`;
      currentName = segment;
      continue;
    }
    const file = dir.files.get(segment);
    if (file && i === rest.length - 1) {
      return fileNode(`${current}/${segment}`, segment, entry, file, ctx);
    }
    return undefined;
  }
  return dirNode(current, currentName, entry, dir, ctx);
}

async function resolveContent(
  rest: string[],
  ctx: ShareContext
): Promise<ShareNode | undefined> {
  if (rest.length === 0) return contentRoot(ctx);
  const { byCategory } = await projection();
  const category = rest[0] === '' ? undefined : byCategory.get(rest[0]);
  if (category) {
    if (rest.length === 1) return categoryNode(rest[0], category, ctx);
    const entry = category.get(rest[1]);
    if (!entry) return undefined;
    return resolveJob(
      `${CONTENT}/${rest[0]}/${rest[1]}`,
      rest[1],
      entry,
      rest.slice(2),
      ctx
    );
  }
  const entry = byCategory.get('')?.get(rest[0]);
  if (!entry) return undefined;
  return resolveJob(
    `${CONTENT}/${rest[0]}`,
    rest[0],
    entry,
    rest.slice(1),
    ctx
  );
}

// --- completed --------------------------------------------------------------

const COMPLETED = `${USENET_SHARE_ROOT}/completed`;

const strmTokens = new Map<string, string>();

function strmToken(
  entry: UsenetLibraryEntry,
  file: UsenetLibraryFile,
  owner: string
): string {
  const key = `${entry.nzbHash}:${file.index}:${owner}`;
  const hit = strmTokens.get(key);
  if (hit) return hit;
  const token = encodeUsenetStreamToken(libraryFileToken(entry, file, owner));
  if (strmTokens.size >= STRM_TOKEN_CACHE_MAX) {
    const oldest = strmTokens.keys().next().value;
    if (oldest !== undefined) strmTokens.delete(oldest);
  }
  strmTokens.set(key, token);
  return token;
}

/**
 * Absolute symlink target: the file's `by-id` address under the mount as the
 * arr sees it. Absolute because the arr copies the link into its library and
 * then deletes the job folder it came from; a relative target would traverse
 * `..` through that now-missing directory and dangle. Empty when no mount
 * path is configured; the caller then serves the bytes.
 */
function linkTarget(
  entry: UsenetLibraryEntry,
  file: UsenetLibraryFile
): string {
  const mountDir = appConfig.arr.mountDir.trim().replace(/[\\/]+$/, '');
  if (!mountDir) return '';
  return [
    mountDir,
    USENET_SHARE_ROOT.replace(/^\//, ''),
    'by-id',
    entry.nzbHash,
    String(file.index),
    libraryFileName(entry, file),
  ].join('/');
}

function inlineNode(
  path: string,
  name: string,
  entry: UsenetLibraryEntry,
  text: string
): ShareFile {
  const digest = createHash('sha1').update(text).digest('hex').slice(0, 20);
  return {
    kind: 'file',
    path,
    name,
    size: Buffer.byteLength(text),
    modified: entryDate(entry),
    etag: `"i-${digest}"`,
    contentType: 'text/plain',
    body: { type: 'inline', text },
  };
}

/** The arr is done with the job: hide it (see `removeForArr`). */
function hideForArr(
  entry: UsenetLibraryEntry,
  jobPath: string
): () => Promise<ShareRemoveOutcome> {
  return async () => {
    const outcome = await removeForArr(entry.nzbHash, { deleteFiles: false });
    if (outcome === 'missing') return 'missing';
    invalidateShareEntry(shareParentPath(jobPath), jobPath.split('/').pop()!);
    return 'removed';
  };
}

/**
 * Leaves the arr has taken. Importing a symlink is "create it at the
 * destination, unlink the source", so a DELETE of one leaf must not retire
 * the whole job: the rest of a season pack still has to be there. The
 * tombstone makes one leaf look gone; the job retires once every leaf is
 * taken or the arr deletes the job folder itself. Tombstones expire because
 * they are the only record: a restart brings the leaf back either way.
 */
const TAKEN_LEAF_TTL_MS = 10 * 60_000;
const TAKEN_LEAVES_MAX = 5_000;
const takenLeaves = new Map<string, number>();
/** Last take per job, so the job folder's modified date moves with it. */
const takenAt = new Map<string, number>();

function jobChangedAt(entry: UsenetLibraryEntry): Date {
  const added = entryDate(entry);
  const taken = takenAt.get(entry.nzbHash);
  return taken !== undefined && taken > added.getTime()
    ? new Date(taken)
    : added;
}

function isTaken(hash: string, leaf: string): boolean {
  const key = `${hash}/${leaf}`;
  const until = takenLeaves.get(key);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  takenLeaves.delete(key);
  return false;
}

function takeLeaf(hash: string, leaf: string): void {
  if (takenLeaves.size >= TAKEN_LEAVES_MAX) {
    const now = Date.now();
    for (const [key, until] of takenLeaves) {
      if (until <= now) takenLeaves.delete(key);
    }
    // Insertion order, so the leftmost keys are the oldest takes.
    for (const key of takenLeaves.keys()) {
      if (takenLeaves.size < TAKEN_LEAVES_MAX) break;
      takenLeaves.delete(key);
    }
    for (const key of takenAt.keys()) {
      if (takenAt.size < TAKEN_LEAVES_MAX) break;
      takenAt.delete(key);
    }
  }
  const now = Date.now();
  takenLeaves.set(`${hash}/${leaf}`, now + TAKEN_LEAF_TTL_MS);
  takenAt.set(hash, now);
}

function takeForArr(
  entry: UsenetLibraryEntry,
  jobPath: string,
  leaf: string,
  siblings: string[]
): () => Promise<ShareRemoveOutcome> {
  return async () => {
    takeLeaf(entry.nzbHash, leaf);
    invalidateShareEntry(jobPath, leaf);
    invalidateShareDirs(jobPath);
    if (siblings.every((name) => isTaken(entry.nzbHash, name))) {
      await removeForArr(entry.nzbHash, { deleteFiles: false });
      invalidateShareEntry(shareParentPath(jobPath), jobPath.split('/').pop()!);
    }
    return 'removed';
  };
}

/** Leaves of a completed job: one per streamable file, flat. */
function completedLeaves(
  jobPath: string,
  entry: UsenetLibraryEntry,
  ctx: ShareContext
): Map<string, ShareFile | ShareLink> {
  const mode = appConfig.arr.importMode;
  const all = new Map<string, ShareFile | ShareLink>();
  for (const file of entry.files) {
    if (!isAddressable(file)) continue;
    let base = libraryFileName(entry, file);
    if ([...all.keys()].some((k) => k.startsWith(`${base}.`) || k === base)) {
      base = withIndex(base, file.index);
    }
    const target = mode === 'symlink' ? linkTarget(entry, file) : '';
    if (mode === 'symlink' && target) {
      all.set(base, {
        kind: 'link',
        path: `${jobPath}/${base}`,
        name: base,
        modified: entryDate(entry),
        target,
      });
    } else if (mode === 'strm') {
      const name = `${base}.strm`;
      const token = strmToken(entry, file, ctx.owner);
      const url =
        `${appConfig.bootstrap.baseUrl}/api/v1/usenet/stream/${token}/` +
        encodeURIComponent(libraryFileName(entry, file));
      all.set(name, inlineNode(`${jobPath}/${name}`, name, entry, url));
    } else {
      all.set(base, fileNode(`${jobPath}/${base}`, base, entry, file, ctx));
    }
  }
  const names = [...all.keys()];
  const leaves = new Map<string, ShareFile | ShareLink>();
  for (const [name, node] of all) {
    if (isTaken(entry.nzbHash, name)) continue;
    leaves.set(name, {
      ...node,
      remove: takeForArr(entry, jobPath, name, names),
    });
  }
  return leaves;
}

function completedJobNode(
  parent: string,
  name: string,
  entry: UsenetLibraryEntry,
  ctx: ShareContext
): ShareCollection {
  const path = `${parent}/${name}`;
  return {
    ...collection(path, name, jobChangedAt(entry), async () => [
      ...completedLeaves(path, entry, ctx).values(),
    ]),
    remove: hideForArr(entry, path),
  };
}

function completedCategoryNode(
  category: string,
  jobs: Map<string, UsenetLibraryEntry>,
  ctx: ShareContext
): ShareCollection {
  const path = `${COMPLETED}/${category}`;
  return collection(path, category, libraryChangedAt, async () =>
    [...jobs].map(([name, entry]) => completedJobNode(path, name, entry, ctx))
  );
}

function completedRoot(ctx: ShareContext): ShareCollection {
  return collection(COMPLETED, 'completed', libraryChangedAt, async () => {
    const { completed } = await projection();
    const categories = [...completed.keys()].filter((c) => c !== '').sort();
    return [
      ...categories.map((c) =>
        completedCategoryNode(c, completed.get(c)!, ctx)
      ),
      ...[...(completed.get('') ?? [])].map(([name, entry]) =>
        completedJobNode(COMPLETED, name, entry, ctx)
      ),
    ];
  });
}

async function resolveCompleted(
  rest: string[],
  ctx: ShareContext
): Promise<ShareNode | undefined> {
  if (rest.length === 0) return completedRoot(ctx);
  const { completed } = await projection();
  const category = rest[0] === '' ? undefined : completed.get(rest[0]);
  let parent: string;
  let jobName: string;
  let entry: UsenetLibraryEntry | undefined;
  let leafSegments: string[];
  if (category) {
    if (rest.length === 1) {
      return completedCategoryNode(rest[0], category, ctx);
    }
    parent = `${COMPLETED}/${rest[0]}`;
    jobName = rest[1];
    entry = category.get(jobName);
    leafSegments = rest.slice(2);
  } else {
    parent = COMPLETED;
    jobName = rest[0];
    entry = completed.get('')?.get(jobName);
    leafSegments = rest.slice(1);
  }
  if (!entry) return undefined;
  if (leafSegments.length === 0) {
    return completedJobNode(parent, jobName, entry, ctx);
  }
  if (leafSegments.length !== 1) return undefined;
  return completedLeaves(`${parent}/${jobName}`, entry, ctx).get(
    leafSegments[0]
  );
}

// --- provider ---------------------------------------------------------------

export const usenetShareProvider: ShareProvider = {
  name: 'usenet',
  scope: 'library',
  async resolve(segments, ctx) {
    if (segments.length === 0) {
      return collection(
        USENET_SHARE_ROOT,
        'usenet',
        libraryChangedAt,
        async () => [byIdRoot(ctx), completedRoot(ctx), contentRoot(ctx)]
      );
    }
    const [head, ...rest] = segments;
    if (head === 'by-id') return resolveById(rest, ctx);
    if (head === 'completed') return resolveCompleted(rest, ctx);
    if (head === 'content') return resolveContent(rest, ctx);
    return undefined;
  },
};

registerShareProvider(usenetShareProvider);
