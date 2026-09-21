import { Router, type Request } from 'express';
import {
  checkInWatchSession,
  closeWatchSession,
  getWatchStateProvider,
  watchIdentityFor,
  openWatchSession,
  resolveByItem,
  resolveByMediaSource,
  descriptorOf,
  sessionKeyFor,
  TICKS_PER_MS,
  type ContentDescriptor,
  type ContentRef,
  type JellyfinItem,
  type SessionContext,
  type WatchEvent,
  type WatchSnapshot,
} from '@aiostreams/core';
import {
  bodyOf,
  jf,
  param,
  qs,
  type JellyfinRequestContext,
} from './context.js';
import {
  boxSetChildren,
  contentRefOf,
  decodeForRequest,
  episodesForSeries,
  itemFromDescriptor,
} from './items.js';
import { reportBulkMark, reportPlayback, reportWatchlist } from './handoff.js';
import { pickSource } from './playback.js';

const router: Router = Router({ mergeParams: true });

function ticksToMs(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n / TICKS_PER_MS) : undefined;
}

function idFrom(req: Request): string | undefined {
  const body = bodyOf(req);
  const v =
    body.ItemId ?? body.itemId ?? qs(req, 'ItemId') ?? param(req, 'itemId');
  return typeof v === 'string' && v
    ? v.replace(/-/g, '').toLowerCase()
    : undefined;
}

/** Content descriptor for an item id or a media source id reported as an item. */
async function descriptorFor(
  ctx: JellyfinRequestContext,
  id: string,
  opts: { season?: boolean } = {}
): Promise<ContentDescriptor | null> {
  let decoded = await decodeForRequest(ctx, id);
  if (decoded?.kind === 'source') {
    const pointer = await resolveByMediaSource(decoded.msid);
    if (!pointer || pointer.uuid !== ctx.uuid) return null;
    decoded = await decodeForRequest(ctx, pointer.itemId);
  }
  if (!decoded || decoded.kind !== 'descriptor') return null;
  const d = decoded.descriptor;
  return d.k === 'movie' ||
    d.k === 'episode' ||
    d.k === 'series' ||
    d.k === 'boxset' ||
    (opts.season && d.k === 'season')
    ? d
    : null;
}

function snapshotOf(item: JellyfinItem | null): WatchSnapshot | undefined {
  if (!item) return undefined;
  const tags = (item.ImageTags ?? {}) as Record<string, string>;
  const aio = (item as { _aio?: { images?: Record<string, string> } })._aio;
  return {
    name: item.Name,
    seriesName:
      typeof item.SeriesName === 'string' ? item.SeriesName : undefined,
    poster: aio?.images?.Primary,
    indexNumber:
      typeof item.IndexNumber === 'number' ? item.IndexNumber : undefined,
    parentIndexNumber:
      typeof item.ParentIndexNumber === 'number'
        ? item.ParentIndexNumber
        : undefined,
    runtimeMs:
      typeof item.RunTimeTicks === 'number'
        ? item.RunTimeTicks / TICKS_PER_MS
        : undefined,
    ...(tags.Primary ? {} : {}),
  };
}

/** A channel has no position worth keeping, so live playback writes no history. */
async function playingLive(
  ctx: JellyfinRequestContext,
  itemId: string,
  mediaSourceId: string | undefined
): Promise<boolean> {
  const memo = await resolveByItem(ctx.uuid, ctx.scope(), itemId).catch(
    () => null
  );
  if (!memo) return false;
  const source = pickSource(
    memo,
    mediaSourceId === itemId ? undefined : mediaSourceId
  );
  return !!source?.live;
}

/** Jellyfin takes the runtime from the source being played, then the item. */
async function durationFor(
  ctx: JellyfinRequestContext,
  d: ContentDescriptor,
  itemId: string,
  item: JellyfinItem | null,
  mediaSourceId: string | undefined
) {
  const memo = await resolveByItem(ctx.uuid, ctx.scope(), itemId);
  if (memo) {
    // The first source carries the item's id rather than its own.
    const source = pickSource(
      memo,
      mediaSourceId === itemId ? undefined : mediaSourceId
    );
    if (source?.durationMs && !source.live) return source.durationMs;
    if (memo.runtimeMs) return memo.runtimeMs;
  }
  return typeof item?.RunTimeTicks === 'number'
    ? item.RunTimeTicks / TICKS_PER_MS
    : undefined;
}

function sessionOf(
  ctx: JellyfinRequestContext,
  playSessionId?: string
): SessionContext {
  return {
    scope: ctx.watch,
    sessionKey: sessionKeyFor(ctx.client),
    user: ctx.persona?.id ?? '',
    client: ctx.client,
    playSessionId,
  };
}

function playSessionIdOf(req: Request): string | undefined {
  const v = bodyOf(req).PlaySessionId ?? qs(req, 'PlaySessionId');
  return typeof v === 'string' && v ? v : undefined;
}

function mediaSourceIdOf(req: Request): string | undefined {
  const v = bodyOf(req).MediaSourceId ?? qs(req, 'MediaSourceId');
  return typeof v === 'string' && v
    ? v.replace(/-/g, '').toLowerCase()
    : undefined;
}

async function record(
  ctx: JellyfinRequestContext,
  rawId: string,
  type: 'start' | 'progress' | 'stop',
  positionMs: number | undefined,
  opts: {
    paused?: boolean;
    playSessionId?: string;
    mediaSourceId?: string;
  } = {}
): Promise<void> {
  const d = await descriptorFor(ctx, rawId);
  if (!d || (d.k !== 'movie' && d.k !== 'episode')) return;
  if (await playingLive(ctx, rawId, opts.mediaSourceId)) {
    // The session still tracks what is on; only the history is skipped.
    const session = sessionOf(ctx, opts.playSessionId);
    if (type === 'start')
      await openWatchSession(session, contentRefOf(d), { positionMs });
    else if (type === 'stop') await closeWatchSession(session);
    else
      await checkInWatchSession(session, { positionMs, paused: opts.paused });
    return;
  }
  const ref = contentRefOf(d);
  const identity = await watchIdentityFor(ref);
  const session = sessionOf(ctx, opts.playSessionId);

  // one meta call on start and stop, none on the 5-10 s progress ticks
  const item =
    type === 'progress'
      ? null
      : await itemFromDescriptor(ctx, d).catch(() => null);
  const durationMs =
    type === 'progress'
      ? undefined
      : await durationFor(ctx, d, rawId, item, opts.mediaSourceId);
  const event: WatchEvent = {
    type,
    identity,
    positionMs,
    durationMs,
    snapshot: snapshotOf(item),
  };
  const row = await getWatchStateProvider().record(ctx.watch, event);

  if (type === 'start') {
    await openWatchSession(session, ref, {
      positionMs,
      durationMs,
      paused: false,
    });
    await reportPlayback(ctx, 'start', ref, {
      row,
      item,
      positionMs,
      durationMs,
    });
    return;
  }

  if (type === 'stop') {
    await closeWatchSession(session);
    await reportPlayback(ctx, 'stop', ref, {
      row,
      item,
      positionMs,
      durationMs,
    });
    return;
  }

  await progressed(ctx, session, ref, positionMs, opts.paused, row);
}

/** A tick keeps the session alive; only the pause edge is worth reporting. */
async function progressed(
  ctx: JellyfinRequestContext,
  session: SessionContext,
  ref: ContentRef,
  positionMs: number | undefined,
  paused: boolean | undefined,
  row: Awaited<ReturnType<ReturnType<typeof getWatchStateProvider>['record']>>
): Promise<void> {
  const { transition, row: existing } = await checkInWatchSession(session, {
    positionMs,
    paused,
  });

  // No row means no sweep could ever close it.
  if (!existing) {
    await openWatchSession(session, ref, { positionMs, paused });
    return;
  }

  // The runtime comes off the session: a tick is buffered, so `row` is null and
  // an event without a duration has the receiver store the position as zero.
  if (transition)
    await reportPlayback(ctx, transition, ref, {
      row,
      positionMs,
      durationMs: existing.durationMs || undefined,
    });
}

router.post(
  [
    '/Sessions/Playing',
    '/PlayingItems/:itemId',
    '/Users/:userId/PlayingItems/:itemId',
  ],
  jf(async (req, res, ctx) => {
    const id = idFrom(req);
    if (id)
      await record(
        ctx,
        id,
        'start',
        ticksToMs(bodyOf(req).PositionTicks ?? qs(req, 'PositionTicks')),
        {
          playSessionId: playSessionIdOf(req),
          mediaSourceId: mediaSourceIdOf(req),
        }
      );
    res.status(204).end();
  })
);
router.post(
  [
    '/Sessions/Playing/Progress',
    '/PlayingItems/:itemId/Progress',
    '/Users/:userId/PlayingItems/:itemId/Progress',
  ],
  jf(async (req, res, ctx) => {
    const id = idFrom(req);
    if (id) {
      const body = bodyOf(req);
      await record(
        ctx,
        id,
        'progress',
        ticksToMs(body.PositionTicks ?? qs(req, 'PositionTicks')),
        {
          paused: body.IsPaused === true || qs(req, 'IsPaused') === 'true',
          playSessionId: playSessionIdOf(req),
        }
      );
    }
    res.status(204).end();
  })
);
router.post(
  '/Sessions/Playing/Stopped',
  jf(async (req, res, ctx) => {
    const id = idFrom(req);
    if (id)
      await record(
        ctx,
        id,
        'stop',
        ticksToMs(bodyOf(req).PositionTicks ?? qs(req, 'PositionTicks')),
        { mediaSourceId: mediaSourceIdOf(req) }
      );
    res.status(204).end();
  })
);
router.delete(
  ['/PlayingItems/:itemId', '/Users/:userId/PlayingItems/:itemId'],
  jf(async (req, res, ctx) => {
    const id = idFrom(req);
    if (id)
      await record(ctx, id, 'stop', ticksToMs(qs(req, 'PositionTicks')), {
        mediaSourceId: mediaSourceIdOf(req),
      });
    res.status(204).end();
  })
);
/** Nothing depends on this: progress reports keep a session alive on their own. */
router.post(
  '/Sessions/Playing/Ping',
  jf(async (req, res, ctx) => {
    await checkInWatchSession(sessionOf(ctx, playSessionIdOf(req)), {}).catch(
      () => undefined
    );
    res.status(204).end();
  })
);

async function userDataFor(ctx: JellyfinRequestContext, d: ContentDescriptor) {
  const item = await itemFromDescriptor(ctx, d);
  return item?.UserData ?? null;
}

async function setPlayed(
  ctx: JellyfinRequestContext,
  d: ContentDescriptor,
  played: boolean
) {
  const provider = getWatchStateProvider();
  const kind = played ? 'played' : 'unplayed';
  if (d.k === 'series' || d.k === 'season') {
    const season = d.k === 'season' ? d.s : undefined;
    const r = await episodesForSeries(ctx, d, season);
    const marked: ContentRef[] = [];
    for (const ep of r?.episodes ?? []) {
      const epd = descriptorOf(ep);
      if (!epd || epd.k !== 'episode') continue;
      const epRef = contentRefOf(epd);
      await provider.record(ctx.watch, {
        type: kind,
        identity: await watchIdentityFor(epRef),
        snapshot: snapshotOf(ep),
      });
      marked.push(epRef);
    }
    await reportBulkMark(
      ctx,
      kind,
      { t: d.t, i: d.i, s: season },
      marked,
      r?.seriesItem
    );
    return;
  }
  const item = await itemFromDescriptor(ctx, d).catch(() => null);
  // A collection detail keeps its movie id, so the built item says what it is.
  if (d.k === 'boxset' || item?.Type === 'BoxSet') {
    const r = await boxSetChildren(ctx, d);
    for (const child of r?.children ?? []) {
      const cd = descriptorOf(child);
      if (!cd || cd.k !== 'movie') continue;
      const ref = contentRefOf(cd);
      const row = await provider.record(ctx.watch, {
        type: kind,
        identity: await watchIdentityFor(ref),
        snapshot: snapshotOf(child),
      });
      await reportPlayback(ctx, kind, ref, { row, item: child });
    }
    return;
  }
  const ref = contentRefOf(d);
  const row = await provider.record(ctx.watch, {
    type: kind,
    identity: await watchIdentityFor(ref),
    snapshot: snapshotOf(item),
  });
  await reportPlayback(ctx, kind, ref, { row, item });
}

const PLAYED_PATHS = [
  '/UserPlayedItems/:itemId',
  '/Users/:userId/PlayedItems/:itemId',
];
router.post(
  [
    ...PLAYED_PATHS,
    '/UserPlayedItems/:itemId/delete',
    '/Users/:userId/PlayedItems/:itemId/delete',
  ],
  jf(async (req, res, ctx) => {
    const d = await descriptorFor(ctx, param(req, 'itemId'), { season: true });
    if (!d) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    const unmark = /\/delete$/i.test(req.path);
    await setPlayed(ctx, d, !unmark);
    res.json((await userDataFor(ctx, d)) ?? { Played: !unmark });
  })
);
router.get(
  [
    '/UserPlayedItems/:itemId/delete',
    '/Users/:userId/PlayedItems/:itemId/delete',
  ],
  jf(async (req, res, ctx) => {
    const d = await descriptorFor(ctx, param(req, 'itemId'), { season: true });
    if (!d) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    await setPlayed(ctx, d, false);
    res.json((await userDataFor(ctx, d)) ?? { Played: false });
  })
);
router.delete(
  PLAYED_PATHS,
  jf(async (req, res, ctx) => {
    const d = await descriptorFor(ctx, param(req, 'itemId'), { season: true });
    if (!d) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    await setPlayed(ctx, d, false);
    res.json((await userDataFor(ctx, d)) ?? { Played: false });
  })
);

async function setFavorite(
  ctx: JellyfinRequestContext,
  d: ContentDescriptor,
  favorite: boolean
) {
  const item = await itemFromDescriptor(ctx, d).catch(() => null);
  const ref = contentRefOf(d);
  await getWatchStateProvider().record(ctx.watch, {
    type: favorite ? 'favorite' : 'unfavorite',
    identity: await watchIdentityFor(ref),
    snapshot: snapshotOf(item),
  });
  // Trackers keep watchlists of titles, not of episodes or collections.
  if (item?.Type === 'Movie' || item?.Type === 'Series')
    await reportWatchlist(ctx, favorite, ref, item);
}

const FAVORITE_PATHS = [
  '/UserFavoriteItems/:itemId',
  '/Users/:userId/FavoriteItems/:itemId',
];
router.post(
  [
    ...FAVORITE_PATHS,
    '/UserFavoriteItems/:itemId/delete',
    '/Users/:userId/FavoriteItems/:itemId/delete',
  ],
  jf(async (req, res, ctx) => {
    const d = await descriptorFor(ctx, param(req, 'itemId'));
    if (!d) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    const unmark = /\/delete$/i.test(req.path);
    await setFavorite(ctx, d, !unmark);
    res.json((await userDataFor(ctx, d)) ?? { IsFavorite: !unmark });
  })
);
router.get(
  [
    '/UserFavoriteItems/:itemId/delete',
    '/Users/:userId/FavoriteItems/:itemId/delete',
  ],
  jf(async (req, res, ctx) => {
    const d = await descriptorFor(ctx, param(req, 'itemId'));
    if (!d) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    await setFavorite(ctx, d, false);
    res.json((await userDataFor(ctx, d)) ?? { IsFavorite: false });
  })
);
router.delete(
  FAVORITE_PATHS,
  jf(async (req, res, ctx) => {
    const d = await descriptorFor(ctx, param(req, 'itemId'));
    if (!d) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    await setFavorite(ctx, d, false);
    res.json((await userDataFor(ctx, d)) ?? { IsFavorite: false });
  })
);

const USERDATA_PATHS = [
  '/UserItems/:itemId/UserData',
  '/Users/:userId/Items/:itemId/UserData',
];
router.get(
  USERDATA_PATHS,
  jf(async (req, res, ctx) => {
    const d = await descriptorFor(ctx, param(req, 'itemId'));
    if (!d) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    res.json((await userDataFor(ctx, d)) ?? {});
  })
);
router.post(
  USERDATA_PATHS,
  jf(async (req, res, ctx) => {
    const d = await descriptorFor(ctx, param(req, 'itemId'));
    if (!d) {
      res.status(404).json({ Message: 'Item not found' });
      return;
    }
    const body = bodyOf(req);
    if (typeof body.Played === 'boolean') await setPlayed(ctx, d, body.Played);
    if (typeof body.IsFavorite === 'boolean')
      await setFavorite(ctx, d, body.IsFavorite);
    if (
      typeof body.PlaybackPositionTicks === 'number' &&
      (d.k === 'movie' || d.k === 'episode')
    ) {
      const item = await itemFromDescriptor(ctx, d).catch(() => null);
      await getWatchStateProvider().record(ctx.watch, {
        type: 'stop',
        identity: await watchIdentityFor(contentRefOf(d)),
        positionMs: ticksToMs(body.PlaybackPositionTicks),
        durationMs:
          typeof item?.RunTimeTicks === 'number'
            ? item.RunTimeTicks / TICKS_PER_MS
            : undefined,
        snapshot: snapshotOf(item),
      });
    }
    res.json((await userDataFor(ctx, d)) ?? {});
  })
);

export default router;
