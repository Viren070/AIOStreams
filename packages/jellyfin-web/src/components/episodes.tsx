import React from 'react';
import { BiCheck, BiInfoCircle, BiPlay, BiSolidStar } from 'react-icons/bi';
import { Badge } from '@aiostreams/ui/badge';
import { IconButton } from '@aiostreams/ui/button';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { useSetPlayed } from '../lib/queries';
import { landscapeUrls } from '../lib/images';
import {
  dayLabel,
  duration,
  progressOf,
  shortDate,
  ticksToMs,
  unavailableLabel,
  untilLabel,
} from '../lib/format';
import { Artwork, OpenedPulse, ProgressBar } from './cards';
import { OverviewInfo } from './overview';
import { ItemMenu } from './item-menu';
import { useVersionPicker } from './version-picker';
import { useHold } from '../lib/use-hold';
import type { BaseItemDto } from '../lib/types';

function episodeNumber(episode: BaseItemDto): string | null {
  const from = episode.IndexNumber;
  const to = episode.IndexNumberEnd;
  if (from == null) return null;
  return to != null && to > from ? `${from}–${to}` : `${from}`;
}

/** `1. Pilot`, as a season's list shows it: the season is already picked. */
export function seasonEpisodeTitle(episode: BaseItemDto): string {
  const number = episodeNumber(episode);
  if (number == null) return episode.Name ?? '';
  return episode.Name ? `${number}. ${episode.Name}` : `Episode ${number}`;
}

/** When an episode aired and how long it runs, or when it will air. */
export function episodeLine(episode: BaseItemDto): string {
  const date = episode.PremiereDate;
  if (unavailableLabel(episode) === 'Unaired' && date) {
    return `Airs ${dayLabel(date)} · ${untilLabel(date)}`;
  }
  const runtime = ticksToMs(episode.RunTimeTicks);
  return [date && shortDate(date), runtime && duration(runtime)]
    .filter(Boolean)
    .join(' · ');
}

export function upToIndex(episodes: BaseItemDto[]): number {
  const resume = episodes.findIndex(
    (e) => !e.UserData?.Played && !!progressOf(e)
  );
  if (resume >= 0) return resume;
  const next = episodes.findIndex(
    (e) => !e.UserData?.Played && !unavailableLabel(e)
  );
  return Math.max(0, next);
}

/** Over art borrowed from the show, so episodes sharing it stay apart. */
function EpisodeNumber({
  episode,
  className,
}: {
  episode: BaseItemDto;
  className?: string;
}) {
  const number = episodeNumber(episode);
  if (number == null) return null;
  return (
    <div
      data-ui="episode-number"
      className="absolute inset-0 flex items-center justify-center bg-black/55"
    >
      <span
        className={cn(
          'font-bold tabular-nums text-white/90 drop-shadow-lg transition-opacity group-hover/episode:opacity-0',
          className
        )}
      >
        {number}
      </span>
    </div>
  );
}

function ownImages(episode: BaseItemDto): number {
  return episode.ImageTags?.Primary ? 1 : 0;
}

function usePlay(
  episode: BaseItemDto
): ((opts?: { held?: boolean }) => void) | undefined {
  const picker = useVersionPicker();
  if (unavailableLabel(episode)) return undefined;
  return (opts) =>
    picker.play(episode, {
      startMs: ticksToMs(episode.UserData?.PlaybackPositionTicks),
      held: opts?.held,
    });
}

function Thumb({
  episode,
  playable,
  highlighted,
  className,
  numberClass,
}: {
  episode: BaseItemDto;
  playable: boolean;
  highlighted?: boolean;
  className?: string;
  numberClass: string;
}) {
  const { client } = useSession();
  const unavailable = unavailableLabel(episode);
  const progress = progressOf(episode);
  return (
    <div
      data-ui="episode-image"
      className={cn(
        'relative aspect-video overflow-hidden bg-gray-900 ring-1 ring-white/5',
        className
      )}
    >
      <Artwork
        src={(width) => landscapeUrls(client, episode, { maxWidth: width })}
        alt={seasonEpisodeTitle(episode)}
        own={ownImages(episode)}
        standIn={<EpisodeNumber episode={episode} className={numberClass} />}
        className={cn(
          playable && 'group-hover/episode:scale-[1.03]',
          unavailable && 'opacity-40 grayscale'
        )}
      />
      {playable && (
        <div
          data-ui="episode-play"
          className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/episode:bg-black/30"
        >
          <BiPlay className="text-4xl text-white opacity-0 drop-shadow transition-opacity group-hover/episode:opacity-90" />
        </div>
      )}
      {unavailable && (
        <div data-ui="episode-status" className="absolute left-1.5 top-1.5">
          <Badge size="sm" intent="gray-solid">
            {unavailable}
          </Badge>
        </div>
      )}
      {progress != null && progress > 0 && <ProgressBar percent={progress} />}
      {highlighted && <OpenedPulse />}
    </div>
  );
}

function Kicker({ episode }: { episode: BaseItemDto }) {
  const number = episodeNumber(episode);
  const date = episode.PremiereDate;
  const runtime = ticksToMs(episode.RunTimeTicks);
  const when =
    unavailableLabel(episode) === 'Unaired' && date
      ? `Airs ${untilLabel(date)}`
      : runtime
        ? duration(runtime)
        : null;
  const text = [number != null ? `Episode ${number}` : null, when]
    .filter(Boolean)
    .join(' · ');
  const rating = episode.CommunityRating;
  return (
    <>
      {text}
      {rating ? (
        <>
          {text && ' · '}
          <BiSolidStar className="-mt-0.5 inline text-yellow-400" />{' '}
          {rating.toFixed(1)}
        </>
      ) : null}
    </>
  );
}

function Head({
  episode,
  play,
  onHold,
  className,
  oneLine,
}: {
  episode: BaseItemDto;
  play: (() => void) | undefined;
  /** A mouse press held on the title; rows leave it out, since dragging them would set it off. */
  onHold?: () => void;
  className?: string;
  /** Keeps a row's cards level. */
  oneLine?: boolean;
}) {
  const { client } = useSession();
  const hold = useHold(onHold, { touch: false });
  const setPlayed = useSetPlayed();
  const title = episode.Name || seasonEpisodeTitle(episode);
  const played = !!episode.UserData?.Played;
  const clamp = oneLine ? 'line-clamp-1' : 'line-clamp-2';
  return (
    <div data-ui="episode-head" className={cn('min-w-0', className)}>
      <div className="flex items-center gap-2">
        <p
          data-ui="episode-kicker"
          className="min-w-0 flex-1 truncate text-xs text-[--muted] sm:text-sm"
        >
          <Kicker episode={episode} />
        </p>
        <div
          data-ui="episode-actions"
          className="relative z-[1] flex flex-none items-center gap-1.5"
        >
          <OverviewInfo
            title={seasonEpisodeTitle(episode)}
            line={episodeLine(episode)}
            overview={episode.Overview}
            image={landscapeUrls(client, episode, { maxWidth: 480 })}
            trigger={
              <IconButton
                data-ui="episode-action"
                data-name="details"
                // A playable episode is one stop, and its menu has the rest.
                data-nav={play ? 'skip' : undefined}
                size="sm"
                intent="gray-subtle"
                className="size-8 rounded-full"
                icon={<BiInfoCircle />}
                aria-label="Episode details"
              />
            }
          />
          {play && (
            <IconButton
              data-ui="episode-action"
              data-name="watched"
              data-active={played || undefined}
              data-nav="skip"
              size="sm"
              intent={played ? 'primary' : 'gray-subtle'}
              className="size-8 rounded-full"
              icon={<BiCheck />}
              aria-label={played ? 'Mark unwatched' : 'Mark watched'}
              aria-pressed={played}
              loading={setPlayed.isPending}
              onClick={() =>
                setPlayed.mutate({ itemId: episode.Id!, played: !played })
              }
            />
          )}
        </div>
      </div>
      {/* Its overlay makes the whole episode the play button. */}
      {play ? (
        <button
          type="button"
          data-ui="episode-title"
          onClick={() => play()}
          {...hold}
          data-focus="own"
          className="mt-0.5 text-left text-sm font-semibold after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[--ring] sm:text-base"
        >
          <span className={clamp} title={oneLine ? title : undefined}>
            {title}
          </span>
        </button>
      ) : (
        <p
          data-ui="episode-title"
          className={cn('mt-0.5 text-sm font-semibold sm:text-base', clamp)}
          title={oneLine ? title : undefined}
        >
          {title}
        </p>
      )}
    </div>
  );
}

function Synopsis({
  episode,
  className,
}: {
  episode: BaseItemDto;
  className?: string;
}) {
  if (!episode.Overview) return null;
  return (
    <p
      data-ui="episode-synopsis"
      className={cn(
        'whitespace-pre-line text-sm leading-snug text-white/60',
        className
      )}
    >
      {episode.Overview}
    </p>
  );
}

function episodeState(episode: BaseItemDto) {
  return {
    'data-watched': episode.UserData?.Played || undefined,
    'data-in-progress': (progressOf(episode) ?? 0) > 0 || undefined,
    'data-unavailable': unavailableLabel(episode)?.toLowerCase(),
  };
}

export function EpisodeCard({
  episode,
  highlighted,
}: {
  episode: BaseItemDto;
  highlighted?: boolean;
}) {
  const play = usePlay(episode);
  return (
    <ItemMenu item={episode} onPage>
      <div
        data-ui="episode-card"
        {...episodeState(episode)}
        data-highlighted={highlighted || undefined}
        className="group/episode relative space-y-2"
      >
        <Thumb
          episode={episode}
          playable={!!play}
          highlighted={highlighted}
          className="rounded-xl"
          numberClass="text-5xl"
        />
        <Head episode={episode} play={play} className="px-0.5 pt-2" oneLine />
        <Synopsis episode={episode} className="line-clamp-3 px-0.5" />
      </div>
    </ItemMenu>
  );
}

function EpisodeListItem({
  episode,
  highlighted,
}: {
  episode: BaseItemDto;
  highlighted?: boolean;
}) {
  const play = usePlay(episode);
  return (
    <ItemMenu item={episode} onPage>
      <div
        data-ui="episode-list-item"
        {...episodeState(episode)}
        data-highlighted={highlighted || undefined}
        className="group/episode relative grid grid-cols-[40%_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl p-2 transition-colors hover:bg-white/[0.04] sm:grid-cols-[13rem_minmax(0,1fr)] sm:grid-rows-[auto_1fr] sm:gap-x-4 sm:gap-y-1"
      >
        {highlighted && <OpenedPulse />}
        <Thumb
          episode={episode}
          playable={!!play}
          className="rounded-lg sm:row-span-2"
          numberClass="text-3xl sm:text-4xl"
        />
        <Head
          episode={episode}
          play={play}
          onHold={play && (() => play({ held: true }))}
          className="self-start"
        />
        {/* Beside a phone's thumbnail it would get a few words a line. */}
        <Synopsis
          episode={episode}
          className="col-span-2 line-clamp-2 self-start sm:col-span-1 sm:col-start-2"
        />
      </div>
    </ItemMenu>
  );
}

export function EpisodeList({
  episodes,
  highlightId,
  anchorId,
  anchorRef,
  columns,
}: {
  episodes: BaseItemDto[];
  highlightId?: string;
  /** The episode given `anchorRef`, to scroll to. */
  anchorId?: string;
  anchorRef?: React.Ref<HTMLDivElement>;
  /** Side by side on wide screens. */
  columns?: boolean;
}) {
  return (
    <div
      data-ui="episode-list"
      className={cn(
        '-mx-2 grid gap-x-6 gap-y-1',
        columns && 'xl:grid-cols-2 min-[1800px]:grid-cols-3'
      )}
    >
      {episodes.map((episode) => (
        <div
          key={episode.Id}
          ref={episode.Id === anchorId ? anchorRef : undefined}
        >
          <EpisodeListItem
            episode={episode}
            highlighted={episode.Id === highlightId}
          />
        </div>
      ))}
    </div>
  );
}

export function EpisodeListSkeleton({ columns }: { columns?: boolean }) {
  return (
    <div
      className={cn(
        '-mx-2 grid gap-x-6 gap-y-1',
        columns && 'xl:grid-cols-2 min-[1800px]:grid-cols-3'
      )}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[40%_minmax(0,1fr)] gap-x-3 gap-y-2 p-2 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-x-4"
        >
          <Skeleton className="aspect-video h-auto w-full rounded-lg sm:row-span-2" />
          <div className="space-y-2 self-center sm:self-start sm:pt-1">
            <Skeleton className="h-3 w-1/3 rounded" />
            <Skeleton className="h-4 w-3/4 rounded" />
          </div>
          <Skeleton className="col-span-2 h-3 w-full rounded sm:col-span-1 sm:col-start-2" />
        </div>
      ))}
    </div>
  );
}
