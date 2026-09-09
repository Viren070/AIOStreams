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
  viewCollectionType,
  config as appConfig,
  contentDescriptor,
  decodeItemId,
  encodeItemId,
  episodeDescriptor,
  findCatalog,
  getWatchStateProvider,
  groupSeasons,
  identityFor,
  itemKeyFor,
  placeholderMediaSource,
  isMemoFresh,
  resolveByItem,
  resolveByMediaSource,
  stripInternal,
  subtitleFormatFor,
  userDataFromRow,
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
} from '@aiostreams/core';
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

export function descriptorOf(
  item: JellyfinItem
): JellyfinDescriptor | undefined {
  return (item as { _aio?: { descriptor?: JellyfinDescriptor } })._aio
    ?.descriptor;
}

export async function decodeForRequest(
  ctx: JellyfinRequestContext,
  raw: string
): Promise<Awaited<ReturnType<typeof decodeItemId>>> {
  const engine = await ctx.engine();
  return decodeItemId(raw, { catalogs: engine.getCatalogs() ?? [] });
}

/** Batched user data for every content item in a list. */
export async function attachUserData(
  ctx: JellyfinRequestContext,
  items: JellyfinItem[]
): Promise<JellyfinItem[]> {
  const keyed: { item: JellyfinItem; key: string }[] = [];
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
    keyed.push({ item, key: itemKeyOf(d) });
  }
  if (!keyed.length) return items;
  const rows = await getWatchStateProvider().getMany(
    ctx.watch,
    keyed.map((k) => k.key)
  );
  for (const { item, key } of keyed) {
    const row = rows.get(key);
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

export async function itemsFromPreviews(
  ctx: JellyfinRequestContext,
  previews: MetaPreview[],
  opts: {
    parentId?: string;
    catalog?: { type: string; id: string; name: string };
  } = {}
): Promise<JellyfinItem[]> {
  const boxset = isBoxsetCatalog(opts.catalog);
  const items = previews.map((p) =>
    buildContentItem(ctx.build, p, {
      parentId: opts.parentId,
      boxset: boxset && p.type === 'movie',
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
  const { listViews } = await import('@aiostreams/core');
  const engine = await ctx.engine();
  const views = await listViews(engine, ctx.userData);
  return views.map((v) => buildView(ctx.build, v.catalog, v.collectionType));
}

export function episodeKey(
  meta: ParsedMeta,
  group: SeasonGroup,
  video: SeasonGroup['videos'][number]
): string {
  return itemKeyFor({
    kind: 'episode',
    type: meta.type,
    baseId: meta.id,
    season: group.season,
    episode: video.episode ?? 0,
    videoId: video.id,
  });
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
  const groups = groupSeasons(meta);
  const keys = groups.flatMap((g) =>
    g.videos.map((v) => episodeKey(meta, g, v))
  );
  const states = await getWatchStateProvider().getMany(ctx.watch, keys);
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
  const groups = groupSeasons(meta).filter(
    (g) => season == null || g.season === season
  );
  const pairs = groups.flatMap((g) => g.videos.map((v) => ({ g, v })));
  const keys = pairs.map(({ g, v }) => episodeKey(meta, g, v));
  const states = await getWatchStateProvider().getMany(ctx.watch, keys);
  const episodes = pairs.map(({ g, v }, i) =>
    buildEpisode(ctx.build, meta, seriesItem, g, v, states.get(keys[i]))
  );
  return { meta, seriesItem, episodes };
}

/** Children of a movie-type meta that carries `videos` (a collection). */
export async function boxSetChildren(
  ctx: JellyfinRequestContext,
  d: { t: string; i: string }
): Promise<{
  meta: ParsedMeta;
  boxset: JellyfinItem;
  children: JellyfinItem[];
} | null> {
  const meta = await getMetaLoose(ctx, d.t, d.i);
  if (!meta?.videos?.length) return null;
  const boxset = buildContentItem(
    ctx.build,
    { ...meta, type: d.t },
    { boxset: true, childCount: meta.videos.length }
  );
  const keys = meta.videos.map((v) =>
    itemKeyFor({ kind: 'movie', type: d.t, baseId: v.id, videoId: v.id })
  );
  const states = await getWatchStateProvider().getMany(ctx.watch, keys);
  const children = meta.videos.map((v, i) =>
    buildBoxSetChild(ctx.build, boxset, meta, v, i, states.get(keys[i]))
  );
  return { meta, boxset, children };
}

async function isCollection(
  ctx: JellyfinRequestContext,
  d: { t: string; i: string }
): Promise<boolean> {
  if (d.t !== 'movie') return false;
  const meta = await getMetaLoose(ctx, d.t, d.i).catch(() => null);
  return (meta?.videos?.length ?? 0) > 1;
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
      const { listViews } = await import('@aiostreams/core');
      const view = (await listViews(engine, ctx.userData)).find(
        (v) => v.catalog === catalog
      );
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
      const r = await boxSetChildren(ctx, d);
      if (!r) return null;
      return attachUserData(ctx, [r.boxset]).then(([item]) => item);
    }
    case 'movie':
    case 'series': {
      const meta = await getMetaLoose(ctx, d.t, d.i);
      const base = meta
        ? { ...meta, id: d.i, type: d.t }
        : ({ id: d.i, type: d.t, name: d.i } as MetaPreview);
      const asBoxset =
        d.k === 'movie' && !d.p && (meta?.videos?.length ?? 0) > 1;
      const item = buildContentItem(ctx.build, base, {
        playstate: opts.playstate,
        boxset: asBoxset,
        childCount: asBoxset
          ? meta!.videos!.length
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
      const groups = groupSeasons(meta);
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
        (await getWatchStateProvider().getMany(ctx.watch, [itemKeyOf(d)])).get(
          itemKeyOf(d)
        );
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
      i: last.baseId,
      s: last.season ?? 1,
      e: last.episode ?? 0,
      v: last.videoId ?? '',
    });
    const idx = eps.findIndex((e) => e.Id === lastId);
    if (idx >= 0)
      next = isResumable(eps[idx]) ? eps[idx] : (eps[idx + 1] ?? null);
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
    })
  );
}

export function placeholderSources(
  req: Request,
  ctx: JellyfinRequestContext,
  itemId: string,
  resolved: boolean
): JellyfinMediaSource[] {
  const path = `${ctx.baseUrl.replace(req.baseUrl, '')}/static/no_matching_file.mp4`;
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
  const reusable =
    existing?.sources.length && isMemoFresh(existing) ? existing : null;
  const shouldResolve =
    opts.resolve !== false && (opts.forceResolve || resolveOnOpen(ctx));
  const memo =
    reusable ??
    (shouldResolve
      ? await resolvePlayback(ctx, d, { force: opts.forceResolve })
      : null);

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
