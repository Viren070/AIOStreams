import { Router, type Request, type Response } from 'express';
import {
  buildGenre,
  config as appConfig,
  contentItemType,
  encodeItemId,
  findCatalog,
  genreId,
  genreOptions,
  getCatalogPage,
  getWatchStateProvider,
  knownCatalogKinds,
  listResult,
  listViews,
  searchCatalogs,
  seriesKeyOf,
  supportsExtra,
  type ContentKind,
  stripInternal,
  type JellyfinItem,
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
  decodeForRequest,
  isBoxsetCatalog,
  episodesForSeries,
  itemForId,
  itemFromDescriptor,
  itemsFromPreviews,
  nextUpForSeries,
  seasonsForSeries,
  viewItems,
} from './items.js';
import { getMetaLoose } from './resolve.js';

const router: Router = Router({ mergeParams: true });

function isKodi(ctx: JellyfinRequestContext): boolean {
  return /kodi/i.test(ctx.client.name);
}

function typeFilter(req: Request): Set<string> | null {
  const types = qlist(req, 'IncludeItemTypes').map((t) => t.toLowerCase());
  return types.length ? new Set(types) : null;
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
  const boxsetOnly = !!types && types.size === 1 && types.has('boxset');
  const evidence = await Promise.all(
    views.map((v) => knownCatalogKinds(ctx.userData, v.catalog))
  );
  return views.filter((v, i) => {
    if (boxsetOnly && !isBoxsetCatalog(v.catalog)) return false;
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
    qlist(req, 'Filters')
      .map((f) => f.toLowerCase())
      .sort()
      .join(','),
    String(qb(req, 'IsPlayed') ?? ''),
    String(qb(req, 'IsFavorite') ?? ''),
  ].join('|');
}

function applyUserFilters(req: Request, items: JellyfinItem[]): JellyfinItem[] {
  const filters = qlist(req, 'Filters').map((f) => f.toLowerCase());
  const isPlayed = qb(req, 'IsPlayed');
  const isFavorite = qb(req, 'IsFavorite');
  const ud = (i: JellyfinItem) =>
    i.UserData as {
      Played: boolean;
      IsFavorite: boolean;
      PlaybackPositionTicks: number;
    };
  let out = items;
  if (filters.includes('isplayed') || isPlayed === true)
    out = out.filter((i) => ud(i).Played);
  if (filters.includes('isunplayed') || isPlayed === false)
    out = out.filter((i) => !ud(i).Played);
  if (filters.includes('isfavorite') || isFavorite === true)
    out = out.filter((i) => ud(i).IsFavorite);
  if (filters.includes('isresumable'))
    out = out.filter((i) => ud(i).PlaybackPositionTicks > 0);
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

function send(
  req: Request,
  res: Response,
  items: JellyfinItem[],
  total?: number,
  startIndex = 0
) {
  const out = items.map(stripInternal);
  res.json(listResult(out, wantsTotal(req) ? total : out.length, startIndex));
}

async function itemsFromRows(
  ctx: JellyfinRequestContext,
  rows: WatchStateRow[]
): Promise<JellyfinItem[]> {
  const { descriptorForWatchRow } = await import('@aiostreams/core');
  const out: JellyfinItem[] = [];
  for (const row of rows) {
    try {
      const item = await itemFromDescriptor(ctx, descriptorForWatchRow(row), {
        playstate: row,
      });
      if (item) out.push(item);
    } catch {}
  }
  return out;
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
  const limit = Math.min(Math.max(1, qi(req, 'Limit', 100)), 500);
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
  const engine = await ctx.engine();

  if (ids.length) {
    // One id is a detail fetch and must resolve; several are a metadata
    // lookup filling a row, where resolving would run the stream pipeline
    // once per id.
    const resolve = ids.length === 1 ? undefined : false;
    const items: JellyfinItem[] = [];
    for (const id of ids.slice(0, 200)) {
      const item = await itemForId(req, ctx, id, { resolve }).catch(() => null);
      if (item) items.push(item);
    }
    send(req, res, filterByType(items, types), items.length, 0);
    return;
  }

  const parent = parentId ? await decodeForRequest(ctx, parentId) : null;
  const pd = parent?.kind === 'descriptor' ? parent.descriptor : null;

  if (pd?.k === 'series') {
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
  if (pd?.k === 'boxset' || (pd?.k === 'movie' && !pd.p)) {
    const r = await boxSetChildren(ctx, pd);
    const children = applyUserFilters(req, r?.children ?? []);
    send(
      req,
      res,
      children.slice(startIndex, startIndex + limit),
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
    const previews = name ? await searchCatalogs(engine, name, limit) : [];
    const items = filterByType(await itemsFromPreviews(ctx, previews), types);
    send(req, res, items, items.length, 0);
    return;
  }

  // Watch state is keyed by content identity and cannot say which catalog an
  // item came from, so only unscoped lists come from the provider; a scoped
  // request falls through to that catalog's page, where the filter is exact.
  if ((wantsFavorites || wantsPlayed || wantsResumable) && !parentId) {
    const provider = getWatchStateProvider();
    const kinds = kindsFor(types);
    const rows = wantsFavorites
      ? await provider.listFavorites(ctx.watch, kinds)
      : wantsResumable
        ? await provider.listResume(
            ctx.watch,
            startIndex + limit,
            kinds ?? ['movie', 'episode']
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
  if (!catalogDesc && genreIds.length) {
    const g = await decodeForRequest(ctx, genreIds[0]);
    if (g?.kind === 'descriptor' && g.descriptor.k === 'genre') {
      genreFromId = g.descriptor.g;
      if (g.descriptor.c) catalogDesc = g.descriptor;
    }
  }

  if (catalogDesc) {
    const catalog = findCatalog(engine, catalogDesc.t, catalogDesc.c);
    if (!catalog || !catalogCanList(types)) {
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
    const boxset = isBoxsetCatalog(catalog);
    const userFiltered = hasUserFilters(req);
    const page = await getCatalogPage(engine, catalog, {
      startIndex,
      limit,
      genre: genreFromId,
      search: searchTerm,
      exactTotal: isKodi(ctx) && wantsTotal(req),
      cursorKey: `${ctx.scope()}|${filterShape(req, types)}`,
      select: async (previews) => {
        const byType = types
          ? previews.filter((p) =>
              types.has(
                contentItemType(
                  p.type,
                  boxset && p.type === 'movie'
                ).toLowerCase()
              )
            )
          : previews;
        // UserData is only known once the item is built, so this page costs a
        // watch-state lookup; the type filter above never does.
        if (!byType.length || !userFiltered) return byType;
        const built = await itemsFromPreviews(ctx, byType, {
          parentId,
          catalog,
        });
        const kept = new Set(applyUserFilters(req, built).map((i) => i.Id));
        return byType.filter((_, i) => kept.has(built[i].Id));
      },
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
  const views = await viewsForTypes(
    ctx,
    await listViews(engine, ctx.userData),
    types
  );
  const want = startIndex + limit;
  const items: JellyfinItem[] = [];
  let offset = 0;
  let more = false;
  for (const view of views) {
    if (items.length >= limit) {
      more = true;
      break;
    }
    const page = await getCatalogPage(engine, view.catalog, {
      startIndex: 0,
      limit: Math.min(want - offset, 50),
    }).catch(() => null);
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
        if (catalog) {
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
      const views = await viewsForTypes(
        ctx,
        await listViews(engine, ctx.userData),
        types
      );
      const per = Math.max(4, Math.ceil(limit / Math.max(1, views.length)));
      for (const view of views) {
        const page = await getCatalogPage(engine, view.catalog, {
          startIndex: 0,
          limit: per,
        }).catch(() => null);
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
    res.json(filterByType(items, types).slice(0, limit).map(stripInternal));
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
    const rows = await getWatchStateProvider().listResume(
      ctx.watch,
      startIndex + limit,
      kinds.length ? kinds : ['movie', 'episode']
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
        rows.sort((a, b) => b.updatedAt - a.updatedAt);
        const next = await nextUpForSeries(ctx, d.descriptor, rows[0], {
          includeResumable,
        });
        if (next) items.push(next);
      }
    } else {
      const recent = await provider.listRecentSeries(ctx.watch, limit * 2);
      for (const row of recent) {
        if (items.length >= limit) break;
        const next = await nextUpForSeries(
          ctx,
          { t: row.mediaType, i: row.baseId },
          row,
          { includeResumable }
        ).catch(() => null);
        if (next && !(next.UserData as { Played: boolean }).Played)
          items.push(next);
      }
    }
    send(req, res, items, items.length, 0);
  })
);

const UPCOMING_SERIES = 60;
const UPCOMING_CONCURRENCY = 4;
const DAY_MS = 86_400_000;

function premiereOf(item: JellyfinItem): number {
  const at = Date.parse(String(item.PremiereDate ?? ''));
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
}

async function upcomingForSeries(
  ctx: JellyfinRequestContext,
  row: WatchStateRow,
  now: number,
  horizon: number
): Promise<JellyfinItem[]> {
  const res = await episodesForSeries(ctx, {
    t: row.mediaType,
    i: row.baseId,
  });
  if (!res) return [];
  return res.episodes.filter((e) => {
    if (e.ParentIndexNumber === 0) return false;
    const at = premiereOf(e);
    return at >= now && at <= horizon;
  });
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

    const recent = await getWatchStateProvider().listRecentSeries(
      ctx.watch,
      UPCOMING_SERIES
    );
    const now = Date.now();
    const horizon = now + appConfig.jellyfin.upcomingDays * DAY_MS;

    const episodes: JellyfinItem[] = [];
    for (let i = 0; i < recent.length; i += UPCOMING_CONCURRENCY) {
      const batch = await Promise.all(
        recent
          .slice(i, i + UPCOMING_CONCURRENCY)
          .map((row) =>
            upcomingForSeries(ctx, row, now, horizon).catch(() => [])
          )
      );
      for (const found of batch) episodes.push(...found);
    }
    episodes.sort((a, b) => premiereOf(a) - premiereOf(b));

    send(
      req,
      res,
      episodes.slice(startIndex, startIndex + limit),
      episodes.length,
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
    const d = await decodeForRequest(ctx, param(req, 'seriesId'));
    if (
      d?.kind !== 'descriptor' ||
      (d.descriptor.k !== 'series' && d.descriptor.k !== 'movie')
    ) {
      res.status(404).json({ Message: 'Series not found' });
      return;
    }
    let season: number | undefined;
    const seasonId = qs(req, 'SeasonId');
    if (seasonId) {
      const sd = await decodeForRequest(ctx, seasonId);
      if (sd?.kind === 'descriptor' && sd.descriptor.k === 'season')
        season = sd.descriptor.s;
    }
    const seasonNum = qs(req, 'Season');
    if (season == null && seasonNum) season = Number(seasonNum);
    let eps =
      (await episodesForSeries(ctx, d.descriptor, season))?.episodes ?? [];
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
    const item = await itemForId(req, ctx, param(req, 'itemId'));
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
    const d = await decodeForRequest(ctx, param(req, 'itemId'));
    const out: JellyfinItem[] = [];
    if (d?.kind === 'descriptor') {
      const desc = d.descriptor;
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
    const d = await decodeForRequest(ctx, param(req, 'itemId'));
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 12)), 50);
    if (
      d?.kind !== 'descriptor' ||
      (d.descriptor.k !== 'movie' && d.descriptor.k !== 'series')
    ) {
      send(req, res, [], 0, 0);
      return;
    }
    const desc = d.descriptor;
    const meta = await getMetaLoose(ctx, desc.t, desc.i);
    const genre = (meta?.genres ?? [])[0];
    const engine = await ctx.engine();
    if (genre) {
      for (const view of await listViews(engine, ctx.userData)) {
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
    const views = (await listViews(engine, ctx.userData))
      .filter((v) => v.collectionType === 'movies')
      .slice(0, 3);
    const out = [];
    for (const view of views) {
      const page = await getCatalogPage(engine, view.catalog, {
        startIndex: 0,
        limit,
      });
      out.push({
        Items: (
          await itemsFromPreviews(ctx, page.items, {
            parentId: view.id,
            catalog: view.catalog,
          })
        ).map(stripInternal),
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
  let views = await listViews(engine, ctx.userData);
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

void encodeItemId;
void attachUserData;
export default router;
