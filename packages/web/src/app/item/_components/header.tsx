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
} from '@/lib/format';
import { Overview } from '@/components/media/overview';
import { Scores, scoresOf } from '@/components/media/scores';
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

export function HeaderSkeleton() {
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

const MetaRow = React.memo(function MetaRow({ item }: { item: BaseItemDto }) {
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
  if (scoresOf(item).length) parts.push(['score', <Scores item={item} />]);
  if (item.Type === 'Series' && item.Status) {
    parts.push(['status', item.Status]);
  }
  if (!parts.length) return null;
  return (
    <div
      data-ui="item-meta"
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-gray-200 max-sm:justify-center"
    >
      {parts.map(([name, part], i) => (
        <React.Fragment key={name}>
          {i > 0 && <Dot />}
          <span data-name={name}>{part}</span>
        </React.Fragment>
      ))}
    </div>
  );
});

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
}: {
  item: BaseItemDto;
  season?: BaseItemDto;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const nextUp = useNextUpFor(item.Id!, item.Type === 'Series');
  const fetchNextUp = useFetchNextUp();
  // Play holds its place, and focus, while a show's next episode is on its way.
  const nextUpPending = item.Type === 'Series' && nextUp.isPending;
  const logo = logoUrl(client, item, { maxWidth: 416 });
  const [logoFailed, setLogoFailed] = React.useState(false);
  const poster = posterUrl(client, item, { maxWidth: 320 });
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
        <div data-ui="item-heading" className="space-y-4">
          {logo && !logoFailed ? (
            <CachedImage
              data-ui="item-logo"
              src={logo}
              alt={item.Name ?? ''}
              onError={() => setLogoFailed(true)}
              className="max-h-24 max-w-[min(26rem,85%)] object-contain object-left max-sm:mx-auto max-sm:object-center lg:max-h-32"
            />
          ) : (
            <h1
              data-ui="item-title"
              className="text-3xl font-bold leading-tight max-sm:text-center sm:text-4xl lg:text-5xl"
            >
              {item.Name}
            </h1>
          )}
          {item.Taglines?.[0] && (
            <p
              data-ui="item-tagline"
              className="text-base italic text-gray-300 max-sm:text-center"
            >
              {item.Taglines[0]}
            </p>
          )}
          <MetaRow item={item} />
          {item.Type === 'Series' && item.Status === 'Continuing' && (
            <NextAiring series={item} />
          )}
          {!!item.Genres?.length && (
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
          <Overview
            title={item.Name ?? ''}
            line={[item.ProductionYear, item.Genres?.slice(0, 3).join(', ')]
              .filter(Boolean)
              .join(' · ')}
            overview={item.Overview}
            image={overviewImage}
            clampClass="max-h-[4lh]"
            className="text-sm leading-relaxed text-gray-300 sm:text-base"
          />
        </div>
        <div
          data-ui="item-actions"
          className="flex flex-wrap items-center gap-2 max-sm:justify-center"
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
                {playLabel}
              </Button>
              {!!resumeMs && target && (
                <Tooltip
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
