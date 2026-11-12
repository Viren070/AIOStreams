import React from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiCheck, BiChevronRight } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { currentHost } from '@/lib/hosts';
import { useSession } from '@/lib/jellyfin/session';
import { useEpisodes, useSeasons, openingSeason } from '@/lib/jellyfin/queries';
import { posterUrl } from '@/lib/artwork/urls';
import { isUnaired } from '@/lib/format';
import { navigate, to } from '@/lib/paths';
import { settings, useSetting } from '@/lib/settings';
import { MediaRow } from '@/components/media/media-row';
import {
  EpisodeCard,
  EpisodeList,
  EpisodeListSkeleton,
  upToIndex,
} from '@/components/media/episodes';
import { ItemMenu } from '@/components/media/item-menu';
import { SeasonPills } from '@/components/media/season-pills';
import { RatingButton } from './rating';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { navWait, tab, tabList } from '@/lib/input';
import { CachedImage } from '@/components/cached-image';
import { Section } from './section';

export function Seasons({
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
  const [layoutPref] = useSetting(settings.interface.episodeLayout);
  const wide = useMediaQuery('(min-width: 1024px)');
  const layout = layoutPref === 'auto' ? (wide ? 'row' : 'list') : layoutPref;
  const seasons = useSeasons(series.Id!, true);
  const list = React.useMemo(() => seasons.data?.Items ?? [], [seasons.data]);
  const [chosen, setChosen] = React.useState(initialSeasonId);
  const fallback = React.useMemo(() => openingSeason(list)?.Id, [list]);
  // Waits for the server's answer, so a saved copy of the list doesn't pick it.
  const settled = !seasons.isFetching;
  React.useEffect(() => {
    if (!chosen && settled && fallback) setChosen(fallback);
  }, [chosen, settled, fallback]);
  const seasonId = chosen ?? fallback;
  const pick = React.useCallback(
    (id: string) => {
      setChosen(id);
      navigate(`${to.item(series.Id!)}?season=${id}`, {
        replace: true,
        keepScroll: true,
      });
    },
    [series.Id]
  );
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
        <RatingButton item={season} label={t`Rate season`} inline />
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
    <Section name="episodes" title={ownPosters ? undefined : t`Episodes`}>
      {ownPosters ? (
        <SeasonPosters seasons={list} selected={seasonId} onSelect={pick} />
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
          <div ref={navWait}>
            <MediaRow
              key="loading"
              shape="wide"
              itemClass={ROW_WIDTH}
              loading
            />
          </div>
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
                    title={season?.Name ?? t`Episodes`}
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
        <div ref={navWait}>
          <EpisodeListSkeleton columns />
        </div>
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

function useSlidingBar(selected: string | undefined) {
  const bars = React.useRef(new Map<string, HTMLElement>());
  const last = React.useRef(selected);
  React.useLayoutEffect(() => {
    const from = last.current && bars.current.get(last.current);
    const to = selected && bars.current.get(selected);
    last.current = selected;
    if (!from || !to || from === to) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dx =
      from.getBoundingClientRect().left - to.getBoundingClientRect().left;
    to.animate(
      { transform: [`translateX(${dx}px)`, 'none'] },
      { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
    );
  }, [selected]);
  return (id: string) => (el: HTMLElement | null) => {
    if (el) bars.current.set(id, el);
    else bars.current.delete(id);
  };
}

// Apart from the episodes below, which redraw as they arrive and as the season settles.
const SeasonPosters = React.memo(function SeasonPosters({
  seasons,
  selected,
  onSelect,
}: {
  seasons: BaseItemDto[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const { client } = useSession();
  const bar = useSlidingBar(selected);
  return (
    <div {...tabList}>
      <MediaRow
        id="seasons"
        title={t`Episodes`}
        shape="poster"
        itemClass="basis-[7rem] sm:basis-[8rem] lg:basis-[8.5rem]"
      >
        {seasons.map((s) => {
          const isSelected = s.Id === selected;
          const poster = posterUrl(client, s, { maxWidth: 120 });
          return (
            <ItemMenu key={s.Id} item={s} onPage>
              <button
                type="button"
                data-ui="season-poster"
                data-selected={isSelected || undefined}
                data-focus="own"
                {...tab(isSelected, () => onSelect(s.Id!))}
                onClick={() => onSelect(s.Id!)}
                className="group/season w-full space-y-2 text-start"
              >
                <div
                  data-focus-frame
                  className="relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-900"
                >
                  {poster && (
                    <CachedImage
                      src={poster}
                      alt=""
                      loading="lazy"
                      className={cn(
                        'absolute inset-0 h-full w-full object-cover transition-opacity [transition-duration:250ms]',
                        !isSelected &&
                          'opacity-40 group-hover/season:opacity-100 group-focus-visible/season:opacity-100'
                      )}
                    />
                  )}
                  {/* Drawn inside, since the row clips anything outside it. */}
                  <span className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/10" />
                  {s.UserData?.Played && (
                    <span
                      data-ui="watched-badge"
                      className="absolute end-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-brand-500 text-white"
                    >
                      <BiCheck />
                    </span>
                  )}
                </div>
                <p
                  data-ui="season-name"
                  className={cn(
                    'truncate text-sm font-medium transition-colors [transition-duration:250ms]',
                    isSelected
                      ? 'text-white'
                      : 'text-[--muted] group-hover/season:text-white group-focus-visible/season:text-white'
                  )}
                >
                  {s.Name}
                </p>
                <span
                  ref={bar(s.Id!)}
                  data-ui="season-indicator"
                  aria-hidden
                  className={cn(
                    '-mt-1 block h-0.5 w-6 rounded-full bg-brand-500',
                    !isSelected && 'opacity-0'
                  )}
                />
              </button>
            </ItemMenu>
          );
        })}
      </MediaRow>
    </div>
  );
});

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
          rightIcon={<BiChevronRight className="rtl:-scale-x-100" />}
          iconSpacing="0.25rem"
        >
          <Trans>All episodes</Trans>
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
  const episodeCount = episodes.length;
  const unairedCount = episodes.filter(isUnaired).length;
  return [
    year,
    plural(episodeCount, { one: '# episode', other: '# episodes' }),
    unairedCount
      ? plural(unairedCount, { one: '# unaired', other: '# unaired' })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
