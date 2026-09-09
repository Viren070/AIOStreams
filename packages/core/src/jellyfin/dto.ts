import type { Manifest, Meta, MetaPreview, ParsedMeta } from '../db/schemas.js';
import type { WatchStateRow } from '../db/repositories/watch-state.js';
import { IdParser } from '../utils/id-parser.js';
import {
  genresFrom,
  imdbRatingOf,
  parseRuntimeMs,
  parseYear,
  readEnrichment,
  toIso,
  type Enrichment,
} from './enrichment.js';
import {
  encodeItemId,
  genreId,
  personId,
  resolveMarkerId,
  viewId,
} from './ids.js';
import { imageTagsFor, rememberImages } from './images.js';
import { listPlaceholderSources, TICKS_PER_MS } from './media.js';
import { getSimpleTextHash } from '../utils/crypto.js';
import type {
  ContentDescriptor,
  ItemImages,
  JellyfinDescriptor,
  JellyfinItem,
  QueryResult,
  UserItemDataDto,
} from './types.js';

export type Catalog = NonNullable<Manifest['catalogs']>[number];
export type CollectionType = 'movies' | 'tvshows' | 'boxsets';

export interface ItemBuildContext {
  serverId: string;
  userId: string;
  uuid: string;
  /** Whether list rows advertise placeholder versions, see `listPlaceholderSources`. */
  listVersions: boolean;
}

type AnyMeta = (MetaPreview | Meta) & Record<string, unknown>;

const EPOCH_DATE = '2020-01-01T00:00:00.0000000Z';

const DTO_VERSION = 1;

function etagFor(id: string): string {
  return getSimpleTextHash(`${DTO_VERSION}|${id}`).slice(0, 32);
}

export function listResult<T>(
  items: T[],
  total?: number,
  startIndex = 0
): QueryResult<T> {
  return {
    Items: items,
    TotalRecordCount: total ?? startIndex + items.length,
    StartIndex: startIndex,
  };
}

export function stripInternal(item: JellyfinItem): JellyfinItem {
  const { _aio, ...rest } = item as JellyfinItem & { _aio?: unknown };
  return rest as JellyfinItem;
}

export function descriptorOf(
  item: JellyfinItem
): JellyfinDescriptor | undefined {
  return (item as { _aio?: { descriptor?: JellyfinDescriptor } })._aio
    ?.descriptor;
}

export function defaultUserData(itemId: string): UserItemDataDto {
  return {
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Played: false,
    Key: itemId,
    ItemId: itemId,
  };
}

export function userDataFromRow(
  itemId: string,
  row: WatchStateRow | undefined,
  runtimeMs?: number
): UserItemDataDto {
  if (!row) return defaultUserData(itemId);
  const duration = runtimeMs || row.durationMs;
  const ud: UserItemDataDto = {
    PlaybackPositionTicks: row.played ? 0 : row.positionMs * TICKS_PER_MS,
    PlayCount: row.playCount,
    IsFavorite: row.favorite,
    Played: row.played,
    Key: itemId,
    ItemId: itemId,
  };
  if (row.lastPlayedAt)
    ud.LastPlayedDate = new Date(row.lastPlayedAt).toISOString();
  if (!row.played && duration > 0 && row.positionMs > 0) {
    ud.PlayedPercentage = Math.min(100, (row.positionMs / duration) * 100);
  }
  return ud;
}

/** Stremio type -> the Jellyfin id-type parsed from the meta id. */
export function providerIdsFor(
  meta: { id: string; type: string },
  enrichment?: Enrichment
) {
  const out: Record<string, string> = { ...(enrichment?.providerIds ?? {}) };
  const parsed = IdParser.parse(meta.id, meta.type);
  if (parsed && !parsed.season && !parsed.episode) {
    const v = String(parsed.value);
    const map: Record<string, string> = {
      imdbId: 'Imdb',
      themoviedbId: 'Tmdb',
      thetvdbId: 'Tvdb',
      kitsuId: 'Kitsu',
      malId: 'MyAnimeList',
      anilistId: 'AniList',
      anidbId: 'AniDB',
      simklId: 'Simkl',
    };
    const key = map[parsed.type];
    if (key && !out[key])
      out[key] = key === 'Imdb' && !v.startsWith('tt') ? `tt${v}` : v;
  }
  return out;
}

function externalUrls(providerIds: Record<string, string>) {
  const urls: { Name: string; Url: string }[] = [];
  if (providerIds.Imdb)
    urls.push({
      Name: 'IMDb',
      Url: `https://www.imdb.com/title/${providerIds.Imdb}`,
    });
  if (providerIds.MyAnimeList)
    urls.push({
      Name: 'MyAnimeList',
      Url: `https://myanimelist.net/anime/${providerIds.MyAnimeList}`,
    });
  if (providerIds.AniList)
    urls.push({
      Name: 'AniList',
      Url: `https://anilist.co/anime/${providerIds.AniList}`,
    });
  if (providerIds.Kitsu)
    urls.push({
      Name: 'Kitsu',
      Url: `https://kitsu.app/anime/${providerIds.Kitsu}`,
    });
  return urls;
}

export function sortNameFor(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\d+/g, (digits) => digits.padStart(10, '0'));
}

function aspectRatioFor(shape: unknown): number {
  return shape === 'landscape' ? 1.7777 : shape === 'square' ? 1 : 0.6666;
}

function baseItem(
  ctx: ItemBuildContext,
  id: string,
  name: string,
  type: string,
  folder: boolean
): JellyfinItem {
  return {
    Id: id,
    Name: name,
    ServerId: ctx.serverId,
    Type: type,
    IsFolder: folder,
    Etag: etagFor(id),
    DateCreated: EPOCH_DATE,
    CanDelete: false,
    CanDownload: false,
    LocationType: 'FileSystem',
    PlayAccess: 'Full',
    SortName: sortNameFor(name),
    Genres: [],
    GenreItems: [],
    People: [],
    Studios: [],
    Tags: [],
    Taglines: [],
    ProviderIds: {},
    ExternalUrls: [],
    RemoteTrailers: [],
    ImageTags: {},
    BackdropImageTags: [],
    LockedFields: [],
    LockData: false,
    UserData: defaultUserData(id),
  };
}

export function buildView(
  ctx: ItemBuildContext,
  catalog: Catalog,
  collectionType?: CollectionType
): JellyfinItem {
  const id = viewId(catalog.type, catalog.id);
  const item = baseItem(ctx, id, catalog.name, 'CollectionFolder', true);
  return {
    ...item,
    ...(collectionType ? { CollectionType: collectionType } : {}),
    DisplayPreferencesId: id,
    ChildCount: 0,
    Path: `/aiostreams/${catalog.type}/${catalog.id}`,
    PrimaryImageAspectRatio: 1.7777,
    _aio: { descriptor: { k: 'view', t: catalog.type, c: catalog.id } },
  };
}

export function buildGenre(
  ctx: ItemBuildContext,
  type: string,
  catalogId: string,
  genre: string
): JellyfinItem {
  const id = genreId(type, catalogId, genre);
  return {
    ...baseItem(ctx, id, genre, 'Genre', true),
    _aio: { descriptor: { k: 'genre', t: type, c: catalogId, g: genre } },
  };
}

export function buildPerson(
  ctx: ItemBuildContext,
  name: string,
  photo?: string
): JellyfinItem {
  const id = personId(name);
  const item = baseItem(ctx, id, name, 'Person', false);
  if (photo) {
    item.ImageTags = imageTagsFor({ Primary: photo }).ImageTags;
    rememberImages(id, { Primary: photo });
    item.PrimaryImageAspectRatio = 0.6666;
  }
  return { ...item, _aio: { descriptor: { k: 'person', n: name } } };
}

export interface ContentBuildOptions {
  parentId?: string;
  playstate?: WatchStateRow;
  /** Emit as a BoxSet root instead of a Movie (movie-type meta with videos). */
  boxset?: boolean;
  childCount?: number;
  /** Which catalog's genre ids to point genre chips at. */
  genreCatalog?: { type: string; id: string };
}

export function contentDescriptor(
  meta: { id: string; type: string },
  boxset = false
): ContentDescriptor {
  if (boxset) return { k: 'boxset', t: meta.type, i: meta.id };
  return meta.type === 'movie'
    ? { k: 'movie', t: meta.type, i: meta.id }
    : { k: 'series', t: meta.type, i: meta.id };
}

/** The `Type` a catalog entry carries as a list item. */
export function contentItemType(
  type: string,
  boxset = false
): 'Movie' | 'Series' | 'BoxSet' {
  if (boxset) return 'BoxSet';
  return type === 'movie' ? 'Movie' : 'Series';
}

/**
 * Extension for a playable item's synthetic path.
 */
const PLAYABLE_EXT = '.mkv';

/** Movie, Series or BoxSet root from a catalog entry or a full meta. */
export function buildContentItem(
  ctx: ItemBuildContext,
  input: MetaPreview | Meta,
  opts: ContentBuildOptions = {}
): JellyfinItem {
  const meta = input as AnyMeta;
  const descriptor = contentDescriptor(
    { id: meta.id, type: meta.type },
    opts.boxset
  );
  const id = encodeItemId(descriptor);
  const enrichment = readEnrichment(input);
  const jellyfinType = contentItemType(meta.type, descriptor.k === 'boxset');
  const folder = jellyfinType !== 'Movie';
  const name = (meta.name as string | undefined) ?? meta.id;
  const genres = genresFrom(input);
  const providerIds = providerIdsFor(
    { id: meta.id, type: meta.type },
    enrichment
  );
  const runtimeMs = enrichment.runtimeMs ?? parseRuntimeMs(meta.runtime);
  const premiere = enrichment.premiere ?? toIso(meta.released);
  const year = enrichment.year ?? parseYear(meta.releaseInfo);

  const images: ItemImages = {};
  if (typeof meta.poster === 'string') images.Primary = meta.poster;
  if (typeof meta.background === 'string') images.Backdrop = meta.background;
  if (enrichment.logo) images.Logo = enrichment.logo;
  if (enrichment.thumb) images.Thumb = enrichment.thumb;
  rememberImages(id, images);

  const genreCatalog = opts.genreCatalog;
  const item: JellyfinItem = {
    ...baseItem(ctx, id, name, jellyfinType, folder),
    OriginalTitle: name,
    MediaType: jellyfinType === 'Movie' ? 'Video' : undefined,
    DateCreated: premiere ?? EPOCH_DATE,
    CanDownload: jellyfinType === 'Movie',
    Overview: (meta.description as string | undefined) ?? undefined,
    ProductionYear: year,
    PremiereDate: premiere,
    EndDate: enrichment.endDate,
    CommunityRating: imdbRatingOf(input),
    OfficialRating: enrichment.certification,
    CustomRating: enrichment.customRating,
    RunTimeTicks: runtimeMs ? runtimeMs * TICKS_PER_MS : undefined,
    Genres: genres,
    GenreItems: genres.map((g) => {
      const target =
        enrichment.genreTargets.get(g) ??
        (genreCatalog
          ? { type: genreCatalog.type, catalogId: genreCatalog.id }
          : undefined);
      return {
        Name: g,
        Id: target
          ? genreId(target.type, target.catalogId, g)
          : genreId(meta.type, '', g),
      };
    }),
    People: enrichment.people.map((p) => {
      const pid = personId(p.name);
      if (p.photo) rememberImages(pid, { Primary: p.photo });
      return {
        Name: p.name,
        Id: pid,
        Type: p.type,
        Role: p.role,
        PrimaryImageTag: p.photo
          ? imageTagsFor({ Primary: p.photo }).ImageTags.Primary
          : undefined,
      };
    }),
    ProviderIds: providerIds,
    ExternalUrls: externalUrls(providerIds),
    RemoteTrailers: enrichment.trailers,
    ...imageTagsFor(images),
    ParentId: opts.parentId,
    PrimaryImageAspectRatio: aspectRatioFor(meta.posterShape),
    VideoType: jellyfinType === 'Movie' ? 'VideoFile' : undefined,
    Status: jellyfinType === 'Series' ? enrichment.status : undefined,
    ChildCount: folder ? opts.childCount : undefined,
    RecursiveItemCount: folder ? opts.childCount : undefined,
    UserData: userDataFromRow(id, opts.playstate, runtimeMs),
    Path: `/aiostreams/${meta.type}/${meta.id}/${name}${folder ? '' : PLAYABLE_EXT}`,
    ProductionLocations: enrichment.country ? [enrichment.country] : [],
    _aio: { descriptor, enrichment },
  };
  if (typeof meta.language === 'string')
    item.PreferredMetadataLanguage = meta.language;
  if (typeof meta.website === 'string') item.HomePageUrl = meta.website;
  if (jellyfinType === 'Movie' && ctx.listVersions) {
    item.EnableMediaSourceDisplay = true;
    item.MediaSources = listPlaceholderSources(
      id,
      resolveMarkerId(ctx.uuid, id),
      name,
      item.Path as string
    );
  }
  return item;
}

export interface SeasonGroup {
  season: number;
  name: string;
  videos: NonNullable<ParsedMeta['videos']>;
}

/** Groups `videos[]` by season; unnumbered videos become episode 1..n of season 1. */
export function groupSeasons(meta: ParsedMeta): SeasonGroup[] {
  const videos = [...(meta.videos ?? [])];
  const groups = new Map<number, SeasonGroup>();
  const numbered = videos.some((v) => typeof v.episode === 'number');
  videos.forEach((v, idx) => {
    const season = typeof v.season === 'number' ? v.season : 1;
    const episode =
      typeof v.episode === 'number' && numbered ? v.episode : idx + 1;
    const copy = { ...v, season, episode };
    let g = groups.get(season);
    if (!g) {
      g = {
        season,
        name: season === 0 ? 'Specials' : `Season ${season}`,
        videos: [],
      };
      groups.set(season, g);
    }
    g.videos.push(copy);
  });
  for (const g of groups.values())
    g.videos.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  return [...groups.values()].sort((a, b) => {
    if (a.season === 0) return 1;
    if (b.season === 0) return -1;
    return a.season - b.season;
  });
}

export function episodeDescriptor(
  meta: ParsedMeta,
  group: SeasonGroup,
  video: SeasonGroup['videos'][number]
): ContentDescriptor {
  return {
    k: 'episode',
    t: meta.type,
    i: meta.id,
    s: group.season,
    e: video.episode ?? 0,
    v: video.id,
  };
}

export function buildSeason(
  ctx: ItemBuildContext,
  meta: ParsedMeta,
  seriesItem: JellyfinItem,
  group: SeasonGroup,
  playstates?: Map<string, WatchStateRow>,
  episodeKeyOf?: (video: SeasonGroup['videos'][number]) => string
): JellyfinItem {
  const id = encodeItemId({
    k: 'season',
    t: meta.type,
    i: meta.id,
    s: group.season,
  });
  const enrichment = (seriesItem as { _aio?: { enrichment?: Enrichment } })._aio
    ?.enrichment;
  const images: ItemImages = {};
  const seasonPoster = enrichment?.seasonPosters?.[group.season] ?? undefined;
  if (seasonPoster) images.Primary = seasonPoster;
  else if (typeof meta.poster === 'string') images.Primary = meta.poster;
  if (typeof meta.background === 'string') images.Backdrop = meta.background;
  rememberImages(id, images);

  let played = 0;
  let unplayedCount = 0;
  for (const v of group.videos) {
    const row =
      playstates && episodeKeyOf ? playstates.get(episodeKeyOf(v)) : undefined;
    if (row?.played) played++;
    else unplayedCount++;
  }
  const total = group.videos.length;
  const seriesTags = seriesItem.ImageTags as Record<string, string>;
  return {
    ...baseItem(ctx, id, group.name, 'Season', true),
    SortName: String(group.season).padStart(4, '0'),
    IndexNumber: group.season,
    SeriesId: seriesItem.Id,
    SeriesName: seriesItem.Name,
    ParentId: seriesItem.Id,
    ChildCount: total,
    RecursiveItemCount: total,
    ...imageTagsFor(images),
    ParentBackdropItemId: images.Backdrop ? seriesItem.Id : undefined,
    ParentBackdropImageTags: seriesItem.BackdropImageTags,
    SeriesPrimaryImageTag: seriesTags?.Primary,
    ParentLogoItemId: seriesTags?.Logo ? seriesItem.Id : undefined,
    ParentLogoImageTag: seriesTags?.Logo,
    PrimaryImageAspectRatio: 0.6666,
    ProductionYear: seriesItem.ProductionYear,
    UserData: {
      ...defaultUserData(id),
      Played: total > 0 && played >= total,
      UnplayedItemCount: unplayedCount,
      PlayedPercentage: total > 0 ? (played / total) * 100 : 0,
    },
    Path: `/aiostreams/${meta.type}/${meta.id}/${group.name}`,
    _aio: {
      descriptor: { k: 'season', t: meta.type, i: meta.id, s: group.season },
    },
  };
}

export function buildEpisode(
  ctx: ItemBuildContext,
  meta: ParsedMeta,
  seriesItem: JellyfinItem,
  group: SeasonGroup,
  video: SeasonGroup['videos'][number],
  playstate?: WatchStateRow
): JellyfinItem {
  const descriptor = episodeDescriptor(meta, group, video);
  const id = encodeItemId(descriptor);
  const seasonId = encodeItemId({
    k: 'season',
    t: meta.type,
    i: meta.id,
    s: group.season,
  });
  const v = video as typeof video & Record<string, unknown>;
  const images: ItemImages = {};
  if (typeof video.thumbnail === 'string') images.Primary = video.thumbnail;
  if (typeof meta.background === 'string') images.Backdrop = meta.background;
  rememberImages(id, images);

  const runtimeMs = parseRuntimeMs(v.runtime) ?? parseRuntimeMs(meta.runtime);
  const premiere = toIso(video.released);
  const unaired =
    v.available === false ||
    (premiere ? new Date(premiere).getTime() > Date.now() : false);
  const title = video.title ?? video.name ?? `Episode ${video.episode}`;
  const path = `/aiostreams/${meta.type}/${meta.id}/${group.name}/${title}${PLAYABLE_EXT}`;
  const seriesTags = seriesItem.ImageTags as Record<string, string>;
  return {
    ...baseItem(ctx, id, title, 'Episode', false),
    SortName: `${String(group.season).padStart(4, '0')}-${String(video.episode ?? 0).padStart(4, '0')}`,
    MediaType: 'Video',
    VideoType: 'VideoFile',
    LocationType: unaired ? 'Virtual' : 'FileSystem',
    CanDownload: !unaired,
    IndexNumber: video.episode,
    ParentIndexNumber: group.season,
    SeriesId: seriesItem.Id,
    SeriesName: seriesItem.Name,
    SeasonId: seasonId,
    SeasonName: group.name,
    ParentId: seasonId,
    Overview: video.overview ?? undefined,
    PremiereDate: premiere,
    DateCreated: premiere ?? EPOCH_DATE,
    ProductionYear: premiere
      ? new Date(premiere).getUTCFullYear()
      : seriesItem.ProductionYear,
    RunTimeTicks: runtimeMs ? runtimeMs * TICKS_PER_MS : undefined,
    ...imageTagsFor({ Primary: images.Primary }),
    ParentBackdropItemId: images.Backdrop ? seriesItem.Id : undefined,
    ParentBackdropImageTags: seriesItem.BackdropImageTags,
    SeriesPrimaryImageTag: seriesTags?.Primary,
    ParentLogoItemId: seriesTags?.Logo ? seriesItem.Id : undefined,
    ParentLogoImageTag: seriesTags?.Logo,
    ParentThumbItemId: seriesTags?.Thumb ? seriesItem.Id : undefined,
    ParentThumbImageTag: seriesTags?.Thumb,
    PrimaryImageAspectRatio: 1.7777,
    Genres: seriesItem.Genres,
    GenreItems: seriesItem.GenreItems,
    CommunityRating: seriesItem.CommunityRating,
    OfficialRating: seriesItem.OfficialRating,
    UserData: userDataFromRow(id, playstate, runtimeMs),
    Path: path,
    ...(unaired || !ctx.listVersions
      ? {}
      : {
          EnableMediaSourceDisplay: true,
          MediaSources: listPlaceholderSources(
            id,
            resolveMarkerId(ctx.uuid, id),
            title,
            path
          ),
        }),
    _aio: { descriptor },
  };
}

/** A movie inside a collection (movie-type meta with `videos`). */
export function buildBoxSetChild(
  ctx: ItemBuildContext,
  boxset: JellyfinItem,
  meta: ParsedMeta,
  video: NonNullable<ParsedMeta['videos']>[number],
  index: number,
  playstate?: WatchStateRow
): JellyfinItem {
  const descriptor: ContentDescriptor = {
    k: 'movie',
    t: meta.type,
    i: video.id,
    p: meta.id,
  };
  const id = encodeItemId(descriptor);
  const v = video as typeof video & Record<string, unknown>;
  const images: ItemImages = {};
  if (typeof video.thumbnail === 'string') images.Primary = video.thumbnail;
  rememberImages(id, images);
  const title = video.title ?? video.name ?? `Part ${index + 1}`;
  const premiere = toIso(video.released);
  const runtimeMs = parseRuntimeMs(v.runtime);
  const providerIds = providerIdsFor({ id: video.id, type: meta.type });
  const path = `/aiostreams/${meta.type}/${video.id}/${title}${PLAYABLE_EXT}`;
  return {
    ...baseItem(ctx, id, title, 'Movie', false),
    MediaType: 'Video',
    VideoType: 'VideoFile',
    CanDownload: true,
    IndexNumber: index + 1,
    ParentId: boxset.Id,
    Overview: video.overview ?? undefined,
    PremiereDate: premiere,
    DateCreated: premiere ?? EPOCH_DATE,
    ProductionYear: premiere ? new Date(premiere).getUTCFullYear() : undefined,
    RunTimeTicks: runtimeMs ? runtimeMs * TICKS_PER_MS : undefined,
    ProviderIds: providerIds,
    ExternalUrls: externalUrls(providerIds),
    ...imageTagsFor(images),
    PrimaryImageAspectRatio: images.Primary ? 1.7777 : 0.6666,
    Genres: boxset.Genres,
    GenreItems: boxset.GenreItems,
    UserData: userDataFromRow(id, playstate, runtimeMs),
    Path: path,
    ...(ctx.listVersions
      ? {
          EnableMediaSourceDisplay: true,
          MediaSources: listPlaceholderSources(
            id,
            resolveMarkerId(ctx.uuid, id),
            title,
            path
          ),
        }
      : {}),
    _aio: { descriptor },
  };
}
