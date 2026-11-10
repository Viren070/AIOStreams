import { Router, type Request } from 'express';
import {
  buildChannelItem,
  buildProgramItem,
  descriptorForWatchRow,
  getWatchStateProvider,
  guideDaysBack,
  listChannels,
  liveCatalogs,
  programmesFor,
  stripInternal,
  type JellyfinItem,
  type MetaPreview,
} from '@aiostreams/core';
import { jf, param, qb, qi, qlist, qs } from './context.js';
import type { JellyfinRequestContext } from './context.js';
import {
  channelListItems,
  decodeForRequest,
  itemFromDescriptor,
} from './items.js';
import { send } from './library.js';

/*
 * Live TV over the user's live catalogs. Recordings, timers, tuners and
 * listing providers have no counterpart in an addon and stay empty (stubs.ts).
 */
const router: Router = Router({ mergeParams: true });

const DAY_MS = 86_400_000;
const GUIDE_DAYS = 7;
const MAX_LIMIT = 500;
/** Channels read for a request that names none, such as what is on now. */
const UNNAMED_CHANNELS = 100;
const MAX_FAVOURITES = 200;

const keyOf = (c: { type: string; id: string }) => `${c.type}|${c.id}`;

/** A query field, or the same field of a POST body as Jellyfin's clients send it. */
function field(req: Request, name: string): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;
  const raw = body?.[name] ?? body?.[name[0].toLowerCase() + name.slice(1)];
  if (Array.isArray(raw)) return raw.join(',');
  if (raw != null && raw !== '') return String(raw);
  return qs(req, name);
}

function list(req: Request, name: string): string[] {
  const value = field(req, name);
  return value ? value.split(/[,|]/).filter(Boolean) : qlist(req, name);
}

function flag(req: Request, name: string): boolean | undefined {
  const value = field(req, name)?.toLowerCase();
  return value === 'true' ? true : value === 'false' ? false : qb(req, name);
}

function time(req: Request, name: string): number | undefined {
  const at = Date.parse(field(req, name) ?? '');
  return Number.isFinite(at) ? at : undefined;
}

/** A group: a genre named outright, or by a genre item's id. */
async function groupOf(
  req: Request,
  ctx: JellyfinRequestContext
): Promise<string | undefined> {
  const named = list(req, 'Genres')[0];
  if (named) return named;
  const id = list(req, 'GenreIds')[0];
  const d = id ? await decodeForRequest(ctx, id) : null;
  return d?.kind === 'descriptor' && d.descriptor.k === 'genre'
    ? d.descriptor.g
    : undefined;
}

async function favouriteChannels(
  ctx: JellyfinRequestContext
): Promise<JellyfinItem[]> {
  const rows = await getWatchStateProvider().listFavorites(ctx.watch, [
    'movie',
  ]);
  const built = await Promise.all(
    rows.slice(0, MAX_FAVOURITES).map((row) =>
      itemFromDescriptor(ctx, descriptorForWatchRow(row), {
        playstate: row,
      }).catch(() => null)
    )
  );
  return built.filter(
    (item): item is JellyfinItem =>
      item?.Type === 'TvChannel' &&
      !(item.aiostreams as { noMeta?: boolean } | undefined)?.noMeta
  );
}

const favouritesFirst = (items: JellyfinItem[]) =>
  [...items].sort(
    (a, b) =>
      Number(!!(b.UserData as { IsFavorite?: boolean })?.IsFavorite) -
      Number(!!(a.UserData as { IsFavorite?: boolean })?.IsFavorite)
  );

router.get(
  '/LiveTv/Info',
  jf(async (_req, res, ctx) => {
    const live = liveCatalogs(await ctx.engine()).length > 0;
    res.json({
      Services: live
        ? [
            {
              Name: 'AIOStreams',
              Status: 'Ok',
              IsVisible: true,
              HasUpdateAvailable: false,
              Tuners: [],
            },
          ]
        : [],
      IsEnabled: live,
      EnabledUsers: live ? [ctx.userId] : [],
    });
  })
);

router.get(
  '/LiveTv/GuideInfo',
  jf(async (_req, res, ctx) => {
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const back = guideDaysBack(await ctx.engine());
    res.json({
      StartDate: new Date(today - back * DAY_MS).toISOString(),
      EndDate: new Date(today + GUIDE_DAYS * DAY_MS).toISOString(),
    });
  })
);

router.get(
  '/LiveTv/Channels',
  jf(async (req, res, ctx) => {
    const startIndex = Math.max(0, qi(req, 'StartIndex', 0));
    const limit = Math.min(Math.max(1, qi(req, 'Limit', 100)), MAX_LIMIT);
    if (qb(req, 'IsFavorite') === true) {
      const items = await favouriteChannels(ctx);
      send(
        req,
        res,
        items.slice(startIndex, startIndex + limit),
        items.length,
        startIndex
      );
      return;
    }
    const { channels, total } = await listChannels(
      await ctx.engine(),
      ctx.scope(),
      { startIndex, limit, genre: await groupOf(req, ctx) }
    );
    const items = await channelListItems(
      ctx,
      channels,
      qb(req, 'AddCurrentProgram') !== false
    );
    send(
      req,
      res,
      qb(req, 'EnableFavoriteSorting') ? favouritesFirst(items) : items,
      total,
      startIndex
    );
  })
);

router.get(
  '/LiveTv/Channels/:channelId',
  jf(async (req, res, ctx) => {
    const d = await decodeForRequest(ctx, param(req, 'channelId'));
    const item =
      d?.kind === 'descriptor'
        ? await itemFromDescriptor(ctx, d.descriptor).catch(() => null)
        : null;
    if (item?.Type !== 'TvChannel') {
      res.status(404).json({ Message: 'Channel not found' });
      return;
    }
    res.json(stripInternal(item));
  })
);

const FLAGS = ['IsMovie', 'IsSeries', 'IsNews', 'IsKids', 'IsSports'];

async function programmeItems(
  req: Request,
  ctx: JellyfinRequestContext,
  recommended: boolean
): Promise<{ items: JellyfinItem[]; total: number; startIndex: number }> {
  const now = Date.now();
  const airing = recommended
    ? (flag(req, 'IsAiring') ?? true)
    : flag(req, 'IsAiring');
  const aired = flag(req, 'HasAired');
  const minStart = time(req, 'MinStartDate');
  const maxStart = time(req, 'MaxStartDate');
  const minEnd = time(req, 'MinEndDate');
  const maxEnd = time(req, 'MaxEndDate');
  const from = airing ? now : (minEnd ?? minStart ?? now);
  const to = airing ? now + 1 : (maxStart ?? maxEnd ?? from + DAY_MS);

  const engine = await ctx.engine();
  const named = list(req, 'ChannelIds');
  const channels: { meta: MetaPreview; number?: string }[] = [];
  if (named.length) {
    for (const id of named) {
      const d = await decodeForRequest(ctx, id);
      if (d?.kind === 'descriptor' && d.descriptor.k === 'movie')
        channels.push({
          meta: { id: d.descriptor.i, type: d.descriptor.t } as MetaPreview,
        });
    }
  } else {
    const listed = await listChannels(engine, ctx.scope(), {
      startIndex: 0,
      limit: UNNAMED_CHANNELS,
      genre: await groupOf(req, ctx),
    });
    channels.push(...listed.channels);
  }
  const guide = await programmesFor(
    engine,
    ctx.scope(),
    channels.map((c) => c.meta),
    from,
    to
  );
  const flags = FLAGS.filter((f) => flag(req, f) !== undefined);
  const genres = new Set(list(req, 'Genres').map((g) => g.toLowerCase()));
  let items: JellyfinItem[] = [];
  for (const { meta, number } of channels) {
    const found = guide.get(keyOf(meta));
    const channelMeta = { ...meta, ...found?.meta };
    const channel = buildChannelItem(ctx.build, channelMeta, { number });
    for (const p of found?.programmes ?? []) {
      if (minStart !== undefined && p.start < minStart) continue;
      if (maxStart !== undefined && p.start > maxStart) continue;
      if (minEnd !== undefined && p.end < minEnd) continue;
      if (maxEnd !== undefined && p.end > maxEnd) continue;
      if (airing !== undefined && (p.start <= now && now < p.end) !== airing)
        continue;
      if (aired !== undefined && p.end <= now !== aired) continue;
      if (genres.size && !p.genres.some((g) => genres.has(g.toLowerCase())))
        continue;
      const item = buildProgramItem(ctx.build, channelMeta, p, channel);
      if (flags.some((f) => item[f] !== flag(req, f))) continue;
      items.push(item);
    }
  }
  const sortBy = list(req, 'SortBy').map((s) => s.toLowerCase());
  if (!sortBy.includes('sortname') && !sortBy.includes('name'))
    items.sort(
      (a, b) =>
        Date.parse(String(a.StartDate)) - Date.parse(String(b.StartDate))
    );
  else items.sort((a, b) => String(a.Name).localeCompare(String(b.Name)));
  if (list(req, 'SortOrder')[0]?.toLowerCase() === 'descending')
    items = items.reverse();
  const startIndex = Math.max(0, Number(field(req, 'StartIndex')) || 0);
  const limit = Math.min(
    Math.max(1, Number(field(req, 'Limit')) || items.length || 1),
    MAX_LIMIT * 4
  );
  return {
    items: items.slice(startIndex, startIndex + limit),
    total: items.length,
    startIndex,
  };
}

router.all(
  '/LiveTv/Programs',
  jf(async (req, res, ctx) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).end();
      return;
    }
    const { items, total, startIndex } = await programmeItems(req, ctx, false);
    send(req, res, items, total, startIndex);
  })
);

router.get(
  '/LiveTv/Programs/Recommended',
  jf(async (req, res, ctx) => {
    const { items, total, startIndex } = await programmeItems(req, ctx, true);
    send(req, res, items, total, startIndex);
  })
);

router.get(
  '/LiveTv/Programs/:programId',
  jf(async (req, res, ctx) => {
    const d = await decodeForRequest(ctx, param(req, 'programId'));
    const item =
      d?.kind === 'descriptor' && d.descriptor.k === 'program'
        ? await itemFromDescriptor(ctx, d.descriptor).catch(() => null)
        : null;
    if (!item) {
      res.status(404).json({ Message: 'Program not found' });
      return;
    }
    res.json(stripInternal(item));
  })
);

export default router;
