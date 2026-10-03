import { Router, type Request, type Response } from 'express';
import {
  buildGenre,
  catalogHasCollections,
  filmographyCredits,
  findPerson,
  recommendedPreviews,
  sortCredits,
  titlePreviews,
  type FilmographyKind,
  Cache,
  collectionMembers,
  config as appConfig,
  contentItemType,
  defaultUserData,
  encodeItemId,
  findCatalog,
  genreId,
  genreOptions,
  getCatalogPage,
  getWatchStateProvider,
  isLeafEntry,
  knownCatalogKinds,
  latestSpellings,
  listResult,
  listViews,
  requiresGenre,
  searchCatalogs,
  seriesIdOf,
  seriesKeyOf,
  seriesKeyOfMatch,
  showsAiringBetween,
  supportsExtra,
  type ContentKind,
  stripInternal,
  type JellyfinItem,
  type MetaPreview,
  type ViewEntry,
  type WatchKind,
  type WatchStateRow,
} from '@aiostreams/core';
import { refreshWatchState } from './handoff.js';
import {
  jf,
  param,
  qb,
  qi,
  qlist,
  qs,
  type JellyfinRequestContext,
} from './context.js';
import {
  attachUserData,
  boxSetChildren,
  caughtUpOn,
  decodeForRequest,
  decodeItemForRequest,
  isBoxsetCatalog,
  isBoxsetEntry,
  episodesForSeries,
  itemForId,
  itemFromDescriptor,
  itemsFromPreviews,
  nextToAir,
  nextUpForSeries,
  rememberListMarkers,
  seasonsForSeries,
  viewItems,
} from './items.js';
import { getMeta } from './resolve.js';

const router: Router = Router({ mergeParams: true });

const withoutRequiredGenre = (views: ViewEntry[]) =>
  views.filter((v) => !requiresGenre(v.catalog));

function isKodi(ctx: JellyfinRequestContext): boolean {
  return /kodi/i.test(ctx.client.name);
}

function typeFilter(req: Request): Set<string> | null {
  const types = qlist(req, 'IncludeItemTypes').map((t) => t.toLowerCase());
  return types.length ? new Set(types) : null;
}

function isBoxsetOnly(types: Set<string> | null): boolean {
  return !!types && types.size === 1 && types.has('boxset');
}

function excludedTypes(req: Request): Set<string> {
  return new Set(qlist(req, 'ExcludeItemTypes').map((t) => t.toLowerCase()));
}

function excludeTypes(req: Request, items: JellyfinItem[]): JellyfinItem[] {
  const excluded = excludedTypes(req);
  return excluded.size
    ? items.filter((i) => !excluded.has(String(i.Type).toLowerCase()))
    : items;
}

/** Undefined without Fields: Jellyfin's single-item route takes none and always sends MediaSources. */
function wantsVersions(req: Request): boolean | undefined {
  const fields = qlist(req, 'Fields');
  if (!fields.length) return undefined;
  return fields.some((f) => f.toLowerCase() === 'mediasources');
}

/** Jellyfin's SortOrder, when a request gives one. */
function sortDescending(req: Request): boolean | undefined {
  const order = qs(req, 'SortOrder');
  return order ? order.toLowerCase().startsWith('desc') : undefined;
}

function filterByType(
  items: JellyfinItem[],
  types: Set<string> | null
): JellyfinItem[] {
  if (!types) return items;
  return items.filter((i) => types.has(String(i.Type).toLowerCase()));
}

/**
 * What a catalog listing can build. Anything else answers an empty list with a
 * zero total, since an empty page under a higher total makes clients refetch.
 */
const LISTABLE_TYPES = new Set(['movie', 'series', 'boxset']);
function catalogCanList(types: Set<string> | null): boolean {
  if (!types) return true;
  for (const t of types) if (LISTABLE_TYPES.has(t)) return true;
  return false;
}

/** The content kinds an IncludeItemTypes filter can be satisfied by. */
function searchKindsFor(types: Set<string> | null): ContentKind[] | undefined {
  if (!types) return undefined;
  const out = new Set<ContentKind>();
  // A collection is a movie-typed meta, and an episode only exists under a series.
  if (types.has('movie') || types.has('boxset')) out.add('movie');
  if (types.has('series') || types.has('episode')) out.add('series');
  return out.size ? [...out] : [];
}

/** Intersects two kind filters; undefined means "no opinion". */
function narrowKinds(
  a: ContentKind[] | undefined,
  b: ContentKind[] | undefined
): ContentKind[] | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.filter((k) => b.includes(k));
}

/**
 * The views a typed crawl draws from. What a catalog holds is only ever the
 * entry types sniffed for its view, never its type string, so a mixed anime
 * catalog belongs to the movie row and the series row alike.
 */
async function viewsForTypes(
  ctx: JellyfinRequestContext,
  views: ViewEntry[],
  types: Set<string> | null
): Promise<ViewEntry[]> {
  const kinds = searchKindsFor(types);
  if (!kinds) return views;
  // A collection is a movie-typed meta, so a boxset row would otherwise pull in
  // every movie catalog and filter it away item by item.
  const boxsetOnly = isBoxsetOnly(types);
  const evidence = await Promise.all(
    views.map((v) => knownCatalogKinds(ctx.userData, v.catalog))
  );
  const holdsCollections = boxsetOnly
    ? await Promise.all(
        views.map((v) => catalogHasCollections(ctx.userData, v.catalog))
      )
    : [];
  return views.filter((v, i) => {
    if (
      boxsetOnly &&
      v.collectionType !== 'boxsets' &&
      !holdsCollections[i] &&
      !isBoxsetCatalog(v.catalog)
    )
      return false;
    // A catalog not sniffed yet is crawled rather than silently dropped.
    const known = evidence[i];
    return !known || known.some((k) => kinds.includes(k));
  });
}

function kindsFor(types: Set<string> | null): WatchKind[] | undefined {
  if (!types) return undefined;
  const out: WatchKind[] = [];
  if (types.has('movie')) out.push('movie');
  if (types.has('episode')) out.push('episode');
  if (types.has('series')) out.push('series');
  return out.length ? out : undefined;
}

const USER_FILTERS = ['isplayed', 'isunplayed', 'isfavorite', 'isresumable'];

/** Whether a request asks for anything only `UserData` can answer. */
function hasUserFilters(req: Request): boolean {
  return (
    qlist(req, 'Filters').some((f) => USER_FILTERS.includes(f.toLowerCase())) ||
    qb(req, 'IsPlayed') !== undefined ||
    qb(req, 'IsFavorite') !== undefined
  );
}

/** Everything `select` reads, so one filter's walk cursor is never reused for another. */
function filterShape(req: Request, types: Set<string> | null): string {
  return [
    types ? [...types].sort().join(',') : '',
    [...excludedTypes(req)].sort().join(','),
    qlist(req, 'Filters')
      .map((f) => f.toLowerCase())
      .sort()
      .join(','),
    String(qb(req, 'IsPlayed') ?? ''),
    String(qb(req, 'IsFavorite') ?? ''),
  ].join('|');
}

/** Narrows each raw catalog page to the entries the request's filters keep. */
function pageFilter(
  req: Request,
  ctx: JellyfinRequestContext,
  types: Set<string> | null,
  opts: {
    parentId?: string;
    catalog?: { type: string; id: string; name: string };
  }
): (previews: MetaPreview[]) => Promise<MetaPreview[]> {
  const excluded = excludedTypes(req);
  const userFiltered = hasUserFilters(req);
  return async (previews) => {
    const evidence = await ctx.leafEvidence();
    const byType = previews.filter((p) => {
      const type = contentItemType(
        p.type,
        isBoxsetEntry(p, opts.catalog),
        isLeafEntry(p, evidence)
      ).toLowerCase();
      return (!types || types.has(type)) && !excluded.has(type);
    });
    // UserData is only known once the item is built, so this page costs a
    // watch-state lookup; the type filter above never does.
    if (!byType.length || !userFiltered) return byType;
    const built = await itemsFromPreviews(ctx, byType, opts);
    const kept = new Set(applyUserFilters(req, built).map((i) => i.Id));
    return byType.filter((_, i) => kept.has(built[i].Id));
  };
}

function applyUserFilters(req: Request, items: JellyfinItem[]): JellyfinItem[] {
  const filters = qlist(req, 'Filters').map((f) => f.toLowerCase());
  const isPlayed = qb(req, 'IsPlayed');
  const isFavorite = qb(req, 'IsFavorite');
  const ud = (i: JellyfinItem) =>
    i.UserData as
      | {
          Played: boolean;
          IsFavorite: boolean;
          PlaybackPositionTicks: number;
        }
      | undefined;
  let out = items;
  if (filters.includes('isplayed') || isPlayed === true)
    out = out.filter((i) => ud(i)?.Played);
  if (filters.includes('isunplayed') || isPlayed === false)
    out = out.filter((i) => !ud(i)?.Played);
  if (filters.includes('isfavorite') || isFavorite === true)
    out = out.filter((i) => ud(i)?.IsFavorite);
  if (filters.includes('isresumable'))
    out = out.filter((i) => (ud(i)?.PlaybackPositionTicks ?? 0) > 0);
  return out;
}

/* Catalog order is the only order that means anything; Random is the one sort honoured. */
function applySort(req: Request, items: JellyfinItem[]): JellyfinItem[] {
  const sortBy = qlist(req, 'SortBy').map((s) => s.toLowerCase());
  if (sortBy[0] !== 'random') return items;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Jellyfin skips the count when a client opts out and answers with the page
 * length instead, so a client that never reads the total does not make us walk
 * the catalog for it.
 */
function wantsTotal(req: Request): boolean {
  return qb(req, 'EnableTotalRecordCount') !== false;
}

/**
 * How many items one library request may return.
 */
function browseLimit(req: Request): number {
  const cap = Math.min(500, Math.max(100, appConfig.jellyfin.maxCatalogItems));
  return Math.min(Math.max(1, qi(req, 'Limit', 100)), cap);
}

function send(
  req: Request,
  res: Response,
  items: JellyfinItem[],
  total?: number,
  startIndex = 0
) {
  if (req.jf) rememberListMarkers(req.jf, items);
  const out = items.map(stripInternal);
  res.json(listResult(out, wantsTotal(req) ? total : out.length, startIndex));
}

/** Rows in flight while building a shelf; each one costs a meta lookup. */
export const ROW_CONCURRENCY = 6;

/** Runs `fn` over `items` with a few in flight, keeping the input order. */
export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

async function take<T>(source: AsyncIterator<T>, n: number): Promise<T[]> {
  const out: T[] = [];
  while (out.length < n) {
    const next = await source.next();
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

const CATALOG_READ_AHEAD = 4;

/**
 * Reads results in order while the next few are already in flight, so a row
 * that stops early starts at most a few fetches it never reads. `fetch` must
 * not reject.
 */
function readAhead<R>(
  count: number,
  fetch: (index: number) => Promise<R>
): (index: number) => Promise<R> {
  const started = new Map<number, Promise<R>>();
  return (index) => {
    const end = Math.min(index + CATALOG_READ_AHEAD, count);
    for (let i = index; i < end; i++) {
      if (!started.has(i)) started.set(i, fetch(i));
    }
    return started.get(index)!;
  };
}

async function itemsFromRows(
  ctx: JellyfinRequestContext,
  rows: WatchStateRow[]
): Promise<JellyfinItem[]> {
  const { descriptorForWatchRow } = await import('@aiostreams/core');
  const built = await mapLimited(rows, ROW_CONCURRENCY, (row) =>
    itemFromDescriptor(ctx, descriptorForWatchRow(row), {
      playstate: row,
    }).catch(() => null)
  );
  // Rows under different id spaces can build the same item; the first is newest.
  const seen = new Set<string>();
  return built.filter((item): item is JellyfinItem => {
    if (!item || seen.has(item.Id)) return false;
    seen.add(item.Id);
    return true;
  });
}

router.get(
  ['/UserViews', '/Users/:userId/Views'],
  jf(async (req, res, ctx) => {
    const items = await viewItems(ctx);
    send(req, res, items, items.length);
  })
);
router.get(
  ['/UserViews/GroupingOptions', '/Users/:userId/GroupingOptions'],
  jf(async (_req, res, ctx) => {
    res.json((await viewItems(ctx)).map((i) => ({ Name: i.Name, Id: i.Id })));
  })
);
router.get(
  ['/Library/MediaFolders', '/Library/VirtualFolders'],
  jf(async (req, res, ctx) => {
    const items = await viewItems(ctx);
    if (/MediaFolders/i.test(req.path)) {
      send(req, res, items, items.length);
      return;
    }
    res.json(
      items.map((i) => ({
        Name: i.Name,
        Locations: [i.Path],
        CollectionType: i.CollectionType ?? null,
        LibraryOptions: {
          Enabled: true,
          EnableRealtimeMonitor: false,
          PathInfos: [],
        },
        ItemId: i.Id,
        PrimaryImageItemId: i.Id,
        RefreshStatus: 'Idle',
      }))
    );
  })
);

async function handleItems(
  req: Request,
  res: Response,
  ctx: JellyfinRequestContext
) {
  const startIndex = Math.max(0, qi(req, 'StartIndex', 0));
  const limit = browseLimit(req);
  const parentId = qs(req, 'ParentId');
  const ids = qlist(req, 'Ids');
  const searchTerm = qs(req, 'SearchTerm')?.trim();
  const types = typeFilter(req);
  const genre = qlist(req, 'Genres')[0];
  const genreIds = qlist(req, 'GenreIds');
  const filters = qlist(req, 'Filters').map((f) => f.toLowerCase());
  const wantsFavorites =
    filters.includes('isfavorite') || qb(req, 'IsFavorite') === true;
  const wantsPlayed =
    filters.includes('isplayed') || qb(req, 'IsPlayed') === true;
  const wantsResumable = filters.includes('isresumable');
  const recursive = qb(req, 'Recursive') ?? false;
  const personIds = qlist(req, 'PersonIds');

  if (ids.length) {
    // Resolving runs the stream pipeline, so a lookup of several ids never does.
    const resolve = ids.length === 1 && (wantsVersions(req) ?? false);
    const built = await mapLimited(ids.slice(0, 200), ROW_CONCURRENCY, (id) =>
      itemForId(req, ctx, id, { resolve, listed: true }).catch(() => null)
    );
    const items = applySort(
      req,
      excludeTypes(
        req,
        applyUserFilters(
          req,
          filterByType(
            built.filter((item): item is JellyfinItem => !!item),
            types
          )
        )
      )
    );
    const end = qs(req, 'Limit') ? startIndex + limit : items.length;
    send(req, res, items.slice(startIndex, end), items.length, startIndex);
    return;
  }

  const engine = await ctx.engine();

  const parent = parentId ? await decodeForRequest(ctx, parentId) : null;
  const pd = parent?.kind === 'descriptor' ? parent.descriptor : null;

  // A collection meta is a BoxSet whatever type it is served as.
  const collectionParent =
    pd?.k === 'series'
      ? !!(await getMeta(ctx, pd.t, pd.i).catch(() => null))?.collection
      : false;
  if (pd?.k === 'series' && !collectionParent) {
    if (types?.has('episode') || recursive) {
      const r = await episodesForSeries(ctx, pd);
      const eps = applyUserFilters(req, r?.episodes ?? []);
      send(
        req,
        res,
        filterByType(eps, types ?? new Set(['episode'])).slice(
          startIndex,
          startIndex + limit
        ),
        eps.length,
        startIndex
      );
      return;
    }
    const seasons = (await seasonsForSeries(ctx, pd))?.seasons ?? [];
    send(
      req,
      res,
      seasons.slice(startIndex, startIndex + limit),
      seasons.length,
      startIndex
    );
    return;
  }
  if (pd?.k === 'season') {
    const eps = applyUserFilters(
      req,
      (await episodesForSeries(ctx, pd, pd.s))?.episodes ?? []
    );
    send(
      req,
      res,
      eps.slice(startIndex, startIndex + limit),
      eps.length,
      startIndex
    );
    return;
  }
  if (
    pd?.k === 'boxset' ||
    (pd?.k === 'movie' && !pd.p) ||
    (pd?.k === 'series' && collectionParent)
  ) {
    const meta = await getMeta(ctx, pd.t, pd.i).catch(() => null);
    if (meta?.collection) {
      const page = await collectionMembers(engine, meta, {
        startIndex,
        limit,
        exactTotal: isKodi(ctx) && wantsTotal(req),
        cursorKey: `${ctx.scope()}|${filterShape(req, types)}|${pd.t}|${pd.i}`,
        select: pageFilter(req, ctx, types, { parentId }),
        kinds: searchKindsFor(types),
        collectionsOnly: isBoxsetOnly(types),
      });
      const items = await itemsFromPreviews(ctx, page.items, { parentId });
      send(req, res, applySort(req, items), page.total, startIndex);
      return;
    }
    const r = await boxSetChildren(ctx, pd);
    const children = excludeTypes(
      req,
      filterByType(applyUserFilters(req, r?.children ?? []), types)
    );
    send(
      req,
      res,
      applySort(req, children.slice(startIndex, startIndex + limit)),
      children.length,
      startIndex
    );
    return;
  }
  if (pd?.k === 'person' || personIds.length) {
    let name: string | null = pd?.k === 'person' ? pd.n : null;
    if (!name && personIds.length) {
      const p = await decodeForRequest(ctx, personIds[0]);
      if (p?.kind === 'descriptor' && p.descriptor.k === 'person')
        name = p.descriptor.n;
    }
    const found = name ? await findPerson(ctx.userData, name) : null;
    if (found) {
      const kinds = types
        ? (['movie', 'series'] as FilmographyKind[]).filter((k) => types.has(k))
        : undefined;
      const credits = sortCredits(
        filmographyCredits(found.person, kinds),
        qlist(req, 'SortBy'),
        sortDescending(req)
      );
      const previews = await titlePreviews(
        engine,
        found.tmdb,
        credits.slice(startIndex, startIndex + limit)
      );
      const items = await itemsFromPreviews(ctx, previews);
      send(req, res, excludeTypes(req, items), credits.length, startIndex);
      return;
    }
    // Without TMDB, a search for the name finds what it can.
    const previews = name ? await searchCatalogs(engine, name, limit) : [];
    const items = filterByType(await itemsFromPreviews(ctx, previews), types);
    send(req, res, items, items.length, 0);
    return;
  }

  // Watch state is keyed by content identity and cannot say which catalog an
  // item came from, so only unscoped lists come from the provider; a scoped
  // request falls through to that catalog's page, where the filter is exact.
  // A library's episodes by air date, as a calendar asks for them, are the
  // episodes of the shows being watched.
  const minPremiere = Date.parse(qs(req, 'MinPremiereDate') ?? '');
  const maxPremiere = Date.parse(qs(req, 'MaxPremiereDate') ?? '');
  if (
    !parentId &&
    types?.has('episode') &&
    (Number.isFinite(minPremiere) || Number.isFinite(maxPremiere))
  ) {
    refreshWatchState(ctx);
    const episodes = await airingEpisodes(
      ctx,
      Number.isFinite(minPremiere) ? minPremiere : 0,
      Number.isFinite(maxPremiere) ? maxPremiere : Infinity
    );
    const pageEnd =
      startIndex + Math.min(Math.max(1, qi(req, 'Limit', 500)), 500);
    send(
      req,
      res,
      episodes.slice(startIndex, pageEnd),
      episodes.length,
      startIndex
    );
    return;
  }

  if ((wantsFavorites || wantsPlayed || wantsResumable) && !parentId) {
    refreshWatchState(ctx);
    const provider = getWatchStateProvider();
    const kinds = kindsFor(types);
    const rows = wantsFavorites
      ? await provider.listFavorites(ctx.watch, kinds)
      : wantsResumable
        ? await latestSpellings(
            ctx.watch,
            await provider.listResume(
              ctx.watch,
              startIndex + limit,
              kinds ?? ['movie', 'episode']
            )
          )
        : await provider.listPlayed(ctx.watch, kinds);
    const items = applySort(
      req,
      filterByType(
        await itemsFromRows(ctx, rows.slice(0, startIndex + limit)),
        types
      )
    );
    send(
      req,
      res,
      items.slice(startIndex, startIndex + limit),
      rows.length,
      startIndex
    );
    return;
  }

  let genreFromId = genre;
  let catalogDesc: { t: string; c: string } | null = null;
  if (pd?.k === 'view') catalogDesc = pd;
  else if (pd?.k === 'genre') {
    catalogDesc = pd;
    genreFromId = pd.g;
  }
  if (genreIds.length && pd?.k !== 'genre') {
    const g = await decodeForRequest(ctx, genreIds[0]);
    const d = g?.kind === 'descriptor' ? g.descriptor : null;
    // Jellyfin clients filter a library by its genre this way.
    if (
      d?.k === 'genre' &&
      (!catalogDesc || (d.t === catalogDesc.t && d.c === catalogDesc.c))
    ) {
      genreFromId = d.g;
      if (d.c) catalogDesc = d;
    }
  }

  if (catalogDesc) {
    const catalog = findCatalog(engine, catalogDesc.t, catalogDesc.c);
    if (
      !catalog ||
      !catalogCanList(types) ||
      (requiresGenre(catalog) && !genreFromId && !searchTerm)
    ) {
      send(req, res, [], 0, startIndex);
      return;
    }
    if (searchTerm && !supportsExtra(catalog, 'search')) {
      const kinds = narrowKinds(
        searchKindsFor(types),
        await knownCatalogKinds(ctx.userData, catalog)
      );
      const previews = await searchCatalogs(
        engine,
        searchTerm,
        startIndex + limit,
        kinds,
        ctx.userData
      );
      const items = filterByType(await itemsFromPreviews(ctx, previews), types);
      send(
        req,
        res,
        items.slice(startIndex, startIndex + limit),
        items.length,
        startIndex
      );
      return;
    }
    const page = await getCatalogPage(engine, catalog, {
      startIndex,
      limit,
      genre: genreFromId,
      search: searchTerm,
      exactTotal: isKodi(ctx) && wantsTotal(req),
      cursorKey: `${ctx.scope()}|${filterShape(req, types)}`,
      select: pageFilter(req, ctx, types, { parentId, catalog }),
    });
    const items = await itemsFromPreviews(ctx, page.items, {
      parentId,
      catalog,
    });
    send(req, res, applySort(req, items), page.total, startIndex);
    return;
  }

  if (searchTerm) {
    const previews = await searchCatalogs(
      engine,
      searchTerm,
      startIndex + limit,
      searchKindsFor(types),
      ctx.userData
    );
    const items = filterByType(await itemsFromPreviews(ctx, previews), types);
    send(
      req,
      res,
      items.slice(startIndex, startIndex + limit),
      items.length,
      startIndex
    );
    return;
  }

  if (!parentId && !recursive) {
    const views = await viewItems(ctx);
    send(req, res, views, views.length);
    return;
  }

  /* A parent that resolved to nothing browsable holds nothing. */
  if (parentId) {
    send(req, res, [], 0, startIndex);
    return;
  }
  /* a crawl with no parent gets the first page of each library, never a walk */
  if (!catalogCanList(types)) {
    send(req, res, [], 0, startIndex);
    return;
  }
  const views = withoutRequiredGenre(
    await viewsForTypes(ctx, await ctx.views(), types)
  );
  const want = startIndex + limit;
  const items: JellyfinItem[] = [];
  let offset = 0;
  let more = false;
  const pageAt = readAhead(views.length, (i) =>
    getCatalogPage(engine, views[i].catalog, {
      startIndex: 0,
      limit: Math.min(want - offset, 50),
    }).catch(() => null)
  );
  for (const [i, view] of views.entries()) {
    if (items.length >= limit) {
      more = true;
      break;
    }
    const page = await pageAt(i);
    if (!page) continue;
    // Counted after the type filter, so StartIndex walks the row a client sees.
    const built = filterByType(
      await itemsFromPreviews(ctx, page.items, {
        parentId: view.id,
        catalog: view.catalog,
      }),
      types
    );
    for (const item of built) {
      if (offset >= startIndex && items.length < limit) items.push(item);
      offset++;
    }
  }
  send(req, res, items, more ? want + limit : offset, startIndex);
}

router.get(['/Items', '/Users/:userId/Items'], jf(handleItems));

router.get(
  ['/Items/Latest', '/Users/:userId/Items/Latest'],
  jf(async (req, res, ctx) => {
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 16)), 100);
    const parentId = qs(req, 'ParentId');
    const types = typeFilter(req);
    const engine = await ctx.engine();
    let items: JellyfinItem[] = [];
    if (parentId) {
      const d = await decodeForRequest(ctx, parentId);
      if (d?.kind === 'descriptor' && d.descriptor.k === 'view') {
        const catalog = findCatalog(engine, d.descriptor.t, d.descriptor.c);
        if (catalog && !requiresGenre(catalog)) {
          const page = await getCatalogPage(engine, catalog, {
            startIndex: 0,
            limit,
          });
          items = await itemsFromPreviews(ctx, page.items, {
            parentId,
            catalog,
          });
        }
      }
    } else {
      const views = withoutRequiredGenre(
        await viewsForTypes(ctx, await ctx.views(), types)
      );
      const per = Math.max(4, Math.ceil(limit / Math.max(1, views.length)));
      const pageAt = readAhead(views.length, (i) =>
        getCatalogPage(engine, views[i].catalog, {
          startIndex: 0,
          limit: per,
        }).catch(() => null)
      );
      for (const [i, view] of views.entries()) {
        const page = await pageAt(i);
        if (page)
          items.push(
            // Filtered per catalog, or a mixed one spends its share on the
            // kind the row did not ask for.
            ...filterByType(
              await itemsFromPreviews(ctx, page.items, {
                parentId: view.id,
                catalog: view.catalog,
              }),
              types
            )
          );
        if (items.length >= limit) break;
      }
    }
    const latest = filterByType(items, types).slice(0, limit);
    rememberListMarkers(ctx, latest);
    res.json(latest.map(stripInternal));
  })
);

router.get(
  ['/UserItems/Resume', '/Users/:userId/Items/Resume'],
  jf(async (req, res, ctx) => {
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 12)), 100);
    const startIndex = Math.max(0, qi(req, 'StartIndex', 0));
    const mediaTypes = qlist(req, 'MediaTypes').map((m) => m.toLowerCase());
    if (mediaTypes.length && !mediaTypes.includes('video')) {
      send(req, res, [], 0, startIndex);
      return;
    }
    /* Not attributable to a catalog; see the watch-state branch in handleItems. */
    if (qs(req, 'ParentId')) {
      send(req, res, [], 0, startIndex);
      return;
    }
    refreshWatchState(ctx);
    const kinds = kindsFor(typeFilter(req))?.filter((k) => k !== 'series') ?? [
      'movie',
      'episode',
    ];
    const rows = await latestSpellings(
      ctx.watch,
      await getWatchStateProvider().listResume(
        ctx.watch,
        startIndex + limit,
        kinds.length ? kinds : ['movie', 'episode']
      )
    );
    const items = await itemsFromRows(ctx, rows);
    send(
      req,
      res,
      items.slice(startIndex, startIndex + limit),
      items.length,
      startIndex
    );
  })
);

/** How many of the most recently watched shows Next Up looks through. */
const NEXT_UP_SHOWS = 200;

router.get(
  '/Shows/NextUp',
  jf(async (req, res, ctx) => {
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 12)), 50);
    /* A ParentId that is a library cannot resolve to a series, so it answers empty. */
    const seriesId = qs(req, 'SeriesId') ?? qs(req, 'ParentId');
    const includeResumable = qb(req, 'EnableResumable') ?? true;
    refreshWatchState(ctx);
    const provider = getWatchStateProvider();
    const items: JellyfinItem[] = [];
    if (seriesId) {
      const d = await decodeForRequest(ctx, seriesId);
      if (
        d?.kind === 'descriptor' &&
        (d.descriptor.k === 'series' || d.descriptor.k === 'movie')
      ) {
        const rows = await provider.listForSeries(
          ctx.watch,
          seriesKeyOf(d.descriptor.i)
        );
        // An import shares one `updated_at` across a whole show.
        rows.sort(
          (a, b) =>
            b.sortAt - a.sortAt ||
            (b.season ?? 0) - (a.season ?? 0) ||
            (b.episode ?? 0) - (a.episode ?? 0)
        );
        // Anchored on the last episode watched, as the shelf is; a row left by
        // an unmarked episode or a favourite says nothing about progress.
        const last = rows.find((r) => r.played || r.positionMs > 0);
        const next = await nextUpForSeries(ctx, d.descriptor, last, {
          includeResumable,
        });
        if (next) items.push(next);
      }
    } else {
      const recent = provider.recentSeries(ctx.watch, limit * 4);
      /* One show can sit under several series keys; see `itemsFromRows`. */
      const shown = new Set<string>();
      // Reaching the limit mid-batch wastes at most the rest of that batch.
      for (
        let checked = 0;
        items.length < limit && checked < NEXT_UP_SHOWS;
        checked += ROW_CONCURRENCY
      ) {
        const rows = await take(recent, ROW_CONCURRENCY);
        if (!rows.length) break;
        const batch = await mapLimited(rows, ROW_CONCURRENCY, async (row) => {
          const d = {
            t: row.mediaType,
            i: seriesIdOf(row.baseId, row.videoId, row.mediaType),
          };
          // A part-played anchor can still come back to resume.
          if (row.played && (await caughtUpOn(ctx, d).catch(() => false)))
            return null;
          return nextUpForSeries(ctx, d, row, { includeResumable }).catch(
            () => null
          );
        });
        for (const next of batch) {
          if (items.length >= limit) break;
          if (!next || (next.UserData as { Played: boolean }).Played) continue;
          const series = String(next.SeriesId ?? next.Id);
          if (shown.has(series)) continue;
          shown.add(series);
          items.push(next);
        }
      }
    }
    send(req, res, items, items.length, 0);
  })
);

const UPCOMING_SERIES = 60;
/** How many watchlisted shows, and films, Upcoming looks at, newest first. */
const UPCOMING_WATCHLIST = 100;
const UPCOMING_CONCURRENCY = 4;
const DAY_MS = 86_400_000;
/** How far back a range may reach: the whole grid of the month before the current one. */
const DATED_PAST_DAYS = 75;
const DATED_FUTURE_DAYS = 365;
const DATED_TTL = 6 * 60 * 60;

/* One show's episodes that air near now, so a range reads no meta while it lasts. */
const datedEpisodes = Cache.getInstance<string, JellyfinItem[]>(
  'jellyfin-dated-episodes',
  20_000
);

function premiereOf(item: JellyfinItem): number {
  const at = Date.parse(String(item.PremiereDate ?? ''));
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
}

async function datedForSeries(
  ctx: JellyfinRequestContext,
  row: WatchStateRow,
  now: number
): Promise<JellyfinItem[]> {
  const d = {
    t: row.mediaType,
    i: seriesIdOf(row.baseId, row.videoId, row.mediaType),
  };
  const key = `${ctx.scope()}|${d.t}|${d.i}`;
  const cached = await datedEpisodes.get(key).catch(() => undefined);
  if (cached) return cached;
  const res = await episodesForSeries(ctx, d);
  if (!res) return [];
  const from = now - DATED_PAST_DAYS * DAY_MS;
  const to = now + DATED_FUTURE_DAYS * DAY_MS;
  const dated = res.episodes.filter((e) => {
    const at = premiereOf(e);
    return e.ParentIndexNumber !== 0 && at >= from && at <= to;
  });
  void datedEpisodes.set(key, dated, DATED_TTL).catch(() => undefined);
  return dated;
}

/* A film that premieres ahead, so Upcoming reads no meta while it lasts. */
const datedFilms = Cache.getInstance<string, JellyfinItem[]>(
  'jellyfin-dated-films',
  20_000
);

async function datedFilm(
  ctx: JellyfinRequestContext,
  row: WatchStateRow,
  now: number
): Promise<JellyfinItem[]> {
  const d = { k: 'movie' as const, t: row.mediaType, i: row.baseId };
  const key = `${ctx.scope()}|${d.t}|${d.i}`;
  const cached = await datedFilms.get(key).catch(() => undefined);
  if (cached) return cached;
  const item = await itemFromDescriptor(ctx, d);
  const at = item ? premiereOf(item) : 0;
  const dated =
    item?.Type === 'Movie' && at > now && at <= now + DATED_FUTURE_DAYS * DAY_MS
      ? [item]
      : [];
  void datedFilms.set(key, dated, DATED_TTL).catch(() => undefined);
  return dated;
}

/**
 * Episodes of the shows being watched that air between two times, aired ones
 * included, soonest first, with the user's own state.
 */
async function airingEpisodes(
  ctx: JellyfinRequestContext,
  from: number,
  to: number
): Promise<JellyfinItem[]> {
  const recent = await getWatchStateProvider().listRecentSeries(
    ctx.watch,
    UPCOMING_SERIES
  );
  const now = Date.now();
  const dated = await mapLimited(recent, UPCOMING_CONCURRENCY, (row) =>
    datedForSeries(ctx, row, now).catch(() => [])
  );
  const episodes: JellyfinItem[] = [];
  const seen = new Set<string>();
  for (const episode of dated.flat()) {
    const at = premiereOf(episode);
    if (seen.has(episode.Id) || at < from || at > to) continue;
    seen.add(episode.Id);
    // Copied and reset: users of one configuration share the cached items.
    episodes.push({ ...episode, UserData: defaultUserData(episode.Id) });
  }
  const withState = await attachUserData(ctx, episodes);
  return withState.sort((a, b) => premiereOf(a) - premiereOf(b));
}

/**
 * The next episode of each show caught up on, watched or watchlisted, where it
 * airs before `to`, and watchlisted films that premiere by then, soonest first.
 */
async function upcomingItems(
  ctx: JellyfinRequestContext,
  to: number
): Promise<JellyfinItem[]> {
  const now = Date.now();
  const provider = getWatchStateProvider();
  const [recent, timed, listed] = await Promise.all([
    provider.listRecentSeries(ctx.watch, UPCOMING_SERIES),
    showsAiringBetween(ctx.watch, now, to),
    provider.listFavorites(ctx.watch),
  ]);
  const showKey = (row: WatchStateRow) =>
    `${row.mediaType}|${seriesIdOf(row.baseId, row.videoId, row.mediaType)}`;
  const watching = new Set(recent.map(showKey));
  const shows = [
    ...recent,
    ...listed
      .filter(
        (row) =>
          row.kind === 'series' && !row.dropped && !watching.has(showKey(row))
      )
      .slice(0, UPCOMING_WATCHLIST),
  ];
  const films = listed
    .filter((row) => row.kind === 'movie' && !row.played)
    .slice(0, UPCOMING_WATCHLIST);
  const airsSoon = (e: JellyfinItem) => {
    const at = premiereOf(e);
    return at > now && at <= to;
  };
  const trackerTimed = (row: WatchStateRow) =>
    [
      row.seriesKey,
      row.matchKey && seriesKeyOfMatch(row.matchKey, row.mediaType),
    ].some((key) => !!key && timed.has(key));
  const nexts = await mapLimited(shows, UPCOMING_CONCURRENCY, async (row) => {
    // The cached dates rule most shows out before their episodes are read,
    // unless a tracker times one, which an undated new season needs.
    const dated = await datedForSeries(ctx, row, now).catch(() => []);
    if (!dated.some(airsSoon) && !trackerTimed(row)) return null;
    const d = {
      t: row.mediaType,
      i: seriesIdOf(row.baseId, row.videoId, row.mediaType),
    };
    return nextToAir(ctx, d, row).catch(() => null);
  });
  const premieres = await mapLimited(films, UPCOMING_CONCURRENCY, (row) =>
    datedFilm(ctx, row, now).catch(() => [])
  );
  const items: JellyfinItem[] = [];
  const shown = new Set<string>();
  for (const next of nexts) {
    if (!next || !airsSoon(next)) continue;
    const series = String(next.SeriesId ?? next.Id);
    if (shown.has(series)) continue;
    shown.add(series);
    items.push(next);
  }
  const dated = premieres
    .flat()
    .filter(airsSoon)
    .map((film) => ({ ...film, UserData: defaultUserData(film.Id) }));
  items.push(...(await attachUserData(ctx, dated)));
  return items.sort((a, b) => premiereOf(a) - premiereOf(b));
}

router.get(
  '/Shows/Upcoming',
  jf(async (req, res, ctx) => {
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 20)), 100);
    const startIndex = Math.max(0, qi(req, 'StartIndex', 0));
    /* Not attributable to a catalog, as for Resume and Next Up. */
    if (qs(req, 'ParentId')) {
      send(req, res, [], 0, startIndex);
      return;
    }
    refreshWatchState(ctx);
    const items = await upcomingItems(
      ctx,
      Date.now() + appConfig.jellyfin.upcomingDays * DAY_MS
    );

    send(
      req,
      res,
      items.slice(startIndex, startIndex + limit),
      items.length,
      startIndex
    );
  })
);

router.get(
  '/Shows/:seriesId/Seasons',
  jf(async (req, res, ctx) => {
    const d = await decodeForRequest(ctx, param(req, 'seriesId'));
    if (
      d?.kind !== 'descriptor' ||
      (d.descriptor.k !== 'series' && d.descriptor.k !== 'movie')
    ) {
      res.status(404).json({ Message: 'Series not found' });
      return;
    }
    const seasons = (await seasonsForSeries(ctx, d.descriptor))?.seasons ?? [];
    send(req, res, seasons, seasons.length, 0);
  })
);

router.get(
  '/Shows/:seriesId/Episodes',
  jf(async (req, res, ctx) => {
    // Given a season, the path id is ignored, as some clients put the season's id there.
    const seasonId = qs(req, 'SeasonId');
    const sd = seasonId ? await decodeForRequest(ctx, seasonId) : null;
    const fromSeason =
      sd?.kind === 'descriptor' && sd.descriptor.k === 'season'
        ? sd.descriptor
        : undefined;
    const d = fromSeason
      ? null
      : await decodeForRequest(ctx, param(req, 'seriesId'));
    const show =
      fromSeason ??
      (d?.kind === 'descriptor' &&
      (d.descriptor.k === 'series' || d.descriptor.k === 'movie')
        ? d.descriptor
        : undefined);
    if (!show) {
      res.status(404).json({ Message: 'Series not found' });
      return;
    }
    let season = fromSeason?.s;
    const seasonNum = qs(req, 'Season');
    if (season == null && seasonNum) season = Number(seasonNum);
    let eps = (await episodesForSeries(ctx, show, season))?.episodes ?? [];
    const startItemId = qs(req, 'StartItemId');
    if (startItemId) {
      const idx = eps.findIndex(
        (e) => e.Id === startItemId.replace(/-/g, '').toLowerCase()
      );
      if (idx >= 0) eps = eps.slice(idx);
    }
    const adjacentTo = qs(req, 'AdjacentTo');
    if (adjacentTo) {
      const idx = eps.findIndex(
        (e) => e.Id === adjacentTo.replace(/-/g, '').toLowerCase()
      );
      if (idx >= 0) eps = eps.slice(Math.max(0, idx - 1), idx + 2);
    }
    const startIndex = Math.max(0, qi(req, 'StartIndex', 0));
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 1000)), 2000);
    send(
      req,
      res,
      eps.slice(startIndex, startIndex + limit),
      eps.length,
      startIndex
    );
  })
);

const RESERVED_ITEM_IDS =
  /^(Filters2?|Counts|Latest|Resume|Intros|Root|Suggestions)$/i;
router.get(
  ['/Items/:itemId', '/Users/:userId/Items/:itemId'],
  (req, _res, next) =>
    RESERVED_ITEM_IDS.test(param(req, 'itemId')) ? next('route') : next(),
  jf(async (req, res, ctx) => {
    const item = await itemForId(req, ctx, param(req, 'itemId'), {
      resolve: wantsVersions(req),
    });
    if (!item) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    res.json(stripInternal(item));
  })
);

router.get(
  '/Items/:itemId/Ancestors',
  jf(async (req, res, ctx) => {
    const desc = await decodeItemForRequest(ctx, param(req, 'itemId'));
    const out: JellyfinItem[] = [];
    if (desc) {
      if (desc.k === 'episode') {
        const season = await itemFromDescriptor(ctx, {
          k: 'season',
          t: desc.t,
          i: desc.i,
          s: desc.s,
        });
        const series = await itemFromDescriptor(ctx, {
          k: 'series',
          t: desc.t,
          i: desc.i,
        });
        if (season) out.push(season);
        if (series) out.push(series);
      } else if (desc.k === 'season') {
        const series = await itemFromDescriptor(ctx, {
          k: 'series',
          t: desc.t,
          i: desc.i,
        });
        if (series) out.push(series);
      } else if (desc.k === 'movie' && desc.p) {
        const boxset = await itemFromDescriptor(ctx, {
          k: 'boxset',
          t: desc.t,
          i: desc.p,
        });
        if (boxset) out.push(boxset);
      }
    }
    res.json(out.map(stripInternal));
  })
);

router.get(
  [
    '/Items/:itemId/Similar',
    '/Movies/:itemId/Similar',
    '/Shows/:itemId/Similar',
  ],
  jf(async (req, res, ctx) => {
    const desc = await decodeItemForRequest(ctx, param(req, 'itemId'));
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 12)), 50);
    if (desc?.k !== 'movie' && desc?.k !== 'series') {
      send(req, res, [], 0, 0);
      return;
    }
    const meta = await getMeta(ctx, desc.t, desc.i);
    const engine = await ctx.engine();
    // TMDB's picks when it knows the title; else the top of its first genre.
    const recommended = await recommendedPreviews(
      engine,
      ctx.userData,
      meta ?? { id: desc.i, type: desc.t },
      desc.k === 'movie' ? 'movie' : 'series',
      limit
    );
    if (recommended) {
      const items = await itemsFromPreviews(ctx, recommended);
      send(req, res, items, items.length, 0);
      return;
    }
    const genre = (meta?.genres ?? [])[0];
    if (genre) {
      for (const view of await ctx.views()) {
        if (
          view.catalog.type !== desc.t ||
          !genreOptions(view.catalog).includes(genre)
        )
          continue;
        const page = await getCatalogPage(engine, view.catalog, {
          startIndex: 0,
          limit: limit + 1,
          genre,
        });
        const items = (
          await itemsFromPreviews(
            ctx,
            page.items.filter((p) => p.id !== desc.i),
            { catalog: view.catalog }
          )
        ).slice(0, limit);
        send(req, res, items, items.length, 0);
        return;
      }
    }
    send(req, res, [], 0, 0);
  })
);

router.get(
  '/Movies/Recommendations',
  jf(async (req, res, ctx) => {
    const limit = Math.min(Math.max(1, qi(req, 'ItemLimit', 8)), 20);
    const engine = await ctx.engine();
    const views = withoutRequiredGenre(await ctx.views())
      .filter((v) => v.collectionType === 'movies')
      .slice(0, 3);
    const out = [];
    for (const view of views) {
      const page = await getCatalogPage(engine, view.catalog, {
        startIndex: 0,
        limit,
      });
      const items = await itemsFromPreviews(ctx, page.items, {
        parentId: view.id,
        catalog: view.catalog,
      });
      rememberListMarkers(ctx, items);
      out.push({
        Items: items.map(stripInternal),
        RecommendationType: 'SimilarToRecentlyPlayed',
        BaselineItemName: view.catalog.name,
        CategoryId: view.id,
      });
    }
    res.json(out);
  })
);

async function genreEntries(
  ctx: JellyfinRequestContext,
  parentId: string | undefined
) {
  const engine = await ctx.engine();
  let views = await ctx.views();
  if (parentId) {
    const d = await decodeForRequest(ctx, parentId);
    if (d?.kind === 'descriptor' && d.descriptor.k === 'view') {
      const pd = d.descriptor;
      views = views.filter(
        (v) => v.catalog.type === pd.t && v.catalog.id === pd.c
      );
    }
  }
  const out: { type: string; catalogId: string; genre: string }[] = [];
  const seen = new Set<string>();
  for (const view of views) {
    for (const g of genreOptions(view.catalog)) {
      const key = `${view.catalog.type}|${g}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        type: view.catalog.type,
        catalogId: view.catalog.id,
        genre: g,
      });
    }
  }
  return out;
}

router.get(
  '/Genres',
  jf(async (req, res, ctx) => {
    const entries = await genreEntries(ctx, qs(req, 'ParentId'));
    const items = entries.map((e) =>
      buildGenre(ctx.build, e.type, e.catalogId, e.genre)
    );
    send(req, res, items, items.length, 0);
  })
);
router.get(
  '/Genres/:name',
  jf(async (req, res, ctx) => {
    const name = decodeURIComponent(param(req, 'name'));
    const entry = (await genreEntries(ctx, undefined)).find(
      (e) => e.genre.toLowerCase() === name.toLowerCase()
    );
    res.json(
      stripInternal(
        buildGenre(
          ctx.build,
          entry?.type ?? 'movie',
          entry?.catalogId ?? '',
          entry?.genre ?? name
        )
      )
    );
  })
);

router.get(
  ['/Items/Filters', '/Items/Filters2'],
  jf(async (req, res, ctx) => {
    const entries = await genreEntries(ctx, qs(req, 'ParentId'));
    const seen = new Set<string>();
    const genres = entries.filter((e) =>
      seen.has(e.genre) ? false : (seen.add(e.genre), true)
    );
    if (/Filters2/i.test(req.path)) {
      res.json({
        Genres: genres.map((e) => ({
          Name: e.genre,
          Id: genreId(e.type, e.catalogId, e.genre),
        })),
        Tags: [],
      });
    } else {
      res.json({
        Genres: genres.map((e) => e.genre),
        Tags: [],
        OfficialRatings: [],
        Years: [],
      });
    }
  })
);

router.get(
  '/Items/Counts',
  jf(async (_req, res) => {
    res.json({
      MovieCount: 0,
      SeriesCount: 0,
      EpisodeCount: 0,
      ArtistCount: 0,
      ProgramCount: 0,
      TrailerCount: 0,
      SongCount: 0,
      AlbumCount: 0,
      MusicVideoCount: 0,
      BoxSetCount: 0,
      BookCount: 0,
      ItemCount: 0,
    });
  })
);

router.get(
  '/Search/Hints',
  jf(async (req, res, ctx) => {
    const term = (qs(req, 'SearchTerm') ?? '').trim();
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 20)), 50);
    const types = typeFilter(req);
    if (!term) {
      res.json({ SearchHints: [], TotalRecordCount: 0 });
      return;
    }
    const engine = await ctx.engine();
    const previews = await searchCatalogs(
      engine,
      term,
      limit,
      searchKindsFor(types),
      ctx.userData
    );
    const items = filterByType(await itemsFromPreviews(ctx, previews), types);
    res.json({
      SearchHints: items.map((i) => ({
        ItemId: i.Id,
        Id: i.Id,
        Name: i.Name,
        Type: i.Type,
        MediaType: i.MediaType ?? 'Video',
        ProductionYear: i.ProductionYear,
        PrimaryImageTag: (i.ImageTags as Record<string, string>)?.Primary,
        BackdropImageTag: (i.BackdropImageTags as string[])?.[0],
        BackdropImageItemId: i.Id,
        PrimaryImageAspectRatio: i.PrimaryImageAspectRatio,
        RunTimeTicks: i.RunTimeTicks,
        IsFolder: i.IsFolder,
      })),
      TotalRecordCount: items.length,
    });
  })
);

router.get(
  '/Persons/:name',
  jf(async (req, res, ctx) => {
    const item = await itemFromDescriptor(ctx, {
      k: 'person',
      n: decodeURIComponent(param(req, 'name')),
    });
    res.json(item ? stripInternal(item) : { Message: 'Not found' });
  })
);

export default router;
