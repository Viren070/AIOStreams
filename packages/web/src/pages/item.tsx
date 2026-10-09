import React from 'react';
import {
  BiCalendarAlt,
  BiCheck,
  BiChevronRight,
  BiDislike,
  BiHeart,
  BiMoviePlay,
  BiPlay,
  BiRevision,
  BiSolidDislike,
  BiSolidHeart,
  BiSolidStar,
} from 'react-icons/bi';
import { Badge } from '@aiostreams/ui/badge';
import { Button, IconButton } from '@aiostreams/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  useCarousel,
} from '@aiostreams/ui/carousel';
import { Modal } from '@aiostreams/ui/modal';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { currentHost } from '../lib/hosts';
import { useSession } from '../lib/session';
import { useFeature } from '../lib/server-info';
import {
  useEpisodes,
  useItem,
  useItemPages,
  useNextUpFor,
  useSeasons,
  useSetDropped,
  useSetFavorite,
  useSetPlayed,
  useSimilar,
} from '../lib/queries';
import {
  backdropUrls,
  cardShape,
  landscapeUrls,
  logoUrl,
  posterUrl,
} from '../lib/images';
import {
  clock,
  dayLabel,
  duration,
  episodeCode,
  itemSubtitle,
  ticksToMs,
  unavailableLabel,
  untilLabel,
} from '../lib/format';
import { href, itemPath, navigate, to } from '../lib/paths';
import { settings, useSetting } from '../lib/settings';
import { useInView } from '../lib/use-in-view';
import { MediaRow } from '../components/media-row';
import { PageMessage } from '../components/layout';
import { MixedGrid } from '../components/mixed-grid';
import { FocusRing, PosterCard } from '../components/cards';
import { Overview } from '../components/overview';
import {
  EpisodeCard,
  EpisodeList,
  EpisodeListSkeleton,
  upToIndex,
} from '../components/episodes';
import { ItemMenu } from '../components/item-menu';
import { RatingButton } from '../components/rating';
import { ExternalLinks } from '../components/external-links';
import { CastAndCrew } from '../components/people';
import { KINDS, KindTabs } from '../components/kind-tabs';
import { PickOnArrival, useVersionPicker } from '../components/version-picker';
import { BackdropFrame } from '../components/hero';
import type { BaseItemDto } from '../lib/types';
import { useHold } from '../lib/use-hold';
import { useExternalReturn } from '../lib/playback/external-return';
import { CachedImage } from '../components/cached-image';
import {
  DownloadButton,
  ShowDownloadMenu,
} from '../components/download-button';

export function ItemPage({
  itemId,
  seasonId,
  episodeId,
  pickId,
}: {
  itemId: string;
  seasonId?: string;
  episodeId?: string;
  /** Opens this item's version list as the page arrives. */
  pickId?: string;
}) {
  const { client } = useSession();
  const item = useItem(itemId);
  const data = item.data;
  const [season, setSeason] = React.useState<BaseItemDto>();
  useExternalReturn();

  React.useEffect(() => {
    if (data?.Type === 'Episode' && data.SeriesId) {
      navigate(itemPath(data), { replace: true });
    }
  }, [data]);

  if (item.isError) {
    return (
      <PageMessage>
        <LuffyError title="Could not load this title" className="mt-0" />
      </PageMessage>
    );
  }

  return (
    <div
      data-ui="item-page"
      data-type={data?.Type}
      data-watched={data?.UserData?.Played || undefined}
      data-favourite={data?.UserData?.IsFavorite || undefined}
      className="relative"
    >
      {pickId && <PickOnArrival itemId={pickId} />}
      <Backdrop
        images={data ? backdropUrls(client, data, { maxWidth: 1920 }) : []}
        poster={data ? posterUrl(client, data, { maxWidth: 160 }) : null}
      />
      <div
        data-ui="item-body"
        className="relative z-[1] space-y-12 px-4 pb-16 pt-[38vh] lg:pl-0 lg:pr-10 lg:pt-[26vh]"
      >
        {!data || data.Type === 'Episode' ? (
          <HeaderSkeleton />
        ) : (
          <>
            <Header item={data} season={season} />
            {data.Type === 'Series' && (
              <Seasons
                series={data}
                initialSeasonId={seasonId}
                focusEpisodeId={episodeId}
                onSeason={setSeason}
              />
            )}
            {data.Type === 'BoxSet' && <SubCollections parent={data} />}
            {data.Type === 'BoxSet' && <Members parent={data} />}
            <CastAndCrew people={data.People} />
            <Details item={data} />
            {(data.Type === 'Movie' || data.Type === 'Series') && (
              <Similar itemId={data.Id!} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Past the landscape art, the poster stands in as a blurred wash of its colours. */
function Backdrop({
  images,
  poster,
}: {
  images: string[];
  poster: string | null;
}) {
  const sources = poster ? [...images, poster] : images;
  const key = sources.join('|');
  const [attempt, setAttempt] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    setAttempt(0);
    setLoaded(false);
  }, [key]);
  const src = sources[attempt];
  const wash = attempt >= images.length;
  const image = src && (
    <CachedImage
      key={src}
      data-ui="item-backdrop-image"
      data-wash={wash || undefined}
      src={src}
      alt=""
      onLoad={() => setLoaded(true)}
      onError={() => setAttempt((n) => n + 1)}
      className={cn(
        'absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
        wash ? 'scale-125 blur-3xl saturate-150' : 'object-top',
        !loaded ? 'opacity-0' : wash ? 'opacity-50' : 'opacity-100'
      )}
    />
  );
  return (
    <div
      aria-hidden
      data-ui="item-backdrop"
      // Fades out at its edge, where some GPUs draw the art's last row past the shade.
      className="pointer-events-none absolute inset-x-0 top-[calc(var(--top-bar,0px)*-1)] h-[calc(55vh+var(--top-bar,0px))] overflow-hidden [mask-image:linear-gradient(to_top,transparent,black_2px)] lg:h-[calc(85vh+var(--top-bar,0px))]"
    >
      {wash ? (
        image
      ) : (
        <BackdropFrame className="max-w-[calc(55vh*2.6)] lg:max-w-[calc(85vh*2.6)]">
          {image}
        </BackdropFrame>
      )}
      <div
        data-ui="item-backdrop-shade"
        data-name="side"
        className="absolute inset-0 hidden bg-gradient-to-r from-[--background] via-[--background]/60 via-40% to-transparent lg:block"
      />
      <div
        data-ui="item-backdrop-shade"
        data-name="bottom"
        className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-[--background] via-[--background]/70 to-transparent"
      />
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-end gap-8">
      <Skeleton className="hidden aspect-[2/3] h-auto w-56 rounded-xl md:block" />
      <div className="flex-1 space-y-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-20 w-full max-w-2xl" />
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span data-ui="meta-separator" className="text-gray-500">
      •
    </span>
  );
}

function MetaRow({ item }: { item: BaseItemDto }) {
  const parts: [string, React.ReactNode][] = [];
  const start = item.ProductionYear;
  const end = item.EndDate ? new Date(item.EndDate).getFullYear() : null;
  if (item.Type === 'Series' && start) {
    parts.push([
      'year',
      item.Status === 'Continuing'
        ? `${start}–`
        : end && end !== start
          ? `${start}–${end}`
          : start,
    ]);
  } else if (start) parts.push(['year', start]);
  if (item.OfficialRating) {
    parts.push([
      'age-rating',
      <span className="rounded border border-white/30 px-1.5 py-px text-xs">
        {item.OfficialRating}
      </span>,
    ]);
  }
  const runtime = ticksToMs(item.RunTimeTicks);
  if (runtime && item.Type !== 'Series') {
    parts.push(['runtime', duration(runtime)]);
  }
  if (item.CommunityRating) {
    parts.push([
      'score',
      <span className="inline-flex items-center gap-1">
        <BiSolidStar className="text-yellow-400" />
        {item.CommunityRating.toFixed(1)}
      </span>,
    ]);
  }
  if (item.Type === 'Series' && item.Status) {
    parts.push(['status', item.Status]);
  }
  if (!parts.length) return null;
  return (
    <div
      data-ui="item-meta"
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-gray-200"
    >
      {parts.map(([name, part], i) => (
        <React.Fragment key={name}>
          {i > 0 && <Dot />}
          <span data-name={name}>{part}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

/** The show's links, with the selected season's own in place of the show's. */
function linksFor(item: BaseItemDto, season?: BaseItemDto) {
  const own = season?.ExternalUrls ?? [];
  if (!own.length) return item.ExternalUrls;
  const byName = new Map(own.map((link) => [link.Name, link]));
  const shown = (item.ExternalUrls ?? []).map(
    (link) => byName.get(link.Name) ?? link
  );
  return [...shown, ...own.filter((link) => !shown.includes(link))];
}

function Header({ item, season }: { item: BaseItemDto; season?: BaseItemDto }) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const setPlayed = useSetPlayed();
  const setFavorite = useSetFavorite();
  const setDropped = useSetDropped();
  const nextUp = useNextUpFor(item.Id!, item.Type === 'Series');
  const logo = logoUrl(client, item, { maxWidth: 416 });
  const [logoFailed, setLogoFailed] = React.useState(false);
  const poster = posterUrl(client, item, { maxWidth: 320 });
  const played = !!item.UserData?.Played;
  const favorite = !!item.UserData?.IsFavorite;
  const dropped = item.UserData?.Likes === false;
  const canDrop = useFeature('dropped');
  const links = linksFor(item, season);
  const trailer = item.RemoteTrailers?.[0]?.Url;

  const target =
    item.Type === 'Series'
      ? nextUp.data?.Items?.[0]
      : item.Type === 'Movie'
        ? item
        : undefined;
  const resumeMs = ticksToMs(target?.UserData?.PlaybackPositionTicks);
  const code =
    target?.Type === 'Episode'
      ? episodeCode(target.ParentIndexNumber, target.IndexNumber)
      : '';
  const playLabel = resumeMs
    ? `Resume${code ? ` ${code}` : ` from ${clock(resumeMs)}`}`
    : `Play${code ? ` ${code}` : ''}`;
  const holdPlay = useHold(
    target
      ? () => picker.play(target, { startMs: resumeMs, held: true })
      : undefined
  );
  const holdRestart = useHold(
    target ? () => picker.play(target, { startMs: 0, held: true }) : undefined
  );

  return (
    <div
      data-ui="item-header"
      data-nav-top
      className="flex flex-col gap-6 md:flex-row md:items-end md:gap-8"
    >
      {poster && (
        <CachedImage
          data-ui="item-poster"
          src={poster}
          alt=""
          className={cn(
            'hidden flex-none rounded-xl object-cover shadow-2xl ring-1 ring-white/10 md:block',
            cardShape(item) === 'poster'
              ? 'aspect-[2/3] w-48 lg:w-56'
              : 'aspect-video w-80'
          )}
        />
      )}
      <div className="min-w-0 max-w-3xl flex-1 space-y-4">
        {logo && !logoFailed ? (
          <CachedImage
            data-ui="item-logo"
            src={logo}
            alt={item.Name ?? ''}
            onError={() => setLogoFailed(true)}
            className="max-h-24 max-w-[min(26rem,85%)] object-contain object-left lg:max-h-32"
          />
        ) : (
          <h1
            data-ui="item-title"
            className="text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl"
          >
            {item.Name}
          </h1>
        )}
        {item.Taglines?.[0] && (
          <p data-ui="item-tagline" className="text-base italic text-gray-300">
            {item.Taglines[0]}
          </p>
        )}
        <MetaRow item={item} />
        {item.Type === 'Series' && item.Status === 'Continuing' && (
          <NextAiring series={item} />
        )}
        {!!item.Genres?.length && (
          <div data-ui="item-genres" className="flex flex-wrap gap-1.5">
            {item.Genres.map((genre) => (
              <Badge key={genre} data-ui="item-genre" intent="white" size="md">
                {genre}
              </Badge>
            ))}
          </div>
        )}
        <Overview
          title={item.Name ?? ''}
          line={[item.ProductionYear, item.Genres?.slice(0, 3).join(', ')]
            .filter(Boolean)
            .join(' · ')}
          overview={item.Overview}
          image={landscapeUrls(client, item, { maxWidth: 480 })}
          clampClass="max-h-[4lh]"
          className="text-sm leading-relaxed text-gray-300 sm:text-base"
        />
        <div
          data-ui="item-actions"
          className="flex flex-wrap items-center gap-2"
        >
          {target && (
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Button
                data-ui="item-action"
                data-name="play"
                data-nav-start
                intent="white"
                className="flex-1 rounded-full sm:flex-none"
                leftIcon={<BiPlay className="text-xl" />}
                onClick={() => picker.play(target, { startMs: resumeMs })}
                {...holdPlay}
              >
                {playLabel}
              </Button>
              {!!resumeMs && (
                <Tooltip
                  trigger={
                    <IconButton
                      data-ui="item-action"
                      data-name="restart"
                      intent="gray-subtle"
                      className="rounded-full"
                      icon={<BiRevision />}
                      aria-label="Play from the start"
                      onClick={() => picker.play(target, { startMs: 0 })}
                      {...holdRestart}
                    />
                  }
                >
                  Play from the start
                </Tooltip>
              )}
            </div>
          )}
          {trailer && (
            <Button
              data-ui="item-action"
              data-name="trailer"
              intent="gray-outline"
              className="rounded-full"
              leftIcon={<BiMoviePlay className="text-lg" />}
              onClick={() => window.open(trailer, '_blank', 'noopener')}
            >
              Trailer
            </Button>
          )}
          {item.Type !== 'BoxSet' && (
            <Tooltip
              trigger={
                <IconButton
                  data-ui="item-action"
                  data-name="watched"
                  data-active={played || undefined}
                  intent={played ? 'primary-subtle' : 'gray-subtle'}
                  className="rounded-full"
                  icon={<BiCheck />}
                  aria-label={played ? 'Mark unwatched' : 'Mark watched'}
                  loading={setPlayed.isPending}
                  onClick={() =>
                    setPlayed.mutate({ itemId: item.Id!, played: !played })
                  }
                />
              }
            >
              {played ? 'Mark unwatched' : 'Mark watched'}
            </Tooltip>
          )}
          <Tooltip
            trigger={
              <IconButton
                data-ui="item-action"
                data-name="favourite"
                data-active={favorite || undefined}
                intent={favorite ? 'alert-subtle' : 'gray-subtle'}
                className="rounded-full"
                icon={favorite ? <BiSolidHeart /> : <BiHeart />}
                aria-label={favorite ? 'Remove favourite' : 'Add favourite'}
                loading={setFavorite.isPending}
                onClick={() =>
                  setFavorite.mutate({ itemId: item.Id!, favorite: !favorite })
                }
              />
            }
          >
            {favorite ? 'Remove favourite' : 'Add favourite'}
          </Tooltip>
          {canDrop && item.Type === 'Series' && (
            <Tooltip
              trigger={
                <IconButton
                  data-ui="item-action"
                  data-name="drop"
                  data-active={dropped || undefined}
                  intent={dropped ? 'warning-subtle' : 'gray-subtle'}
                  className="rounded-full"
                  icon={dropped ? <BiSolidDislike /> : <BiDislike />}
                  aria-label={dropped ? 'Undrop show' : 'Drop show'}
                  loading={setDropped.isPending}
                  onClick={() =>
                    setDropped.mutate({ itemId: item.Id!, dropped: !dropped })
                  }
                />
              }
            >
              {dropped ? 'Undrop show' : 'Drop show'}
            </Tooltip>
          )}
          {(item.Type === 'Movie' || item.Type === 'Series') && (
            <RatingButton item={item} />
          )}
          {item.Type === 'Movie' && item.LocationType !== 'Virtual' && (
            <DownloadButton item={item} className="size-10 text-lg" />
          )}
          {item.Type === 'Series' && (
            <ShowDownloadMenu series={item} season={season} />
          )}
          {!!links?.length && (
            <span
              data-ui="item-actions-divider"
              className="mx-1 hidden h-6 w-px bg-white/10 sm:block"
              aria-hidden
            />
          )}
          <div className="basis-full sm:basis-auto">
            <ExternalLinks links={links} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The next episode of a show still airing, from its latest season, which is
 * where a metadata addon lists what is scheduled.
 */
function NextAiring({ series }: { series: BaseItemDto }) {
  const seasons = useSeasons(series.Id!, true);
  const latest = React.useMemo(
    () =>
      (seasons.data?.Items ?? [])
        .filter((s) => (s.IndexNumber ?? 0) > 0)
        .sort((a, b) => (b.IndexNumber ?? 0) - (a.IndexNumber ?? 0))[0],
    [seasons.data]
  );
  const episodes = useEpisodes(series.Id!, latest?.Id ?? undefined);
  const next = episodes.data?.Items?.find(
    (e) => e.PremiereDate && Date.parse(e.PremiereDate) > Date.now()
  );
  if (!next?.PremiereDate) return null;
  return (
    <p
      data-ui="item-next-airing"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    >
      <BiCalendarAlt className="text-lg text-[--muted]" />
      <span className="font-semibold">
        {episodeCode(next.ParentIndexNumber, next.IndexNumber)}
      </span>
      <span>airs {untilLabel(next.PremiereDate)}</span>
      <span className="text-[--muted]">{dayLabel(next.PremiereDate)}</span>
    </p>
  );
}

function Section({
  name,
  title,
  action,
  children,
}: {
  name: string;
  /** Left out when the first row carries it. */
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section data-ui="section" data-name={name} className="space-y-4">
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 data-ui="section-title" className="text-xl font-semibold">
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Seasons({
  series,
  initialSeasonId,
  focusEpisodeId,
  onSeason,
}: {
  series: BaseItemDto;
  initialSeasonId?: string;
  focusEpisodeId?: string;
  onSeason: (season: BaseItemDto | undefined) => void;
}) {
  const { client } = useSession();
  const [layoutPref] = useSetting(settings.episodeLayout);
  const wide = useMediaQuery('(min-width: 1024px)');
  const layout = layoutPref === 'auto' ? (wide ? 'row' : 'list') : layoutPref;
  const seasons = useSeasons(series.Id!, true);
  const list = React.useMemo(() => seasons.data?.Items ?? [], [seasons.data]);
  const [chosen, setChosen] = React.useState(initialSeasonId);
  // The first season with something left, skipping specials.
  const fallback = React.useMemo(() => {
    const regular = list.filter((s) => (s.IndexNumber ?? 1) > 0);
    return (regular.find((s) => !s.UserData?.Played) ?? regular[0] ?? list[0])
      ?.Id;
  }, [list]);
  // Waits for the server's answer, so a saved copy of the list doesn't pick it.
  const settled = !seasons.isFetching;
  React.useEffect(() => {
    if (!chosen && settled && fallback) setChosen(fallback);
  }, [chosen, settled, fallback]);
  const seasonId = chosen ?? fallback;
  const pick = (id: string) => {
    setChosen(id);
    navigate(`${to.item(series.Id!)}?season=${id}`, {
      replace: true,
      keepScroll: true,
    });
  };
  const season = list.find((s) => s.Id === seasonId);
  React.useEffect(() => onSeason(season), [season, onSeason]);
  React.useEffect(() => () => onSeason(undefined), [onSeason]);
  // A show of one season is rated as the show, as is any show on a TV.
  const rateSeason =
    !currentHost().tv &&
    list.filter((s) => (s.IndexNumber ?? 0) > 0).length > 1;
  const episodes = useEpisodes(series.Id!, seasonId);
  const items = episodes.data?.Items ?? [];
  const loading = seasons.isLoading || episodes.isLoading;
  const summary = seasonSummary(season, items);
  // Seasons without art of their own carry the show's poster.
  const ownPosters = list.some(
    (s) =>
      s.ImageTags?.Primary && s.ImageTags.Primary !== series.ImageTags?.Primary
  );
  const summaryLine = (summary || (rateSeason && season)) && (
    <p
      data-ui="season-summary"
      className="flex flex-wrap items-center gap-x-2 text-sm text-[--muted]"
    >
      {summary}
      {summary && rateSeason && season && <span aria-hidden>·</span>}
      {rateSeason && season && (
        <RatingButton item={season} label="Rate season" inline />
      )}
    </p>
  );
  const focusIndex = focusEpisodeId
    ? items.findIndex((e) => e.Id === focusEpisodeId)
    : -1;

  const focused = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (episodes.data && focusEpisodeId) {
      focused.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [episodes.data, focusEpisodeId]);

  return (
    <Section name="episodes" title={ownPosters ? undefined : 'Episodes'}>
      {ownPosters ? (
        <MediaRow
          id="seasons"
          title="Episodes"
          shape="poster"
          itemClass="basis-[7rem] sm:basis-[8rem] lg:basis-[8.5rem]"
        >
          {list.map((s) => {
            const selected = s.Id === seasonId;
            const poster = posterUrl(client, s, { maxWidth: 120 });
            return (
              <ItemMenu key={s.Id} item={s} onPage>
                <button
                  type="button"
                  data-ui="season-poster"
                  data-selected={selected || undefined}
                  data-focus="own"
                  onClick={() => pick(s.Id!)}
                  className="group/season w-full space-y-2 text-left"
                >
                  <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-900">
                    {poster && (
                      <CachedImage
                        src={poster}
                        alt=""
                        loading="lazy"
                        className={cn(
                          'absolute inset-0 h-full w-full object-cover transition-opacity',
                          !selected &&
                            'opacity-60 group-hover/season:opacity-100 group-focus-visible/season:opacity-100'
                        )}
                      />
                    )}
                    <FocusRing className="group-focus-visible/season:opacity-100" />
                    {/* Drawn inside, since the row clips anything outside it. */}
                    <span
                      className={cn(
                        'pointer-events-none absolute inset-0 rounded-lg ring-inset',
                        selected ? 'ring-2 ring-white' : 'ring-1 ring-white/10'
                      )}
                    />
                    {s.UserData?.Played && (
                      <span
                        data-ui="watched-badge"
                        className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-brand-500 text-white"
                      >
                        <BiCheck />
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      'truncate text-sm',
                      selected
                        ? 'font-semibold text-white'
                        : 'text-[--muted] group-hover/season:text-white group-focus-visible/season:text-white'
                    )}
                  >
                    {s.Name}
                  </p>
                </button>
              </ItemMenu>
            );
          })}
        </MediaRow>
      ) : (
        <SeasonPills seasons={list} selected={seasonId} onSelect={pick} />
      )}
      {season?.Overview && (
        <p
          data-ui="season-overview"
          className="max-w-3xl select-text text-sm text-gray-300"
        >
          {season.Overview}
        </p>
      )}
      {layout === 'list' && summaryLine}
      {layout === 'row' ? (
        loading ? (
          <MediaRow key="loading" shape="wide" itemClass={ROW_WIDTH} loading />
        ) : (
          <div ref={focusIndex >= 0 ? focused : undefined}>
            <MediaRow
              key={seasonId}
              id={`episodes:${seasonId}`}
              shape="wide"
              itemClass={ROW_WIDTH}
              startIndex={focusIndex >= 0 ? focusIndex : upToIndex(items)}
              header={summaryLine}
              action={
                summary &&
                items.length > 1 && (
                  <AllEpisodes
                    title={season?.Name ?? 'Episodes'}
                    summary={summary}
                    episodes={items}
                  />
                )
              }
            >
              {items.map((episode) => (
                <EpisodeCard
                  key={episode.Id}
                  episode={episode}
                  highlighted={episode.Id === focusEpisodeId}
                />
              ))}
            </MediaRow>
          </div>
        )
      ) : loading ? (
        <EpisodeListSkeleton columns />
      ) : (
        <EpisodeList
          episodes={items}
          highlightId={focusEpisodeId}
          anchorId={focusEpisodeId}
          anchorRef={focused}
          columns
        />
      )}
    </Section>
  );
}

const ROW_WIDTH =
  'basis-[85%] sm:basis-[20rem] lg:basis-[22rem] 2xl:basis-[24rem]';

function SeasonPills({
  seasons,
  selected,
  onSelect,
}: {
  seasons: BaseItemDto[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <Carousel
      gap="sm"
      opts={{ align: 'start', dragFree: true, slidesToScroll: 'auto' }}
      className="flex items-center gap-2"
    >
      <PillArrow
        arrow="prev"
        follow={seasons.findIndex((s) => s.Id === selected)}
      />
      <PillTrack>
        {seasons.map((s) => (
          <CarouselItem key={s.Id} className="basis-auto">
            <ItemMenu item={s} onPage>
              <Button
                data-ui="season-pill"
                data-selected={s.Id === selected || undefined}
                size="sm"
                intent={s.Id === selected ? 'white' : 'gray-subtle'}
                className="rounded-full"
                rightIcon={s.UserData?.Played ? <BiCheck /> : undefined}
                iconSpacing="0.25rem"
                onClick={() => onSelect(s.Id!)}
              >
                {s.Name}
              </Button>
            </ItemMenu>
          </CarouselItem>
        ))}
      </PillTrack>
      <PillArrow arrow="next" />
    </Carousel>
  );
}

/** `follow` scrolls that pill into view when it is out of it. */
function PillArrow({
  arrow,
  follow,
}: {
  arrow: 'prev' | 'next';
  follow?: number;
}) {
  const { api, canScrollPrev, canScrollNext } = useCarousel();
  React.useEffect(() => {
    if (!api || follow == null || follow < 0) return;
    const node = api.slideNodes()[follow];
    if (!node) return;
    const root = api.rootNode().getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    if (rect.left < root.left || rect.right > root.right) {
      api.scrollTo(Math.min(follow, api.scrollSnapList().length - 1));
    }
  }, [api, follow]);
  if (!canScrollPrev && !canScrollNext) return null;
  const Arrow = arrow === 'prev' ? CarouselPrevious : CarouselNext;
  return (
    <Arrow className="hidden flex-none disabled:opacity-30 md:inline-flex" />
  );
}

function PillTrack({ children }: { children: React.ReactNode }) {
  const { canScrollPrev, canScrollNext } = useCarousel();
  return (
    <CarouselContent
      contentClass={cn(
        'min-w-0 flex-1',
        canScrollPrev && canScrollNext
          ? '[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]'
          : canScrollPrev
            ? '[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]'
            : canScrollNext &&
              '[mask-image:linear-gradient(to_left,transparent,black_2.5rem)]'
      )}
    >
      {children}
    </CarouselContent>
  );
}

function AllEpisodes({
  title,
  summary,
  episodes,
}: {
  title: string;
  summary: string;
  episodes: BaseItemDto[];
}) {
  const target = React.useRef<HTMLDivElement>(null);
  return (
    <Modal
      data-ui="dialog"
      data-name="all-episodes"
      trigger={
        <Button
          size="sm"
          intent="gray-outline"
          className="flex-none rounded-full"
          rightIcon={<BiChevronRight />}
          iconSpacing="0.25rem"
        >
          All episodes
        </Button>
      }
      title={title}
      description={summary}
      contentClass="max-w-3xl"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        target.current?.scrollIntoView({ block: 'center' });
      }}
    >
      <EpisodeList
        episodes={episodes}
        anchorId={episodes[upToIndex(episodes)]?.Id}
        anchorRef={target}
      />
    </Modal>
  );
}

function seasonSummary(
  season: BaseItemDto | undefined,
  episodes: BaseItemDto[]
): string | null {
  if (!season || !episodes.length) return null;
  const first = episodes.find((e) => e.PremiereDate)?.PremiereDate;
  // A season without its own year carries the show's.
  const year = first ? new Date(first).getFullYear() : season.ProductionYear;
  const unaired = episodes.filter(
    (e) => unavailableLabel(e) === 'Unaired'
  ).length;
  return [
    year,
    `${episodes.length} episode${episodes.length === 1 ? '' : 's'}`,
    unaired ? `${unaired} unaired` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Collections inside this one, which the members' kind filter leaves out. */
function SubCollections({ parent }: { parent: BaseItemDto }) {
  const { client } = useSession();
  const pages = useItemPages(parent.Id!, { types: 'BoxSet' });
  const all = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  // Some servers ignore the filter here, listing sub-collections first.
  const items = all.filter((i) => i.Type === 'BoxSet');
  const filtered = items.length === all.length;
  const landscape =
    items.length > 0 &&
    items.filter((i) => cardShape(i) === 'landscape').length > items.length / 2;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const more = React.useCallback(() => {
    if (filtered && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [filtered, hasNextPage, isFetchingNextPage, fetchNextPage]);
  if (!items.length) return null;
  return (
    <MediaRow
      id="sub-collections"
      title="Collections"
      shape={landscape ? 'wide' : 'poster'}
      loadingMore={isFetchingNextPage}
      onEndReached={more}
    >
      {items.map((item) => (
        <ItemMenu key={item.Id} item={item}>
          <PosterCard
            href={href(itemPath(item))}
            shape={landscape ? 'landscape' : cardShape(item)}
            image={(width) => posterUrl(client, item, { maxWidth: width })}
            title={item.Name ?? ''}
            subtitle={itemSubtitle(item)}
            watched={item.UserData?.Played}
          />
        </ItemMenu>
      ))}
    </MediaRow>
  );
}

/** A collection's members, paged like a library. */
function Members({ parent }: { parent: BaseItemDto }) {
  const { client } = useSession();
  const [types, setTypes] = React.useState(KINDS[0].types);
  const pages = useItemPages(parent.Id!, { types });
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  // Keyed on pages: a page can be all of one kind and none of it kept here.
  const sentinel = useInView<HTMLDivElement>(
    () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    },
    '800px',
    [pages.data?.pages.length, types]
  );
  return (
    <Section
      name="collection"
      title="In this collection"
      action={<KindTabs types={types} onChange={setTypes} />}
    >
      <MixedGrid items={items} client={client} loading={pages.isLoading} />
      {!pages.isLoading && !items.length && (
        <p className="text-[--muted]">Nothing here.</p>
      )}
      {pages.isFetchingNextPage && (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}
      <div ref={sentinel} />
    </Section>
  );
}

function Details({ item }: { item: BaseItemDto }) {
  const airs = item.AirDays?.length
    ? `${item.AirDays.map((d) => `${d}s`).join(', ')}${
        item.AirTime ? ` at ${item.AirTime}` : ''
      }`
    : null;
  const released = item.PremiereDate
    ? new Date(item.PremiereDate).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;
  const rows: [string, React.ReactNode][] = (
    [
      ['Studios', item.Studios?.map((s) => s.Name).join(', ')],
      [item.Type === 'Series' ? 'First aired' : 'Released', released],
      [
        'Airs',
        item.Type === 'Series' && item.Status === 'Continuing' ? airs : null,
      ],
      ['Country', item.ProductionLocations?.join(', ')],
    ] as [string, React.ReactNode][]
  ).filter(([, value]) => !!value);
  if (!rows.length) return null;
  return (
    <Section name="details" title="Details">
      <dl
        data-ui="item-details"
        className="grid max-w-5xl grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-[--muted]">
              {label}
            </dt>
            <dd className="mt-1 text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/** Loaded once scrolled near, since it reads a catalog. */
function Similar({ itemId }: { itemId: string }) {
  const { client } = useSession();
  const [near, setNear] = React.useState(false);
  const ref = useInView<HTMLDivElement>(() => setNear(true), '400px');
  const similar = useSimilar(itemId, near);
  return (
    <div
      ref={ref}
      hidden={!!similar.data && !similar.data.Items?.length}
      className="min-h-[2rem]"
    >
      {near && (
        <MediaRow
          id="similar"
          title="More like this"
          shape="poster"
          loading={similar.isLoading}
        >
          {similar.data?.Items?.map((item) => (
            <ItemMenu key={item.Id} item={item}>
              <PosterCard
                href={href(itemPath(item))}
                image={(width) => posterUrl(client, item, { maxWidth: width })}
                title={item.Name ?? ''}
                subtitle={itemSubtitle(item)}
                watched={item.UserData?.Played}
              />
            </ItemMenu>
          ))}
        </MediaRow>
      )}
    </div>
  );
}
