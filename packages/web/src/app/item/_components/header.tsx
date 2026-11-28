import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiCalendarAlt, BiDotsHorizontalRounded } from 'react-icons/bi';
import { IoPlay } from 'react-icons/io5';
import { LuRotateCcw } from 'react-icons/lu';
import { Badge } from '@aiostreams/ui/badge';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Drawer } from '@aiostreams/ui/drawer';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { currentHost } from '@/lib/hosts';
import { settings, useSetting } from '@/lib/settings';
import { useSession } from '@/lib/jellyfin/session';
import {
  useEpisodes,
  useNextUpFor,
  useFetchNextUp,
  useSeasons,
} from '@/lib/jellyfin/queries';
import { offersFavourite } from '@/lib/jellyfin/watch-state';
import {
  cardShape,
  landscapeUrls,
  logoUrl,
  posterUrl,
} from '@/lib/artwork/urls';
import {
  clock,
  dayLabel,
  duration,
  episodeCode,
  ticksToMs,
  untilLabel,
  progressOf,
} from '@/lib/format';
import { Overview } from '@/components/media/overview';
import { episodeLine, seasonEpisodeTitle } from '@/components/media/episodes';
import { TitleAbout } from './about';
import { PlayProgress } from '@/components/media/play-progress';
import { ScoreRefresh, Scores, scoresOf } from '@/components/media/scores';
import { SeasonCount } from '@/components/media/season-count';
import { ExternalLinks } from '@/components/media/external-links';
import {
  usePreloadVersions,
  useVersionPicker,
} from '@/features/versions/version-picker';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { useHold } from '@/hooks/use-hold';
import { focusDialog, useDialogStart } from '@/lib/input';
import { CachedImage } from '@/components/cached-image';
import { trailersOf } from '@/lib/playback/trailers';
import {
  Captioned,
  QuickShown,
  SecondaryActions,
  useQuickActions,
} from './actions';

/** The longest a title's header waits for its pictures before showing anyway. */
const REVEAL_WAIT_MS = 2500;

/** Whether a title's page shows its poster, by the setting. */
export function useTitlePoster(): boolean {
  const [shown] = useSetting(settings.interface.titlePoster);
  return shown === 'show' || (shown === 'auto' && !currentHost().tv);
}

export function HeaderSkeleton() {
  const posterShown = useTitlePoster();
  return (
    <div className="flex items-end gap-8">
      {posterShown && (
        <Skeleton className="hidden aspect-[2/3] h-auto w-56 rounded-xl md:block" />
      )}
      <div className="flex-1 space-y-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-20 w-full max-w-2xl" />
      </div>
    </div>
  );
}

function Dot() {
  // No dot after a part that came to nothing.
  return (
    <span data-ui="meta-separator" className="text-gray-500 [:empty+&]:hidden">
      •
    </span>
  );
}

const MetaRow = React.memo(function MetaRow({
  item,
  refreshing = false,
}: {
  item: BaseItemDto;
  /** Fresh details on their way, whose scores may differ. */
  refreshing?: boolean;
}) {
  const parts: [string, React.ReactNode][] = [];
  const start = item.ProductionYear;
  // A show says how many seasons it has, not the years it ran.
  if (item.Type === 'Series')
    parts.push(['seasons', <SeasonCount series={item} />]);
  else if (start) parts.push(['year', start]);
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
  // The light under them shows fresh ones on their way; it takes no room.
  if (scoresOf(item).length)
    parts.push([
      'score',
      <ScoreRefresh active={refreshing}>
        <Scores item={item} emphasis />
      </ScoreRefresh>,
    ]);
  if (item.Type === 'Series' && item.Status) {
    parts.push(['status', item.Status]);
  }
  if (!parts.length) return null;
  return (
    <div
      data-ui="item-meta"
      // One height whether or not its badges or scores have come.
      className="flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-gray-200 max-sm:justify-center"
    >
      {parts.map(([name, part], i) => (
        <React.Fragment key={name}>
          {i > 0 && <Dot />}
          {/* A show of only specials counts no seasons, so its part goes. */}
          <span data-name={name} className="empty:hidden">
            {part}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
});

/** The episode a show goes on with: its number, title and overview. */
function NextEpisode({
  episode,
  onPress,
}: {
  episode: BaseItemDto;
  /** Opens all about the episode, as a title's overview opens all about it. */
  onPress: () => void;
}) {
  const { client } = useSession();
  return (
    <div data-ui="item-next-episode" className="space-y-1.5">
      <p className="flex flex-wrap items-center gap-x-2 text-base font-semibold text-white max-sm:justify-center">
        <span>
          {episodeCode(episode.ParentIndexNumber, episode.IndexNumber)}
        </span>
        {episode.Name && (
          <>
            <Dot />
            <span>{episode.Name}</span>
          </>
        )}
      </p>
      {/* As the show's own overview, so a long one still opens in full. */}
      <Overview
        title={seasonEpisodeTitle(episode)}
        line={episodeLine(episode)}
        overview={episode.Overview}
        image={landscapeUrls(client, episode, { maxWidth: 480 })}
        clampClass="max-h-[4lh]"
        onPress={onPress}
        className="max-w-2xl text-sm leading-relaxed text-gray-300 sm:text-base [[data-tv]_&]:max-w-[50vw] [[data-tv]_&]:text-base"
      />
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

export function Header({
  item,
  season,
  hero,
  pending = false,
  refreshing = false,
}: {
  item: BaseItemDto;
  season?: BaseItemDto;
  /** The page has art across its top. */
  hero: boolean;
  /** Only what a list knew so far; parts still to come keep their place. */
  pending?: boolean;
  /** Its details are being fetched afresh. */
  refreshing?: boolean;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const nextUp = useNextUpFor(item.Id!, item.Type === 'Series');
  const fetchNextUp = useFetchNextUp();
  // Play holds its place, and focus, while a show's next episode is on its way.
  const nextUpPending = item.Type === 'Series' && nextUp.isPending;
  // A still-airing show's next episode, asked for while the page holds its
  // places (when its status isn't known yet too), and waited for with the rest.
  const continuing = item.Type === 'Series' && item.Status === 'Continuing';
  const airing = useNextAiring(
    item,
    item.Type === 'Series' && (pending || continuing)
  );
  const [late, setLate] = React.useState(false);
  // Counted once its details are in, so a slow server doesn't use it up; a
  // slow schedule doesn't hold the header past it either.
  React.useEffect(() => {
    if (pending) return;
    const timer = setTimeout(() => setLate(true), REVEAL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  const holding = pending || (continuing && airing.loading && !late);
  const logo = logoUrl(client, item, { maxWidth: 416 });
  const cover = posterUrl(client, item, { maxWidth: 320 });
  const poster = useTitlePoster() ? cover : null;
  // By address, so a different logo in the full details still gets its try.
  const [failedLogo, setFailedLogo] = React.useState<string>();
  const logoFailed = !!logo && failedLogo === logo;
  const [about, setAbout] = React.useState(false);
  const [aboutEpisode, setAboutEpisode] = React.useState(false);
  // Pictures in, by address; the header waits for them, but not for long.
  const [loaded, setLoaded] = React.useState<ReadonlySet<string>>(new Set());
  const settle = (src: string) => () =>
    setLoaded((set) => (set.has(src) ? set : new Set(set).add(src)));
  // One decoded ahead draws as it's placed, so the header shows in that frame.
  const drawn = (src: string) => (el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth) settle(src)();
  };
  const collection = item.Type === 'BoxSet';
  // A collection's cover by its name isn't the poster the setting leaves off.
  const badge = collection && !hero && !(logo && !logoFailed) ? cover : null;
  // A collection has no poster here, and its badge can come once the header
  // has shown, when the art across the page fails, so neither is waited for.
  const pictured =
    (!poster || collection || loaded.has(poster)) &&
    (!logo || logoFailed || loaded.has(logo));
  // A show's next episode decides what its overview tells of, so it's waited
  // for like the pictures.
  const ready = !holding && ((pictured && !nextUpPending) || late);
  const name =
    logo && !logoFailed ? (
      <CachedImage
        key={logo}
        data-ui="item-logo"
        src={logo}
        alt={item.Name ?? ''}
        ref={drawn(logo)}
        onLoad={settle(logo)}
        onError={() => setFailedLogo(logo)}
        className="max-h-24 max-w-[min(26rem,85%)] object-contain object-left max-sm:mx-auto max-sm:object-center lg:max-h-32"
      />
    ) : pending ? (
      // A list may know no logo its own details have, so the name waits.
      <Skeleton
        data-ui="item-logo-placeholder"
        className="h-20 w-80 max-w-full max-sm:mx-auto lg:h-28"
      />
    ) : (
      <h1
        data-ui="item-title"
        className="text-3xl font-bold leading-tight max-sm:text-center sm:text-4xl lg:text-5xl"
      >
        {item.Name}
      </h1>
    );
  const links = React.useMemo(() => linksFor(item, season), [item, season]);
  const overviewImage = React.useMemo(
    () => landscapeUrls(client, item, { maxWidth: 480 }),
    [client, item]
  );

  const target =
    item.Type === 'Series'
      ? nextUp.data?.Items?.[0]
      : item.Type === 'Movie'
        ? item
        : undefined;
  usePreloadVersions(target);
  const resumeMs = ticksToMs(target?.UserData?.PlaybackPositionTicks);
  // Not begun: its first episode, none of it watched; the show tells of itself.
  const started =
    !!resumeMs || target?.ParentIndexNumber !== 1 || target?.IndexNumber !== 1;
  const code =
    target?.Type === 'Episode'
      ? episodeCode(target.ParentIndexNumber, target.IndexNumber)
      : '';
  const resumeAt = clock(resumeMs);
  const playLabel = resumeMs
    ? code
      ? t`Resume ${code}`
      : t`Resume from ${resumeAt}`
    : code
      ? t`Play ${code}`
      : t`Play`;
  const holdPlay = useHold(
    target
      ? () => picker.play(target, { startMs: resumeMs, held: true })
      : undefined
  );
  const quick =
    useMediaQuery('(pointer: coarse) and (max-width: 639px)') &&
    !currentHost().tv;
  // A collection may offer nothing besides its links, which then stay in line.
  const labelled =
    quick &&
    (item.Type !== 'BoxSet' ||
      offersFavourite(item.Type, !!item.UserData?.IsFavorite) ||
      !!trailersOf(item).length);
  const shown = useQuickActions(item, target);
  const [more, setMore] = React.useState(false);
  const moreBox = React.useRef<HTMLDivElement>(null);
  useDialogStart(moreBox, more);
  const holdRestart = useHold(
    target ? () => picker.play(target, { startMs: 0, held: true }) : undefined
  );

  return (
    <>
      {/* Its poster, logo and text show together, once all are in. */}
      {!ready && <HeaderSkeleton />}
      <TitleAbout
        item={item}
        meta={<MetaRow item={item} />}
        open={about}
        onOpenChange={setAbout}
      />
      {target?.Type === 'Episode' && item.Type === 'Series' && (
        <TitleAbout
          item={target}
          meta={<MetaRow item={target} />}
          open={aboutEpisode}
          onOpenChange={setAboutEpisode}
        />
      )}
      <div
        data-ui="item-header"
        data-nav-top
        className={cn(
          'flex flex-col gap-6 md:flex-row md:items-end md:gap-8',
          !ready && 'hidden'
        )}
      >
        {poster && !collection && (
          <CachedImage
            key={poster}
            data-ui="item-poster"
            src={poster}
            alt=""
            ref={drawn(poster)}
            onLoad={settle(poster)}
            onError={settle(poster)}
            className={cn(
              'hidden flex-none rounded-xl object-cover shadow-2xl ring-1 ring-white/10 md:block',
              cardShape(item) === 'poster'
                ? 'aspect-[2/3] w-48 lg:w-56'
                : 'aspect-video w-80'
            )}
          />
        )}
        <div className="min-w-0 max-w-3xl flex-1 space-y-4">
          <div data-ui="item-heading" className="space-y-4">
            {badge ? (
              <div
                data-ui="item-name"
                className="flex items-center gap-4 max-sm:justify-center"
              >
                <CachedImage
                  data-ui="item-badge"
                  src={badge}
                  alt=""
                  className={cn(
                    'flex-none rounded-lg object-cover ring-1 ring-white/10',
                    cardShape(item) === 'poster'
                      ? 'aspect-[2/3] h-20'
                      : 'aspect-video h-14 lg:h-16'
                  )}
                />
                {name}
              </div>
            ) : (
              name
            )}
            {!holding && item.Taglines?.[0] && (
              <p
                data-ui="item-tagline"
                className="text-base italic text-gray-300 max-sm:text-center"
              >
                {item.Taglines[0]}
              </p>
            )}
            {holding ? (
              // The facts, tags and overview held as one block until they come.
              <Skeleton className="h-5 w-72 max-w-full max-sm:mx-auto" />
            ) : (
              <MetaRow item={item} refreshing={refreshing} />
            )}
            {!holding && continuing && airing.next && (
              <NextAiring next={airing.next} />
            )}
            {holding && (
              <div className="flex gap-1.5 max-sm:justify-center">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            )}
            {!holding && !!item.Genres?.length && (
              <div
                data-ui="item-genres"
                className="flex flex-wrap gap-1.5 max-sm:justify-center"
              >
                {item.Genres.map((genre) => (
                  <Badge
                    key={genre}
                    data-ui="item-genre"
                    intent="white"
                    size="md"
                  >
                    {genre}
                  </Badge>
                ))}
              </div>
            )}
            {holding || nextUpPending ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full max-w-2xl" />
                <Skeleton className="h-4 w-11/12 max-w-2xl" />
                <Skeleton className="h-4 w-2/3 max-w-xl" />
              </div>
            ) : item.Type === 'Series' && target?.Overview && started ? (
              // Once begun, a show tells of the episode it goes on with; one
              // with no overview of its own keeps the show's in place.
              <NextEpisode
                episode={target}
                onPress={() => setAboutEpisode(true)}
              />
            ) : (
              <Overview
                title={item.Name ?? ''}
                line={[item.ProductionYear, item.Genres?.slice(0, 3).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
                overview={item.Overview}
                image={overviewImage}
                clampClass="max-h-[4lh]"
                onPress={() => setAbout(true)}
                className="text-sm leading-relaxed text-gray-300 sm:text-base [[data-tv]_&]:max-w-[50vw] [[data-tv]_&]:text-base"
              />
            )}
          </div>
          {holding && (
            <div
              aria-hidden
              className="flex flex-wrap items-center gap-2 max-sm:justify-center"
            >
              <Skeleton className="h-10 w-36 rounded-full" />
              <Skeleton className="h-10 w-28 rounded-full" />
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="size-10 rounded-full" />
              ))}
            </div>
          )}
          <div
            data-ui="item-actions"
            // Hidden, not unmounted, so Play is ready the moment the details come;
            // the page's start focus waits for it to show.
            className={cn(
              'flex flex-wrap items-center gap-2 max-sm:justify-center',
              holding && 'hidden'
            )}
          >
            {(target || nextUpPending) && (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button
                  data-ui="item-action"
                  data-name="play"
                  data-nav-start
                  intent="white"
                  className={cn(
                    'flex-1 rounded-full sm:flex-none',
                    item.Type === 'Series' && 'sm:min-w-[9.5rem]',
                    quick && 'h-12 text-base'
                  )}
                  leftIcon={<IoPlay className="text-xl" />}
                  onClick={() =>
                    target
                      ? picker.play(target, { startMs: resumeMs })
                      : void fetchNextUp(item.Id!).then(
                          (episode) =>
                            episode &&
                            picker.play(episode, {
                              startMs: ticksToMs(
                                episode.UserData?.PlaybackPositionTicks
                              ),
                            })
                        )
                  }
                  {...holdPlay}
                >
                  <PlayProgress
                    percent={resumeMs && target ? progressOf(target) : null}
                  >
                    {playLabel}
                  </PlayProgress>
                </Button>
                {!!resumeMs && target && (
                  <Tooltip
                    className="item-action-tip"
                    trigger={
                      <IconButton
                        data-ui="item-action"
                        data-name="restart"
                        intent="gray-subtle"
                        size={quick ? 'lg' : 'md'}
                        className="rounded-full text-2xl"
                        icon={<LuRotateCcw />}
                        aria-label={t`Play from the start`}
                        onClick={() => picker.play(target, { startMs: 0 })}
                        {...holdRestart}
                      />
                    }
                  >
                    <Trans>Play from the start</Trans>
                  </Tooltip>
                )}
              </div>
            )}
            {!labelled && (
              <SecondaryActions
                item={item}
                season={season}
                target={target}
                resumeMs={resumeMs}
              />
            )}
            {!labelled && !!links?.length && (
              <span
                data-ui="item-actions-divider"
                className="mx-1 hidden h-6 w-px bg-white/10 sm:block"
                aria-hidden
              />
            )}
            {!labelled && (
              <div className="basis-full sm:basis-auto">
                <ExternalLinks links={links} />
              </div>
            )}
          </div>
          {labelled && (
            <div
              data-ui="item-quick-actions"
              className="grid auto-cols-fr grid-flow-col gap-1"
            >
              <QuickShown.Provider value={shown}>
                <SecondaryActions
                  item={item}
                  season={season}
                  target={target}
                  resumeMs={resumeMs}
                  caption="item-quick-action"
                />
              </QuickShown.Provider>
              <Captioned
                ui="item-quick-action"
                name="more"
                label={t`More`}
                order={shown.length}
              >
                <IconButton
                  data-ui="item-action"
                  data-name="more"
                  intent="gray-subtle"
                  className="rounded-full"
                  icon={<BiDotsHorizontalRounded />}
                  aria-label={t`More`}
                  onClick={() => setMore(true)}
                />
              </Captioned>
            </div>
          )}
          {labelled && (
            <Drawer
              data-ui="dialog"
              data-name="item-more"
              open={more}
              onOpenChange={setMore}
              onOpenAutoFocus={focusDialog}
              title={item.Name ?? ''}
              side="bottom"
            >
              <div
                ref={moreBox}
                data-nav-start
                className="grid grid-cols-4 gap-x-1 gap-y-4 py-2"
              >
                <SecondaryActions
                  item={item}
                  season={season}
                  target={target}
                  resumeMs={resumeMs}
                  caption="item-more-action"
                />
              </div>
              {!!links?.length && (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <ExternalLinks links={links} />
                </div>
              )}
            </Drawer>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The next episode of a show still airing, from its latest season, which is
 * where a metadata addon lists what is scheduled.
 */
/**
 * A still-airing show's next episode to come, looked up from its latest
 * season. Started while the page still holds its places, so the line comes
 * with the rest instead of pushing in after it.
 */
function useNextAiring(series: BaseItemDto, enabled: boolean) {
  const seasons = useSeasons(series.Id!, enabled);
  const latest = React.useMemo(
    () =>
      (seasons.data?.Items ?? [])
        .filter((s) => (s.IndexNumber ?? 0) > 0)
        .sort((a, b) => (b.IndexNumber ?? 0) - (a.IndexNumber ?? 0))[0],
    [seasons.data]
  );
  const episodes = useEpisodes(
    series.Id!,
    enabled ? (latest?.Id ?? undefined) : undefined
  );
  const next = episodes.data?.Items?.find(
    (e) => e.PremiereDate && Date.parse(e.PremiereDate) > Date.now()
  );
  // Episodes are only asked for a season with an id, so only those are waited on.
  const loading =
    enabled && (seasons.isPending || (!!latest?.Id && episodes.isPending));
  return { next, loading };
}

function NextAiring({ next }: { next: BaseItemDto }) {
  if (!next?.PremiereDate) return null;
  return (
    <p
      data-ui="item-next-airing"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm max-sm:justify-center"
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
