import type { Request } from 'express';
import {
  buildBoxSetChild,
  buildContentItem,
  buildEpisode,
  buildGenre,
  buildMediaSource,
  buildPerson,
  buildSeason,
  buildView,
  collectionMembers,
  viewCollectionType,
  config as appConfig,
  contentDescriptor,
  decodeItemId,
  descriptorOf,
  encodeItemId,
  idNeedsCatalogs,
  episodeDescriptor,
  findCatalog,
  groupSeasons,
  hasProgrammeVideos,
  identityFor,
  isLeafEntry,
  itemKeyFor,
  placeholderMediaSource,
  playableSources,
  airedEpisodeRefs,
  rememberedShowEpisodes,
  showEpisodesOf,
  withPlayedCounts,
  isMemoFresh,
  resolveByItem,
  resolveByMediaSource,
  seriesIdOf,
  stripInternal,
  subtitleFormatFor,
  userDataFromRow,
  watchRowsFor,
  writeMemoPointer,
  type ContentDescriptor,
  type ContentRef,
  type DeviceProfile,
  type JellyfinDescriptor,
  type JellyfinItem,
  type JellyfinMediaSource,
  type MetaPreview,
  type ParsedMeta,
  type PlaybackMemo,
  type WatchStateRow,
  type SeasonGroup,
  type UserItemDataDto,
} from '@aiostreams/core';
import { stremioStreamRateLimiter } from '../../middlewares/ratelimit.js';
import { StaticFiles } from '../../utils/static-errors.js';
import type { JellyfinRequestContext } from './context.js';
import { getMetaLoose, resolveMarkerId, resolvePlayback } from './resolve.js';

export function contentRefOf(d: ContentDescriptor): ContentRef {
  switch (d.k) {
    case 'episode':
      return {
        kind: 'episode',
        type: d.t,
        baseId: d.i,
        season: d.s,
        episode: d.e,
        videoId: d.v,
      };
    case 'movie':
      return { kind: 'movie', type: d.t, baseId: d.i, videoId: d.i };
    default:
      return { kind: 'series', type: d.t, baseId: d.i };
  }
}

export function itemKeyOf(d: ContentDescriptor): string {
  return itemKeyFor(contentRefOf(d));
}

export async function decodeForRequest(
  ctx: JellyfinRequestContext,
  raw: string
): Promise<Awaited<ReturnType<typeof decodeItemId>>> {
  if (!idNeedsCatalogs(raw)) return decodeItemId(raw);
  const engine = await ctx.engine();
  return decodeItemId(raw, { catalogs: engine.getCatalogs() ?? [] });
}

/** A show's aired episodes, from a meta this request already fetched or else the cache; never a new fetch. */
async function airedEpisodesOf(
  ctx: JellyfinRequestContext,
  d: { t: string; i: string },
  now: number
): Promise<ContentRef[] | undefined> {
  const pending = ctx.metas.get(`${d.t}|${d.i}`);
  const meta = pending ? await pending : null;
  const show = meta
    ? showEpisodesOf(meta)
    : await rememberedShowEpisodes(ctx.scope(), d.t, d.i);
  return show ? airedEpisodeRefs(show, now) : undefined;
}

/** Batched user data for every content item in a list. */
export async function attachUserData(
  ctx: JellyfinRequestContext,
  items: JellyfinItem[]
): Promise<JellyfinItem[]> {
  const keyed: { item: JellyfinItem; key: string; ref: ContentRef }[] = [];
  const shows: Promise<ContentRef[] | undefined>[] = [];
  const now = Date.now();
  for (const item of items) {
    const d = descriptorOf(item);
    if (
      !d ||
      d.k === 'view' ||
      d.k === 'genre' ||
      d.k === 'person' ||
      d.k === 'source' ||
      d.k === 'season'
    )
      continue;
    keyed.push({ item, key: itemKeyOf(d), ref: contentRefOf(d) });
    shows.push(
      d.k === 'series' && item.Type === 'Series'
        ? airedEpisodesOf(ctx, d, now)
        : Promise.resolve(undefined)
    );
  }
  if (!keyed.length) return items;
  const episodes = await Promise.all(shows);
  const rows = await watchRowsFor(ctx.watch, [
    ...keyed.map((k) => k.ref),
    ...episodes.flatMap((refs) => refs ?? []),
  ]);
  for (const [i, { item, key }] of keyed.entries()) {
    const row = rows.get(key);
    const aired = episodes[i];
    if (aired) {
      const played = aired.filter((r) => rows.get(itemKeyFor(r))?.played);
      item.UserData = withPlayedCounts(
        {
          ...(item.UserData as UserItemDataDto),
          ...(row ? { IsFavorite: row.favorite } : {}),
        },
        played.length,
        aired.length
      );
      continue;
    }
    if (!row) continue;
    if (item.Type === 'Series' || item.Type === 'BoxSet') {
      item.UserData = {
        ...(item.UserData as object),
        IsFavorite: row.favorite,
      };
    } else {
      const runtimeMs =
        typeof item.RunTimeTicks === 'number'
          ? item.RunTimeTicks / 10_000
          : undefined;
      item.UserData = userDataFromRow(item.Id, row, runtimeMs);
    }
  }
  return items;
}

export function isBoxsetCatalog(
  catalog: { type: string; id: string; name: string } | undefined
): boolean {
  return (
    !!catalog &&
    /collection/i.test(`${catalog.type} ${catalog.id} ${catalog.name}`)
  );
}

/** A `collection` entry, or a movie in a catalog named for collections. */
export function isBoxsetEntry(
  preview: Pick<MetaPreview, 'type' | 'collection'>,
  catalog?: { type: string; id: string; name: string }
): boolean {
  return (
    !!preview.collection ||
    (isBoxsetCatalog(catalog) && preview.type === 'movie')
  );
}

/** A collection's `ChildCount`, when the meta alone says it. */
function knownMemberCount(
  meta: Pick<MetaPreview, 'collection'> & { videos?: unknown[] | null }
): number | undefined {
  if (!meta.collection) return meta.videos?.length;
  if (!meta.collection.sources?.length) return meta.collection.items?.length;
  return undefined;
}

export async function itemsFromPreviews(
  ctx: JellyfinRequestContext,
  previews: MetaPreview[],
  opts: {
    parentId?: string;
    catalog?: { type: string; id: string; name: string };
  } = {}
): Promise<JellyfinItem[]> {
  const evidence = await ctx.leafEvidence();
  const items = previews.map((p) =>
    buildContentItem(ctx.build, p, {
      parentId: opts.parentId,
      boxset: isBoxsetEntry(p, opts.catalog),
      leaf: isLeafEntry(p, evidence),
      childCount: p.collection ? knownMemberCount(p) : undefined,
      genreCatalog: opts.catalog
        ? { type: opts.catalog.type, id: opts.catalog.id }
        : undefined,
    })
  );
  return attachUserData(ctx, items);
}

export async function viewItems(
  ctx: JellyfinRequestContext
): Promise<JellyfinItem[]> {
  const views = await ctx.views();
  return views.map((v) => buildView(ctx.build, v.catalog, v.collectionType));
}

function episodeRef(
  meta: ParsedMeta,
  group: SeasonGroup,
  video: SeasonGroup['videos'][number]
): ContentRef {
  return {
    kind: 'episode',
    type: meta.type,
    baseId: meta.id,
    season: group.season,
    episode: video.episode ?? 0,
    videoId: video.id,
  };
}

export function episodeKey(
  meta: ParsedMeta,
  group: SeasonGroup,
  video: SeasonGroup['videos'][number]
): string {
  return itemKeyFor(episodeRef(meta, group, video));
}

export async function seasonsForSeries(
  ctx: JellyfinRequestContext,
  d: { t: string; i: string }
): Promise<{
  meta: ParsedMeta;
  seriesItem: JellyfinItem;
  seasons: JellyfinItem[];
} | null> {
  const meta = await getMetaLoose(ctx, d.t, d.i);
  if (!meta) return null;
  const seriesItem = buildContentItem(ctx.build, { ...meta, type: d.t });
  const groups = groupSeasons(meta, true);
  const states = await watchRowsFor(
    ctx.watch,
    groups.flatMap((g) => g.videos.map((v) => episodeRef(meta, g, v)))
  );
  const seasons = groups.map((g) =>
    buildSeason(ctx.build, meta, seriesItem, g, states, (v) =>
      episodeKey(meta, g, v)
    )
  );
  return { meta, seriesItem, seasons };
}

export async function episodesForSeries(
  ctx: JellyfinRequestContext,
  d: { t: string; i: string },
  season?: number
): Promise<{
  meta: ParsedMeta;
  seriesItem: JellyfinItem;
  episodes: JellyfinItem[];
} | null> {
  const meta = await getMetaLoose(ctx, d.t, d.i);
  if (!meta) return null;
  const seriesItem = buildContentItem(ctx.build, { ...meta, type: d.t });
  const groups = groupSeasons(meta, true).filter(
    (g) => season == null || g.season === season
  );
  const pairs = groups.flatMap((g) => g.videos.map((v) => ({ g, v })));
  const refs = pairs.map(({ g, v }) => episodeRef(meta, g, v));
  const states = await watchRowsFor(ctx.watch, refs);
  const episodes = pairs.map(({ g, v }, i) =>
    buildEpisode(
      ctx.build,
      meta,
      seriesItem,
      g,
      v,
      states.get(itemKeyFor(refs[i]))
    )
  );
  return { meta, seriesItem, episodes };
}

/**
 * Every member of a `collection` meta, or a movie-type meta's `videos` as
 * movies. Reads each source to its cap; a listing pages instead.
 */
export async function boxSetChildren(
  ctx: JellyfinRequestContext,
  d: { t: string; i: string }
): Promise<{
  meta: ParsedMeta;
  boxset: JellyfinItem;
  children: JellyfinItem[];
} | null> {
  const meta = await getMetaLoose(ctx, d.t, d.i);
  if (meta?.collection) {
    const { items } = await collectionMembers(await ctx.engine(), meta, {
      startIndex: 0,
      limit: Infinity,
      exactTotal: true,
    });
    const boxset = buildContentItem(
      ctx.build,
      { ...meta, type: d.t },
      { boxset: true, childCount: items.length }
    );
    const children = await itemsFromPreviews(ctx, items, {
      parentId: boxset.Id,
    });
    return { meta, boxset, children };
  }
  if (!meta?.videos?.length || hasProgrammeVideos(meta)) return null;
  const boxset = buildContentItem(
    ctx.build,
    { ...meta, type: d.t },
    { boxset: true, childCount: meta.videos.length }
  );
  const refs: ContentRef[] = meta.videos.map((v) => ({
    kind: 'movie',
    type: d.t,
    baseId: v.id,
    videoId: v.id,
  }));
  const states = await watchRowsFor(ctx.watch, refs);
  const children = meta.videos.map((v, i) =>
    buildBoxSetChild(
      ctx.build,
      boxset,
      meta,
      v,
      i,
      states.get(itemKeyFor(refs[i]))
    )
  );
  return { meta, boxset, children };
}

export async function itemFromDescriptor(
  ctx: JellyfinRequestContext,
  d: JellyfinDescriptor,
  opts: { playstate?: WatchStateRow } = {}
): Promise<JellyfinItem | null> {
  switch (d.k) {
    case 'view': {
      const engine = await ctx.engine();
      const catalog = findCatalog(engine, d.t, d.c);
      if (!catalog) return null;
      const view = (await ctx.views()).find((v) => v.catalog === catalog);
      return buildView(
        ctx.build,
        catalog,
        view ? view.collectionType : viewCollectionType(catalog, [])
      );
    }
    case 'genre':
      return buildGenre(ctx.build, d.t, d.c, d.g);
    case 'person':
      return buildPerson(ctx.build, d.n);
    case 'source':
      return null;
    case 'boxset': {
      const meta = await getMetaLoose(ctx, d.t, d.i);
      if (!meta || (!meta.collection && !meta.videos?.length)) return null;
      const item = buildContentItem(
        ctx.build,
        { ...meta, type: d.t },
        { boxset: true, childCount: knownMemberCount(meta) }
      );
      return attachUserData(ctx, [item]).then(([built]) => built);
    }
    case 'movie':
    case 'series': {
      const meta = await getMetaLoose(ctx, d.t, d.i);
      if (!meta && d.k === 'movie' && d.p) {
        // A collection's movie may exist only as an entry in its parent.
        const id = encodeItemId(d);
        const r = await boxSetChildren(ctx, { t: d.t, i: d.p });
        const child = r?.children.find((c) => c.Id === id);
        if (child) return child;
      }
      const base = meta
        ? { ...meta, id: d.i, type: d.t }
        : ({ id: d.i, type: d.t, name: d.i } as MetaPreview);
      const asBoxset =
        !(d.k === 'movie' && d.p) &&
        (!!meta?.collection ||
          (d.k === 'movie' &&
            (meta?.videos?.length ?? 0) > 1 &&
            !hasProgrammeVideos(meta)));
      const item = buildContentItem(ctx.build, base, {
        playstate: opts.playstate,
        boxset: asBoxset,
        leaf: d.k === 'movie',
        childCount: asBoxset
          ? knownMemberCount(meta!)
          : d.k === 'series'
            ? meta?.videos?.length || undefined
            : undefined,
      });
      if (asBoxset) item.Id = encodeItemId(d);
      if (!opts.playstate) await attachUserData(ctx, [item]);
      return item;
    }
    case 'season': {
      const r = await seasonsForSeries(ctx, d);
      return r?.seasons.find((s) => s.IndexNumber === d.s) ?? null;
    }
    case 'episode': {
      const meta = await getMetaLoose(ctx, d.t, d.i);
      if (!meta) return null;
      const seriesItem = buildContentItem(ctx.build, { ...meta, type: d.t });
      const groups = groupSeasons(meta, true);
      let found: {
        group: SeasonGroup;
        video: SeasonGroup['videos'][number];
      } | null = null;
      for (const g of groups) {
        const v =
          g.videos.find((x) => x.id === d.v) ??
          (g.season === d.s
            ? g.videos.find((x) => x.episode === d.e)
            : undefined);
        if (v) {
          found = { group: g, video: v };
          break;
        }
      }
      const group = found?.group ?? {
        season: d.s,
        name: d.s === 0 ? 'Specials' : `Season ${d.s}`,
        videos: [],
      };
      const video = found?.video ?? {
        id: d.v,
        title: `Episode ${d.e}`,
        season: d.s,
        episode: d.e,
      };
      const row =
        opts.playstate ??
        (await watchRowsFor(ctx.watch, [contentRefOf(d)])).get(itemKeyOf(d));
      return buildEpisode(ctx.build, meta, seriesItem, group, video, row);
    }
  }
}

function isResumable(item: JellyfinItem): boolean {
  const ud = item.UserData as {
    Played: boolean;
    PlaybackPositionTicks: number;
  };
  return !ud.Played && ud.PlaybackPositionTicks > 0;
}

export async function nextUpForSeries(
  ctx: JellyfinRequestContext,
  d: { t: string; i: string },
  last?: WatchStateRow,
  opts: { includeResumable?: boolean } = {}
): Promise<JellyfinItem | null> {
  const res = await episodesForSeries(ctx, d);
  if (!res) return null;
  const eps = res.episodes.filter(
    (e) => e.LocationType !== 'Virtual' && e.ParentIndexNumber !== 0
  );
  if (!eps.length) return null;
  let next: JellyfinItem | null | undefined;
  if (last) {
    const lastId = encodeItemId({
      k: 'episode',
      t: last.mediaType,
      i: seriesIdOf(last.baseId, last.videoId, last.mediaType),
      s: last.season ?? 1,
      e: last.episode ?? 0,
      v: last.videoId ?? '',
    });
    let idx = eps.findIndex((e) => e.Id === lastId);
    // A row from another id space can only name its episode by number.
    if (idx < 0 && last.episode != null)
      idx = eps.findIndex(
        (e) =>
          e.ParentIndexNumber === (last.season ?? 1) &&
          e.IndexNumber === last.episode
      );
    if (idx >= 0) {
      const anchor = eps[idx];
      if (isResumable(anchor)) next = anchor;
      // The list only sees this row when a match key links the two spellings.
      else if (!last.played && last.positionMs > 0)
        next = { ...anchor, UserData: userDataFromRow(anchor.Id, last) };
      else next = eps[idx + 1] ?? null;
    }
    // The anchor may sit mid-run, so fall through rather than offer a rewatch.
    if (
      next &&
      !isResumable(next) &&
      (next.UserData as { Played: boolean }).Played
    )
      next = undefined;
  }
  if (next === undefined)
    next = eps.find((e) => !(e.UserData as { Played: boolean }).Played) ?? null;

  if (next && opts.includeResumable === false && isResumable(next)) return null;
  return next;
}

function resolveOnOpen(ctx: JellyfinRequestContext): boolean {
  // An API key looks items up and never plays them.
  if (ctx.apiKey) return false;
  switch (appConfig.jellyfin.resolveOnOpen) {
    case 'always':
      return true;
    case 'never':
      return false;
    default:
      return ctx.userData.jellyfin?.resolveOnOpen ?? true;
  }
}

export function subtitleUrlFor(req: Request, itemId: string, msid: string) {
  return (index: number, format: string) =>
    `${req.baseUrl}/Videos/${itemId}/${msid}/Subtitles/${index}/0/Stream.${format}`;
}

export function nothingToPlayPath(
  req: Request,
  ctx: JellyfinRequestContext
): string {
  return `${ctx.baseUrl.replace(req.baseUrl, '')}/static/${StaticFiles.NO_MATCHING_FILE}`;
}

/** MediaSources for an item, from a memo; the first source carries `firstId`. */
export function mediaSourcesFrom(
  req: Request,
  ctx: JellyfinRequestContext,
  memo: PlaybackMemo,
  opts: {
    firstId: string;
    requestedMsid?: string;
    profile?: DeviceProfile;
    hasSegments?: boolean;
  }
): JellyfinMediaSource[] {
  const format = (sourceExtension: string) =>
    subtitleFormatFor(opts.profile, ctx.client.name, sourceExtension);
  let ordered = memo.sources;
  if (opts.requestedMsid) {
    const idx = ordered.findIndex((s) => s.msid === opts.requestedMsid);
    if (idx > 0)
      ordered = [
        ordered[idx],
        ...ordered.slice(0, idx),
        ...ordered.slice(idx + 1),
      ];
  }
  return ordered.map((record, i) =>
    buildMediaSource(record, {
      id: i === 0 ? opts.firstId : record.msid,
      subtitleFormat: format,
      subtitleUrl: subtitleUrlFor(req, memo.itemId, record.msid),
      runtimeMs: memo.runtimeMs,
      includeExtension: true,
      hasSegments: opts.hasSegments,
      noticePath: nothingToPlayPath(req, ctx),
    })
  );
}

export function placeholderSources(
  req: Request,
  ctx: JellyfinRequestContext,
  itemId: string,
  resolved: boolean
): JellyfinMediaSource[] {
  const path = nothingToPlayPath(req, ctx);
  if (resolved) {
    return [placeholderMediaSource(itemId, 'No streams found', path)];
  }
  const marker = resolveMarkerId(ctx, itemId);
  void writeMemoPointer(marker, {
    uuid: ctx.uuid,
    encryptedPassword: ctx.encryptedPassword,
    itemId,
  }).catch(() => undefined);
  return [
    placeholderMediaSource(itemId, 'Streams resolve on play', path),
    placeholderMediaSource(marker, 'Load versions', path),
  ];
}

/** Item detail: content items carry MediaSources, resolved now or as placeholders. */
export async function detailItem(
  req: Request,
  ctx: JellyfinRequestContext,
  d: ContentDescriptor,
  opts: {
    forceResolve?: boolean;
    requestedMsid?: string;
    overrideId?: string;
    /** Batch lookups ask for metadata, not a version list, so they never resolve. */
    resolve?: boolean;
  } = {}
): Promise<JellyfinItem | null> {
  const item = await itemFromDescriptor(ctx, d);
  if (!item) return null;
  const playable = item.Type === 'Movie' || item.Type === 'Episode';
  if (!playable) return item;
  const itemId = opts.overrideId ?? item.Id;
  if (opts.overrideId) item.Id = opts.overrideId;
  item.EnableMediaSourceDisplay = true;

  const existing = await resolveByItem(ctx.uuid, ctx.scope(), encodeItemId(d));
  /* A memo that only carries notices is not a result, so it is resolved again. */
  const reusable =
    existing &&
    playableSources(existing.sources).length &&
    isMemoFresh(existing)
      ? existing
      : null;
  const shouldResolve =
    opts.resolve !== false && (opts.forceResolve || resolveOnOpen(ctx));
  const resolveNow = async () => {
    if (!opts.forceResolve && !(await stremioStreamRateLimiter.tryConsume(req)))
      return null;
    return resolvePlayback(ctx, d, { force: opts.forceResolve });
  };
  const memo = reusable ?? (shouldResolve ? await resolveNow() : null);

  if (memo && memo.sources.length) {
    const sources = mediaSourcesFrom(req, ctx, memo, {
      firstId: itemId,
      requestedMsid: opts.requestedMsid,
    });
    item.MediaSources = sources;
    item.MediaStreams = sources[0].MediaStreams;
    item.Container = sources[0].Container;
    if (sources.length > 1) item.MediaSourceCount = sources.length;
  } else {
    const placeholders = placeholderSources(req, ctx, itemId, !!memo);
    item.MediaSources = placeholders;
    item.MediaStreams = [];
    if (placeholders.length > 1) item.MediaSourceCount = placeholders.length;
  }
  return item;
}

/** `/Items/{id}` where id may be a content id, a media source id or a resolve marker. */
export async function itemForId(
  req: Request,
  ctx: JellyfinRequestContext,
  raw: string,
  opts: { resolve?: boolean } = {}
): Promise<JellyfinItem | null> {
  const decoded = await decodeForRequest(ctx, raw);
  if (!decoded) return null;
  if (decoded.kind === 'source') {
    const pointer = await resolveByMediaSource(decoded.msid);
    if (!pointer || pointer.uuid !== ctx.uuid) return null;
    const inner = await decodeForRequest(ctx, pointer.itemId);
    if (!inner || inner.kind !== 'descriptor') return null;
    const d = inner.descriptor as ContentDescriptor;
    // The marker id is derived from the item, so recognising it needs no state.
    if (decoded.msid === resolveMarkerId(ctx, pointer.itemId)) {
      return detailItem(req, ctx, d, { forceResolve: true });
    }
    // A client asking by source id expects it first, under the item's own id.
    return detailItem(req, ctx, d, {
      requestedMsid: decoded.msid,
      overrideId: decoded.msid,
      resolve: opts.resolve,
    });
  }
  const d = decoded.descriptor;
  if (
    d.k === 'movie' ||
    d.k === 'series' ||
    d.k === 'boxset' ||
    d.k === 'season' ||
    d.k === 'episode'
  ) {
    return detailItem(req, ctx, d, { resolve: opts.resolve });
  }
  return itemFromDescriptor(ctx, d);
}

export { stripInternal, contentDescriptor, episodeDescriptor, identityFor };
