import type { MetaPreview } from '../db/schemas.js';
import type { WatchStateRow } from '../db/repositories/watch-state.js';
import type { AIOStreams } from '../main/index.js';
import { Cache } from '../utils/cache.js';
import {
  baseItem,
  buildContentItem,
  hasProgrammeVideos,
  type Catalog,
} from './dto.js';
import type { ItemBuildContext } from './dto.js';
import { encodeItemId, LIVE_TV_VIEW_ID, personId } from './ids.js';
import { imageTagsFor, rememberImages } from './images.js';
import {
  buildExtras,
  catalogKey,
  exposedCatalogs,
  genreOptions,
  hasGuide,
  isLiveCatalog,
  limitedCatalog,
  supportsExtra,
} from './library.js';
import { msToTicks } from './media.js';
import type {
  ContentDescriptor,
  ItemImages,
  JellyfinItem,
  ProgramDescriptor,
} from './types.js';

/** Live by its content when the url says nothing: a channel, the hint, or a schedule. */
export function isChannel(type: string, meta: unknown): boolean {
  const hints = (meta as { behaviorHints?: { isLive?: unknown } } | null)
    ?.behaviorHints;
  return (
    type === 'tv' ||
    type === 'channel' ||
    hints?.isLive === true ||
    hasProgrammeVideos(meta as Parameters<typeof hasProgrammeVideos>[0])
  );
}

export function liveCatalogs(engine: AIOStreams): Catalog[] {
  return exposedCatalogs(engine).filter(isLiveCatalog);
}

/** The one view that stands for every live catalog, as Jellyfin's Live TV does. */
export function buildLiveTvView(ctx: ItemBuildContext): JellyfinItem {
  return {
    ...baseItem(ctx, LIVE_TV_VIEW_ID, 'Live TV', 'UserView', true),
    CollectionType: 'livetv',
    DisplayPreferencesId: LIVE_TV_VIEW_ID,
    _aio: { descriptor: { k: 'livetv' } },
  };
}

export interface Programme {
  id: string;
  title: string;
  start: number;
  end: number;
  overview?: string;
  image?: string;
  background?: string;
  genres: string[];
  cast: string[];
  directors: string[];
  season?: number;
  episode?: number;
  imdbId?: string;
}

const text = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const texts = (v: unknown) =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && !!x)
    : [];
const whole = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) ? v : undefined;

/** A channel's schedule: in a guide, its videos carry `startTime` and `endTime`. */
export function programmesOf(entry: unknown): Programme[] {
  const videos = (entry as { videos?: unknown } | null | undefined)?.videos;
  if (!Array.isArray(videos)) return [];
  const out: Programme[] = [];
  for (const v of videos as Record<string, unknown>[]) {
    const id = text(v?.id);
    const start = Date.parse(String(v?.startTime ?? ''));
    const end = Date.parse(String(v?.endTime ?? ''));
    if (!id || !(end > start)) continue;
    out.push({
      id,
      title: text(v.title) ?? text(v.name) ?? '',
      start,
      end,
      overview: text(v.overview),
      image: text(v.thumbnail),
      background: text(v.background),
      genres: texts(v.genres),
      cast: texts(v.cast),
      directors: texts(v.directors),
      season: whole(v.season),
      episode: whole(v.episode),
      imdbId: text(v.imdbId),
    });
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  // Merged guides overlap: a programme ends where the next one starts, and of
  // two starting together the longer is kept.
  const kept: Programme[] = [];
  for (const p of out) {
    const last = kept.at(-1);
    if (last && p.start <= last.start) continue;
    if (last && last.end > p.start) last.end = p.start;
    kept.push(p);
  }
  return kept;
}

export function airingAt(
  programmes: Programme[],
  at: number
): Programme | undefined {
  return programmes.find((p) => p.start <= at && at < p.end);
}

const DAY_MS = 86_400_000;
const GUIDE_SAMPLE = 100;
const MAX_DAYS_BACK = 14;

/** The UTC days a window touches, as the guide's `date` extra names them. */
export function utcDays(from: number, to: number): string[] {
  const days: string[] = [];
  for (let at = Math.floor(from / DAY_MS) * DAY_MS; at < to; at += DAY_MS)
    days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

/** A live catalog's channels in order, read a page at a time as clients go further. */
interface Lineup {
  channels: MetaPreview[];
  skips: number[];
  next: number;
  done: boolean;
  /** How many of the channels have had their place recorded. */
  placed: number;
}

/** Where a channel was listed, so its programmes come from the same page on any day. */
interface Placement {
  catalog: string;
  genre?: string;
  skip: number;
  number?: string;
}

const LINEUP_TTL = 60 * 60;
const MAX_PAGES = 40;
// Shared, not copied on every read: a lineup is replaced as it grows and a
// placement is never changed.
const lineups = Cache.getInstance<string, Lineup>(
  'jellyfin-live-lineup',
  2_000,
  'memory',
  { clone: false }
);
const placements = Cache.getInstance<string, Placement>(
  'jellyfin-live-placement',
  200_000,
  'memory',
  { clone: false }
);

const channelKey = (scope: string, c: { type: string; id: string }) =>
  `${scope}|${c.type}|${c.id}`;

/** A page without a date lists the channels alone, which guides answer cheaply. */
async function readPage(
  engine: AIOStreams,
  catalog: Catalog,
  skip: number,
  genre?: string,
  date?: string,
  ids?: string[]
): Promise<MetaPreview[]> {
  const extras = buildExtras(catalog, { genre, skip, date, ids });
  const res = await limitedCatalog(engine.getUserData().uuid ?? '', () =>
    engine.getCatalog(catalog.type, catalog.id, extras)
  );
  return res.data ?? [];
}

async function lineupOf(
  engine: AIOStreams,
  scope: string,
  catalog: Catalog,
  genre: string | undefined,
  want: number
): Promise<Lineup> {
  const key = `${scope}|${catalogKey(catalog)}|${genre ?? ''}`;
  const cached = await lineups.get(key).catch(() => undefined);
  if (cached && (cached.done || cached.channels.length >= want)) return cached;
  const lineup: Lineup = cached
    ? { ...cached, channels: [...cached.channels], skips: [...cached.skips] }
    : { channels: [], skips: [], next: 0, done: false, placed: 0 };
  const seen = new Set(lineup.channels.map((c) => `${c.type}|${c.id}`));
  let pages = 0;
  while (!lineup.done && lineup.channels.length < want && pages < MAX_PAGES) {
    const page = await readPage(engine, catalog, lineup.next, genre);
    pages++;
    let fresh = 0;
    for (const meta of page) {
      const id = `${meta?.type}|${meta?.id}`;
      if (!meta?.id || seen.has(id)) continue;
      seen.add(id);
      // The guide's programmes are read again from the page on demand.
      lineup.channels.push({ ...meta, videos: undefined });
      lineup.skips.push(lineup.next);
      fresh++;
    }
    lineup.next += page.length;
    if (!fresh || !supportsExtra(catalog, 'skip')) lineup.done = true;
  }
  if (pages) await lineups.set(key, lineup, LINEUP_TTL);
  return lineup;
}

export interface ListedChannel {
  meta: MetaPreview;
  number?: string;
}

/**
 * Channels across the live catalogs in the user's order, numbered by their
 * place in that whole list unless the addon numbers them. A group lists a
 * genre, and keeps the numbers the whole list gave its channels.
 */
export async function listChannels(
  engine: AIOStreams,
  scope: string,
  opts: { startIndex: number; limit: number; genre?: string }
): Promise<{ channels: ListedChannel[]; total: number }> {
  const end = opts.startIndex + opts.limit;
  const channels: ListedChannel[] = [];
  let offset = 0;
  let complete = true;
  for (const catalog of liveCatalogs(engine)) {
    if (opts.genre && !genreOptions(catalog).includes(opts.genre)) continue;
    const lineup = await lineupOf(
      engine,
      scope,
      catalog,
      opts.genre,
      end - offset
    );
    const place = async (i: number) => {
      const meta = lineup.channels[i];
      const key = channelKey(scope, meta);
      const placed = await placements.get(key).catch(() => undefined);
      const number =
        text(String(meta.channelNumber ?? '')) ??
        (opts.genre ? placed?.number : String(offset + i + 1));
      if (!placed || (!opts.genre && placed.genre !== undefined))
        await placements.set(
          key,
          {
            catalog: catalogKey(catalog),
            genre: opts.genre,
            skip: lineup.skips[i],
            number,
          },
          LINEUP_TTL
        );
      return number;
    };
    // New channels are placed once; the page's own are checked again, as a
    // place can expire before its lineup.
    for (let i = lineup.placed; i < lineup.channels.length; i++) await place(i);
    lineup.placed = lineup.channels.length;
    const last = Math.min(lineup.channels.length, end - offset);
    for (let i = Math.max(0, opts.startIndex - offset); i < last; i++)
      channels.push({ meta: lineup.channels[i], number: await place(i) });
    offset += lineup.channels.length;
    if (!lineup.done) {
      complete = false;
      break;
    }
  }
  return { channels, total: complete ? offset : Math.max(offset, end) + 1 };
}

/** How far a search reads the channel list, which it holds an hour. */
const SEARCHED = 5_000;

/** A catalog's own search, for channels past what the list reads. */
async function searchCatalog(
  engine: AIOStreams,
  scope: string,
  catalog: Catalog,
  term: string
): Promise<ListedChannel[]> {
  const res = await limitedCatalog(engine.getUserData().uuid ?? '', () =>
    engine.getCatalog(
      catalog.type,
      catalog.id,
      buildExtras(catalog, { search: term })
    )
  ).catch(() => undefined);
  return Promise.all(
    (res?.data ?? []).map(async (meta) => ({
      meta,
      number:
        text(String(meta.channelNumber ?? '')) ??
        (await channelNumberOf(scope, meta)),
    }))
  );
}

/** Channels whose names hold every word of the term, in list order. */
export async function searchChannels(
  engine: AIOStreams,
  scope: string,
  term: string,
  limit: number
): Promise<ListedChannel[]> {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const [{ channels }, ...searched] = await Promise.all([
    listChannels(engine, scope, { startIndex: 0, limit: SEARCHED }),
    ...liveCatalogs(engine)
      .filter((c) => supportsExtra(c, 'search'))
      .map((c) => searchCatalog(engine, scope, c, term)),
  ]);
  const named = channels.filter(({ meta }) => {
    const name = (meta.name ?? '').toLowerCase();
    return words.every((w) => name.includes(w));
  });
  const seen = new Set(named.map(({ meta }) => `${meta.type}|${meta.id}`));
  for (const found of searched.flat()) {
    const key = `${found.meta.type}|${found.meta.id}`;
    if (!seen.has(key)) named.push(found);
    seen.add(key);
  }
  // A channel's number finds it too, ahead of names holding the digits.
  const numbered =
    channels.find(({ number }) => number === term.trim()) ??
    named.find(({ number }) => number === term.trim());
  return (
    numbered ? [numbered, ...named.filter((c) => c !== numbered)] : named
  ).slice(0, limit);
}

export async function channelNumberOf(
  scope: string,
  channel: { type: string; id: string }
): Promise<string | undefined> {
  return (
    await placements.get(channelKey(scope, channel)).catch(() => undefined)
  )?.number;
}

export interface ChannelGuide {
  meta?: MetaPreview;
  programmes: Programme[];
}

/** Channels asked for at once from a guide that takes ids. */
const IDS_PER_REQUEST = 50;

interface GuideRead {
  catalog: Catalog;
  day: string;
  wanted: Set<string>;
  skip: number;
  genre?: string;
  ids?: Set<string>;
}

/**
 * Each channel's programmes overlapping a window, keyed `type|id`, read once
 * per UTC day: by id from a guide that takes ids, else from the guide page it
 * was listed on, else from its own meta.
 */
export async function programmesFor(
  engine: AIOStreams,
  scope: string,
  channels: { type: string; id: string }[],
  from: number,
  to: number
): Promise<Map<string, ChannelGuide>> {
  const catalogs = new Map(liveCatalogs(engine).map((c) => [catalogKey(c), c]));
  const reads = new Map<string, GuideRead>();
  const unplaced: { type: string; id: string }[] = [];
  for (const channel of channels) {
    const placement = await placements
      .get(channelKey(scope, channel))
      .catch(() => undefined);
    const catalog = placement && catalogs.get(placement.catalog);
    if (!catalog || !hasGuide(catalog)) {
      unplaced.push(channel);
      continue;
    }
    const byId = supportsExtra(catalog, 'ids');
    for (const day of utcDays(from, to)) {
      const key = byId
        ? `${placement.catalog}|${day}`
        : `${placement.catalog}|${placement.genre ?? ''}|${placement.skip}|${day}`;
      const read = reads.get(key) ?? {
        catalog,
        day,
        wanted: new Set<string>(),
        ...(byId
          ? { skip: 0, ids: new Set<string>() }
          : { skip: placement.skip, genre: placement.genre }),
      };
      read.wanted.add(`${channel.type}|${channel.id}`);
      read.ids?.add(channel.id);
      reads.set(key, read);
    }
  }
  const requests = [...reads.values()].flatMap((read) => {
    if (!read.ids) return [{ read, ids: undefined }];
    const ids = [...read.ids].sort();
    const chunks: { read: GuideRead; ids?: string[] }[] = [];
    for (let at = 0; at < ids.length; at += IDS_PER_REQUEST)
      chunks.push({ read, ids: ids.slice(at, at + IDS_PER_REQUEST) });
    return chunks;
  });
  const found = new Map<string, ChannelGuide>();
  const add = (key: string, meta: MetaPreview | null | undefined) =>
    found.set(key, {
      meta: found.get(key)?.meta ?? meta ?? undefined,
      programmes: [
        ...(found.get(key)?.programmes ?? []),
        ...programmesOf(meta),
      ],
    });
  await Promise.all([
    ...requests.map(async ({ read, ids }) => {
      const metas = await readPage(
        engine,
        read.catalog,
        read.skip,
        read.genre,
        read.day,
        ids
      ).catch(() => []);
      for (const meta of metas) {
        const key = `${meta.type}|${meta.id}`;
        if (read.wanted.has(key)) add(key, meta);
      }
    }),
    ...unplaced.map(async (channel) => {
      const meta = await engine
        .getMeta(channel.type, channel.id)
        .then((res) => res.data)
        .catch(() => null);
      add(`${channel.type}|${channel.id}`, meta);
    }),
  ]);
  for (const guide of found.values()) {
    const byStart = new Map(guide.programmes.map((p) => [p.start, p]));
    guide.programmes = [...byStart.values()]
      .filter((p) => p.end > from && p.start < to)
      .sort((a, b) => a.start - b.start);
  }
  return found;
}

export function channelOf(d: ProgramDescriptor): ContentDescriptor {
  return { k: 'movie', t: d.t, i: d.i };
}

/** The days back a channel's addon plays its programmes from, by `behaviorHints.catchupDays`. */
export function catchupDaysOf(meta: unknown): number {
  const days = (meta as { behaviorHints?: { catchupDays?: unknown } } | null)
    ?.behaviorHints?.catchupDays;
  return typeof days === 'number' && days > 0 ? days : 0;
}

/** Whether a programme that has begun is still within its channel's catch-up. */
export function caughtUp(meta: unknown, start: number, now = Date.now()) {
  const days = catchupDaysOf(meta);
  return days > 0 && start <= now && start >= now - days * DAY_MS;
}

/**
 * What a programme's id plays: the programme from its start, as an episode of
 * its channel, where the channel keeps it; else the channel live.
 */
export async function programmeTarget(
  engine: AIOStreams,
  scope: string,
  d: ProgramDescriptor
): Promise<ContentDescriptor> {
  if (d.at <= Date.now()) {
    const guide = (
      await programmesFor(
        engine,
        scope,
        [{ type: d.t, id: d.i }],
        d.at,
        d.at + 1
      )
    ).get(`${d.t}|${d.i}`);
    const programme = guide?.programmes.find((p) => p.start === d.at);
    if (programme && caughtUp(guide?.meta, programme.start))
      return { k: 'episode', t: d.t, i: d.i, s: 0, e: 0, v: programme.id };
  }
  return channelOf(d);
}

/** How far back the guide goes: the longest catch-up of the first channels listed. */
export async function guideDaysBack(
  engine: AIOStreams,
  scope: string
): Promise<number> {
  const { channels } = await listChannels(engine, scope, {
    startIndex: 0,
    limit: GUIDE_SAMPLE,
  });
  return Math.min(
    MAX_DAYS_BACK,
    Math.max(0, ...channels.map(({ meta }) => catchupDaysOf(meta)))
  );
}

/** Built on the entry's content item, so the channel keeps the id favourites and history know. */
export function buildChannelItem(
  ctx: ItemBuildContext,
  meta: MetaPreview,
  opts: { number?: string; airing?: Programme; playstate?: WatchStateRow } = {}
): JellyfinItem {
  const item = buildContentItem(ctx, meta, {
    leaf: true,
    playstate: opts.playstate,
  });
  const logo = text(meta.logo) ?? text(meta.poster);
  const channel: JellyfinItem = {
    ...item,
    Type: 'TvChannel',
    MediaType: 'Video',
    ChannelType: 'TV',
    ...(logo && {
      ImageTags: {
        ...(item.ImageTags as object),
        ...imageTagsFor({ Primary: logo }).ImageTags,
      },
    }),
    ...(opts.number && { ChannelNumber: opts.number, Number: opts.number }),
  };
  if (opts.airing)
    channel.CurrentProgram = buildProgramItem(ctx, meta, opts.airing, channel);
  return channel;
}

const FLAG_GENRES: [string, RegExp][] = [
  ['IsMovie', /\b(movie|film)s?\b/i],
  ['IsNews', /\bnews\b/i],
  ['IsKids', /\b(kids|children|animation|cartoon)s?\b/i],
  ['IsSports', /\bsports?\b/i],
];

export function buildProgramItem(
  ctx: ItemBuildContext,
  channelMeta: Pick<MetaPreview, 'type' | 'id'> & { behaviorHints?: unknown },
  programme: Programme,
  channel: JellyfinItem
): JellyfinItem {
  const descriptor: ProgramDescriptor = {
    k: 'program',
    t: channelMeta.type,
    i: channelMeta.id,
    at: programme.start,
  };
  const id = encodeItemId(descriptor);
  const images: ItemImages = {};
  if (programme.image) images.Primary = programme.image;
  if (programme.background) images.Backdrop = programme.background;
  rememberImages(id, images);
  const genre = programme.genres.join(' ');
  return {
    ...baseItem(ctx, id, programme.title || channel.Name, 'Program', false),
    MediaType: 'Video',
    LocationType: 'Remote',
    Overview: programme.overview,
    ChannelId: channel.Id,
    ChannelName: channel.Name,
    ChannelNumber: channel.ChannelNumber,
    ChannelPrimaryImageTag: (channel.ImageTags as { Primary?: string })
      ?.Primary,
    ChannelType: 'TV',
    StartDate: new Date(programme.start).toISOString(),
    EndDate: new Date(programme.end).toISOString(),
    RunTimeTicks: msToTicks(programme.end - programme.start),
    IsSeries: programme.season !== undefined || programme.episode !== undefined,
    ParentIndexNumber: programme.season,
    IndexNumber: programme.episode,
    Genres: programme.genres,
    People: [
      ...programme.cast.map((name) => ({ name, type: 'Actor' })),
      ...programme.directors.map((name) => ({ name, type: 'Director' })),
    ].map(({ name, type }) => ({
      Name: name,
      Type: type,
      Id: personId({ k: 'person', n: name }),
    })),
    ProviderIds: programme.imdbId ? { Imdb: programme.imdbId } : {},
    ...(caughtUp(channelMeta, programme.start) && {
      aiostreams: { catchup: true },
    }),
    ...imageTagsFor(images),
    ...Object.fromEntries(
      FLAG_GENRES.map(([flag, re]) => [flag, re.test(genre)])
    ),
    _aio: { descriptor },
  };
}
