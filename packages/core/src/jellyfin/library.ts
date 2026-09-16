import pLimit from 'p-limit';
import { config as appConfig } from '../config/index.js';
import type { Meta, MetaPreview, UserData } from '../db/schemas.js';
import type { AIOStreams } from '../main/index.js';
import { Cache } from '../utils/cache.js';
import { createLogger } from '../logging/logger.js';
import { userScopeKey } from '../utils/user-scope.js';
import { viewId } from './ids.js';
import type { Catalog, CollectionType } from './dto.js';

const logger = createLogger('jellyfin');

export function catalogKey(c: Pick<Catalog, 'type' | 'id'>): string {
  return `${c.type}|${c.id}`;
}

function extra(c: Catalog, name: string) {
  return (c.extra ?? []).find((e) => e.name === name);
}

export function supportsExtra(c: Catalog, name: string): boolean {
  return !!extra(c, name);
}

/** Genre a required-genre catalog is browsed with when the client picks none. */
export function requiredGenreDefault(c: Catalog): string | undefined {
  const e = extra(c, 'genre');
  if (!e?.isRequired) return undefined;
  return (e.options ?? []).find(
    (o): o is string => typeof o === 'string' && o.length > 0
  );
}

export function genreOptions(c: Catalog): string[] {
  return (extra(c, 'genre')?.options ?? []).filter(
    (o): o is string => typeof o === 'string' && o.length > 0
  );
}

/** Catalogs a client can open as a library: not search-only, no unsatisfiable required extra. */
export function isBrowsable(c: Catalog): boolean {
  for (const e of c.extra ?? []) {
    if (!e.isRequired) continue;
    if (e.name === 'genre' && requiredGenreDefault(c)) continue;
    return false;
  }
  return true;
}

export function isSearchable(c: Catalog): boolean {
  return supportsExtra(c, 'search');
}

/** Libraries are the user's catalogs, in their order. */
export function exposedCatalogs(engine: AIOStreams): Catalog[] {
  return ((engine.getCatalogs() ?? []) as Catalog[]).filter(isBrowsable);
}

export interface CatalogPageOptions {
  startIndex: number;
  limit: number;
  genre?: string;
  search?: string;
  /** Walk to the end (or the cap) so the total is exact. */
  exactTotal?: boolean;
  /** Take whatever the first page holds instead of walking towards `limit`. */
  singlePage?: boolean;
  /** Narrows one raw page to the entries the caller will return. */
  select?: (page: MetaPreview[]) => MetaPreview[] | Promise<MetaPreview[]>;
  /** Scope for resuming the walk instead of restarting it. */
  cursorKey?: string;
  /** Entry keys to skip as if the catalog never held them. */
  exclude?: ReadonlySet<string>;
}

/** A page boundary the walk passed through. */
interface WalkMark {
  index: number;
  skip: number;
  read: number;
}

/**
 * Where a walk has already been, so a later page resumes from the nearest
 * boundary at or below its StartIndex rather than counting the catalog again.
 */
interface WalkTrail {
  /** Deduped entry keys in order; `keys.slice(0, mark.read)` is that mark's dedupe set. */
  keys: string[];
  marks: WalkMark[];
  done: boolean;
}

const walkTrailCache = Cache.getInstance<string, WalkTrail>(
  'jellyfin-catalog-trail',
  5000
);
/* Matches the catalog cache default, so a trail never outlives its pages. */
const WALK_TRAIL_TTL = 300;

/** Skip pages fetched at once once the page size is known. */
const WALK_CONCURRENCY = 4;
/** Searchable catalogs queried at once; search runs on every keystroke. */
const SEARCH_CONCURRENCY = 4;

function markFor(trail: WalkTrail, startIndex: number): WalkMark | undefined {
  let best: WalkMark | undefined;
  for (const mark of trail.marks)
    if (mark.index <= startIndex && (!best || mark.index > best.index))
      best = mark;
  return best;
}

async function saveTrail(key: string, trail: WalkTrail): Promise<void> {
  const existing = await walkTrailCache.get(key).catch(() => undefined);
  const merged: WalkTrail = existing
    ? {
        keys:
          existing.keys.length > trail.keys.length ? existing.keys : trail.keys,
        marks: [...existing.marks, ...trail.marks],
        done: existing.done || trail.done,
      }
    : trail;
  const byIndex = new Map(merged.marks.map((m) => [m.index, m]));
  merged.marks = [...byIndex.values()].sort((a, b) => a.index - b.index);
  // `forceWrite`: page k+1 arrives inside the write-buffer window.
  await walkTrailCache
    .set(key, merged, WALK_TRAIL_TTL, true)
    .catch(() => undefined);
}

export interface CatalogPage {
  items: MetaPreview[];
  total: number;
  hasMore: boolean;
  /** Keys of the entries read, complete once `hasMore` is false. */
  keys: string[];
}

function buildExtras(
  c: Catalog,
  opts: { genre?: string; search?: string; skip?: number }
): string | undefined {
  const parts: string[] = [];
  if (opts.search) parts.push(`search=${opts.search.replace(/[&=]/g, ' ')}`);
  const genre =
    opts.genre ?? (opts.search ? undefined : requiredGenreDefault(c));
  if (genre) parts.push(`genre=${genre.replace(/[&=]/g, ' ')}`);
  if (opts.skip) parts.push(`skip=${opts.skip}`);
  return parts.length ? parts.join('&') : undefined;
}

/**
 * Maps StartIndex/Limit onto Stremio skip pages. Returns `limit` items unless
 * the catalog ends first. `maxCatalogItems` bounds the raw entries read, not the
 * entries that survive `select`.
 */
export async function getCatalogPage(
  engine: AIOStreams,
  catalog: Catalog,
  opts: CatalogPageOptions
): Promise<CatalogPage> {
  if (opts.search && !isSearchable(catalog))
    return { items: [], total: 0, hasMore: false, keys: [] };
  if (opts.genre && !supportsExtra(catalog, 'genre'))
    return { items: [], total: 0, hasMore: false, keys: [] };

  const cap = appConfig.jellyfin.maxCatalogItems || Infinity;
  const canSkip = supportsExtra(catalog, 'skip');
  const wantEnd = opts.startIndex + opts.limit;
  const out: MetaPreview[] = [];
  const seen = new Set<string>();
  let read = 0;
  let offset = 0;
  let skip = 0;
  let stalled = 0;
  let exhausted = false;
  let capped = false;
  let guard = 0;
  /* Learned from the first page; 0 until then, which keeps the walk serial. */
  let pageSize = 0;
  /* Set once a page arrives at a size the batched skips did not assume. */
  let variablePages = false;

  const cursorKey =
    opts.cursorKey && canSkip
      ? `${opts.cursorKey}|${catalogKey(catalog)}|${opts.genre ?? ''}|${opts.search ?? ''}`
      : undefined;
  /* Ordered mirror of `seen`, so a boundary can name its own dedupe prefix. */
  const seenKeys: string[] = [];
  const marks: WalkMark[] = [];
  if (cursorKey && opts.startIndex > 0) {
    const trail = await walkTrailCache.get(cursorKey).catch(() => undefined);
    const mark = trail && markFor(trail, opts.startIndex);
    if (trail && mark) {
      offset = mark.index;
      skip = mark.skip;
      read = mark.read;
      for (const key of trail.keys.slice(0, mark.read)) {
        seen.add(key);
        seenKeys.push(key);
      }
    }
  }
  const fetchPage = async (pageSkip: number): Promise<MetaPreview[]> => {
    const extras = buildExtras(catalog, {
      genre: opts.genre,
      search: opts.search,
      skip: pageSkip,
    });
    const res = await engine.getCatalog(catalog.type, catalog.id, extras);
    if (res.errors?.length) {
      logger.debug(
        {
          catalog: catalogKey(catalog),
          errors: res.errors.map((e) =>
            [e.title, e.description].filter(Boolean).join(': ')
          ),
        },
        'catalog page returned errors'
      );
    }
    return res.data ?? [];
  };

  while (!exhausted && guard < 60) {
    if (!opts.exactTotal && offset >= wantEnd) break;
    if (read >= cap) {
      capped = true;
      break;
    }
    /* Skip pages are independent, so once the first has shown the page size
     * the rest of the walk runs a few at a time. */
    const ahead =
      canSkip && !opts.singlePage && pageSize > 0 && !variablePages
        ? Math.min(
            WALK_CONCURRENCY,
            Math.max(1, Math.ceil((wantEnd - offset) / pageSize))
          )
        : 1;
    const skips: number[] = [];
    for (let i = 0; i < ahead; i++) skips.push(skip + i * pageSize);
    guard += skips.length;
    const pages = await Promise.all(skips.map(fetchPage));

    for (let i = 0; i < pages.length; i++) {
      const data = pages[i];
      if (!data.length) {
        exhausted = true;
        break;
      }
      if (!pageSize) pageSize = data.length;
      // Taken before the page is consumed: a mark is only usable by a request
      // whose StartIndex it does not overshoot, so it has to sit on a boundary.
      if (cursorKey) marks.push({ index: offset, skip: skips[i], read });
      const fresh: MetaPreview[] = [];
      let novel = 0;
      for (const item of data) {
        if (!item?.id) continue;
        const key = `${item.type}|${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        novel++;
        if (opts.exclude?.has(key)) continue;
        seenKeys.push(key);
        fresh.push(item);
      }
      read += fresh.length;
      for (const item of opts.select ? await opts.select(fresh) : fresh) {
        if (offset >= opts.startIndex && offset < wantEnd && offset < cap)
          out.push(item);
        offset++;
      }
      skip = skips[i] + data.length;
      // Consecutive pages of nothing but repeats mean skip stopped advancing.
      stalled = novel ? 0 : stalled + 1;
      if (!canSkip || stalled >= 3) {
        exhausted = true;
        break;
      }
      if (read >= cap) {
        capped = true;
        break;
      }
      /*
       * The batch assumed `skip + n * pageSize`. A differently sized page makes
       * every skip after it wrong, stepping over unread entries, so the rest of
       * the batch is dropped and the walk goes serial from here.
       */
      if (data.length !== pageSize) {
        variablePages = true;
        break;
      }
    }
    if (opts.singlePage) break;
  }

  const done = exhausted || capped;
  const total = done ? Math.min(offset, cap) : offset + opts.limit;
  if (cursorKey && marks.length)
    await saveTrail(cursorKey, { keys: seenKeys, marks, done });
  return { items: out, total, hasMore: !done, keys: seenKeys };
}

/**
 * A page of a collection's members: listed items, then each source in turn, a
 * title kept where it first appears. A source is read once those before it end.
 */
export async function collectionMembers(
  engine: AIOStreams,
  meta: Pick<Meta, 'collection'>,
  opts: Pick<
    CatalogPageOptions,
    'startIndex' | 'limit' | 'exactTotal' | 'select' | 'cursorKey'
  >
): Promise<CatalogPage> {
  const want = opts.startIndex + opts.limit;
  const seen = new Set<string>();
  const listed = ((meta.collection?.items ?? []) as MetaPreview[]).filter(
    (entry) => {
      const key = `${entry.type}|${entry.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
  );
  const kept = opts.select ? await opts.select(listed) : listed;
  const out = kept.slice(opts.startIndex, want);
  let offset = kept.length;
  const walked = new Set<string>();
  for (const source of meta.collection?.sources ?? []) {
    if (!opts.exactTotal && offset >= want)
      return {
        items: out,
        total: offset + opts.limit,
        hasMore: true,
        keys: [],
      };
    const catalog = engine.findAddonCatalog(source.type, source.catalogId);
    // A repeated source adds nothing and would share the first one's cursor.
    const sourceKey = `${source.type}|${source.catalogId}|${source.genre ?? ''}`;
    if (!catalog || walked.has(sourceKey)) continue;
    walked.add(sourceKey);
    const start = Math.max(0, opts.startIndex - offset);
    const page = await getCatalogPage(engine, catalog, {
      startIndex: start,
      limit: Math.max(0, want - offset - start),
      genre: source.genre ?? undefined,
      exactTotal: opts.exactTotal,
      select: opts.select,
      cursorKey: opts.cursorKey,
      exclude: seen,
    }).catch(() => null);
    if (!page) continue;
    out.push(...page.items);
    if (page.hasMore)
      return {
        items: out,
        total: offset + page.total,
        hasMore: true,
        keys: [],
      };
    offset += page.total;
    for (const key of page.keys) seen.add(key);
  }
  return { items: out, total: offset, hasMore: false, keys: [...seen] };
}

const viewTypeCache = Cache.getInstance<string, string[]>(
  'jellyfin-views',
  20_000
);
const VIEW_TYPE_TTL = 6 * 60 * 60;
const SNIFF_CONCURRENCY = 4;
/** Keys in flight, so a burst of view requests starts one sweep, not many. */
const sniffing = new Set<string>();

function viewTypeKey(userData: UserData, catalog: Catalog): string {
  return `${userScopeKey(userData)}|${catalogKey(catalog)}`;
}

async function sniffEntryTypes(
  engine: AIOStreams,
  key: string,
  catalog: Catalog
): Promise<void> {
  try {
    const page = await getCatalogPage(engine, catalog, {
      startIndex: 0,
      limit: 20,
      singlePage: true,
    });
    const types = [
      ...new Set(
        page.items
          .map((m) => (m.collection ? COLLECTION_ENTRY : m.type))
          .filter(Boolean)
      ),
    ];
    await viewTypeCache.set(key, types, VIEW_TYPE_TTL);
  } catch (error) {
    // Left uncached so the next sweep retries instead of holding a failure.
    logger.debug(
      {
        catalog: catalogKey(catalog),
        err: error instanceof Error ? error.message : String(error),
      },
      'could not sniff catalog entry types'
    );
  }
}

/**
 * Sniffs the catalogs a view list had to guess at, for the next request to use.
 * Never awaited: a cold upstream takes tens of seconds over every catalog.
 */
function scheduleSniff(
  engine: AIOStreams,
  pending: { key: string; catalog: Catalog }[]
): void {
  const todo = pending.filter((p) => !sniffing.has(p.key));
  if (!todo.length) return;
  for (const p of todo) sniffing.add(p.key);
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const { key, catalog } = todo[cursor++];
      await sniffEntryTypes(engine, key, catalog);
      sniffing.delete(key);
    }
  };
  void Promise.all(
    Array.from({ length: Math.min(SNIFF_CONCURRENCY, todo.length) }, worker)
  ).catch(() => undefined);
}

/** Stands in for a sniffed entry's type when the entry is a collection. */
const COLLECTION_ENTRY = 'collection';

export type ViewKind = CollectionType | 'mixed' | 'hidden';

export function collectionTypeFor(
  catalog: Catalog,
  entryTypes: string[]
): ViewKind {
  const set = new Set(entryTypes);
  const playable = [...set].filter((t) => t !== 'tv' && t !== 'channel');
  if (set.size && !playable.length) return 'hidden';
  const boxsets = /collection/i.test(
    `${catalog.type} ${catalog.id} ${catalog.name}`
  );
  if (playable.length) {
    if (playable.every((t) => t === COLLECTION_ENTRY)) return 'boxsets';
    if (playable.every((t) => t === 'movie' || t === COLLECTION_ENTRY))
      return boxsets ? 'boxsets' : 'movies';
    if (playable.every((t) => t === 'series' || t === 'anime'))
      return 'tvshows';
    // Both kinds: fall through to the declared type, since a client may drop a
    // library with no CollectionType rather than browse it as mixed.
  }
  if (boxsets) return 'boxsets';
  switch (catalog.type) {
    case 'movie':
      return 'movies';
    case 'series':
    case 'anime':
      return 'tvshows';
    case 'tv':
    case 'channel':
      return 'hidden';
    default:
      return 'mixed';
  }
}

/** The view's `CollectionType`, absent when the catalog is not one kind. */
export function viewCollectionType(
  catalog: Catalog,
  entryTypes: string[]
): CollectionType | undefined {
  const kind = collectionTypeFor(catalog, entryTypes);
  return kind === 'mixed' || kind === 'hidden' ? undefined : kind;
}

export interface ViewEntry {
  id: string;
  catalog: Catalog;
  collectionType?: CollectionType;
}

export async function listViews(
  engine: AIOStreams,
  userData: UserData
): Promise<ViewEntry[]> {
  const catalogs = exposedCatalogs(engine);
  const sniffed = await Promise.all(
    catalogs.map(async (catalog) => {
      const key = viewTypeKey(userData, catalog);
      return {
        key,
        catalog,
        types: await viewTypeCache.get(key).catch(() => undefined),
      };
    })
  );

  const max = appConfig.jellyfin.maxLibraries;
  const pending: typeof sniffed = [];
  const out: ViewEntry[] = [];
  for (const entry of sniffed) {
    if (max > 0 && out.length >= max) break;
    const { catalog, types } = entry;
    if (!types) pending.push(entry);
    const kind = collectionTypeFor(catalog, types ?? []);
    if (kind === 'hidden') continue;
    out.push({
      id: viewId(catalog.type, catalog.id),
      catalog,
      collectionType: kind === 'mixed' ? undefined : kind,
    });
  }
  scheduleSniff(engine, pending);
  return out;
}

export function findCatalog(
  engine: AIOStreams,
  type: string,
  id: string
): Catalog | undefined {
  return ((engine.getCatalogs() ?? []) as Catalog[]).find(
    (c) => c.type === type && c.id === id
  );
}

export type ContentKind = 'movie' | 'series';

/** The kind an entry becomes as an item: every non-movie type builds a Series. */
export function entryKind(
  preview: Pick<MetaPreview, 'type' | 'collection'>
): ContentKind {
  return preview.type === 'movie' || preview.collection ? 'movie' : 'series';
}

function sniffedKind(type: string): ContentKind {
  return type === COLLECTION_ENTRY ? 'movie' : entryKind({ type });
}

/** Entry types already sniffed for this catalog's view; never a fresh fetch. */
async function cachedEntryTypes(
  userData: UserData,
  catalog: Catalog
): Promise<string[] | undefined> {
  return viewTypeCache
    .get(viewTypeKey(userData, catalog))
    .catch(() => undefined);
}

export async function catalogHasCollections(
  userData: UserData,
  catalog: Catalog
): Promise<boolean> {
  const types = await cachedEntryTypes(userData, catalog);
  return !!types?.includes(COLLECTION_ENTRY);
}

/** The kinds a catalog is known to yield, from the entry types sniffed for its view. */
export async function knownCatalogKinds(
  userData: UserData,
  catalog: Catalog
): Promise<ContentKind[] | undefined> {
  const types = await cachedEntryTypes(userData, catalog);
  if (!types?.length) return undefined;
  return [...new Set(types.map(sniffedKind))];
}

export async function searchCatalogs(
  engine: AIOStreams,
  term: string,
  limit: number,
  kinds?: ContentKind[],
  userData?: UserData
): Promise<MetaPreview[]> {
  const wanted = kinds ? new Set(kinds) : null;
  if (wanted && !wanted.size) return [];
  const searchable = ((engine.getCatalogs() ?? []) as Catalog[]).filter(
    isSearchable
  );
  const evidence =
    wanted && userData
      ? await Promise.all(searchable.map((c) => cachedEntryTypes(userData, c)))
      : [];
  const catalogs = !wanted
    ? searchable
    : searchable.filter((c, i) => {
        const types = evidence[i];
        return !types?.length || types.some((t) => wanted.has(sniffedKind(t)));
      });
  if (!catalogs.length) return [];
  /*
   * One page per catalog, not a walk to `limit`: this already fans out across
   * every searchable catalog, and the interleave below fills `limit` from that
   * breadth instead.
   */
  const pool = pLimit(SEARCH_CONCURRENCY);
  const results = await Promise.allSettled(
    catalogs.map((c) =>
      pool(() =>
        getCatalogPage(engine, c, {
          startIndex: 0,
          limit,
          search: term,
          singlePage: true,
        })
      )
    )
  );
  const lists = results.map((r) =>
    r.status === 'fulfilled'
      ? r.value.items.filter((i) => !wanted || wanted.has(entryKind(i)))
      : []
  );
  const seen = new Set<string>();
  const out: MetaPreview[] = [];
  for (let rank = 0; out.length < limit; rank++) {
    let drained = true;
    for (const list of lists) {
      if (rank >= list.length) continue;
      drained = false;
      const item = list[rank];
      const key = `${item.type}|${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= limit) break;
    }
    if (drained) break;
  }
  return out;
}
