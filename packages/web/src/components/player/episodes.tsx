import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { LuLoaderCircle } from 'react-icons/lu';
import { Drawer } from '@aiostreams/ui/drawer';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { focusOn, keyboardFocus, useRestoreFocus } from '../../lib/input';
import { unavailableKind } from '../../lib/format';
import { useEpisodes, useSeasons } from '../../lib/queries';
import type { BaseItemDto } from '../../lib/types';
import { EpisodeThumb, episodeLine, seasonEpisodeTitle } from '../episodes';
import { SeasonPills } from '../season-pills';

export function EpisodesSheet({
  item,
  open,
  loadingId,
  onPlay,
  onClose,
}: {
  item: BaseItemDto;
  open: boolean;
  loadingId: string | null;
  onPlay(episode: BaseItemDto): void;
  onClose(): void;
}) {
  const seriesId = item.SeriesId!;
  const seasons = useSeasons(seriesId, open);
  const [picked, setPicked] = React.useState<string>();
  const seasonId = picked ?? item.SeasonId ?? seasons.data?.Items?.[0]?.Id;
  const episodes = useEpisodes(seriesId, open ? seasonId : undefined);
  const list = React.useRef<HTMLDivElement>(null);
  const restoreFocus = useRestoreFocus(open);

  const items = episodes.data?.Items ?? [];
  const playing = items.some((e) => e.Id === item.Id);
  // After the dialog focuses its first button.
  React.useEffect(() => {
    if (!open || !playing) return;
    const timer = setTimeout(() => {
      const box = list.current;
      const row = box?.querySelector<HTMLElement>('[data-current]');
      if (!box || !row) return;
      box.scrollTop = row.offsetTop - (box.clientHeight - row.offsetHeight) / 2;
      const at = keyboardFocus();
      if (at && box.closest('[role=dialog]')?.contains(at)) focusOn(row);
    });
    return () => clearTimeout(timer);
  }, [open, playing]);

  const shownSeasons = seasons.data?.Items ?? [];
  return (
    <Drawer
      data-ui="dialog"
      data-name="episodes"
      open={open}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
        setPicked(undefined);
      }}
      onCloseAutoFocus={restoreFocus}
      title={t`Episodes`}
      headerClass="sr-only"
      side="right"
      size="md"
      contentClass="flex flex-col gap-0 overflow-hidden p-0"
      closeClass="end-2 top-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      <div
        data-ui="player-episodes-header"
        className="space-y-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]"
      >
        <div className="min-w-0 px-4 pe-12">
          <p className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
            <Trans>Episodes</Trans>
          </p>
          <p className="truncate font-semibold">{item.SeriesName}</p>
        </div>
        {shownSeasons.length > 1 && (
          <div data-ui="player-episodes-seasons" className="px-4">
            <SeasonPills
              seasons={shownSeasons}
              selected={seasonId}
              onSelect={setPicked}
            />
          </div>
        )}
      </div>
      {episodes.isLoading || !seasonId ? (
        <div
          data-nav-wait
          className="min-h-0 flex-1 space-y-1 overflow-hidden border-t border-white/5 p-2"
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex gap-3 p-2">
              <Skeleton className="aspect-video h-auto w-32 flex-none rounded-lg sm:w-36" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          key={seasonId}
          ref={list}
          data-ui="player-episodes-list"
          data-nav-group
          className="relative min-h-0 flex-1 space-y-1 overflow-y-auto border-t border-white/5 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
        >
          {episodes.isError && !items.length && (
            <p className="py-6 text-center text-sm text-[--muted]">
              <Trans>Could not load the episodes.</Trans>
            </p>
          )}
          {items.map((episode) => (
            <EpisodeRow
              key={episode.Id}
              episode={episode}
              current={episode.Id === item.Id}
              loading={loadingId === episode.Id}
              onPick={() =>
                episode.Id === item.Id ? onClose() : onPlay(episode)
              }
            />
          ))}
        </div>
      )}
    </Drawer>
  );
}

function EpisodeRow({
  episode,
  current,
  loading,
  onPick,
}: {
  episode: BaseItemDto;
  current: boolean;
  loading: boolean;
  onPick(): void;
}) {
  const unavailable = !!unavailableKind(episode);
  return (
    <button
      type="button"
      data-ui="player-episode"
      data-current={current || undefined}
      data-focus="own"
      aria-current={current || undefined}
      disabled={unavailable}
      onClick={onPick}
      className={cn(
        'group/episode flex w-full items-start gap-3 rounded-xl p-2 text-start outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--ring] disabled:pointer-events-none [[data-tv]_&]:focus-visible:ring-[3px]',
        current && 'bg-white/10'
      )}
    >
      <EpisodeThumb
        episode={episode}
        playable={!unavailable && !current}
        watched={!!episode.UserData?.Played}
        className="w-32 flex-none rounded-lg sm:w-36"
        numberClass="text-2xl"
      />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-2 text-sm font-semibold">
          {seasonEpisodeTitle(episode)}
        </p>
        <p className="mt-1 truncate text-xs text-[--muted]">
          {current ? (
            <span className="font-medium text-white">
              <Trans>Playing</Trans>
            </span>
          ) : (
            episodeLine(episode)
          )}
        </p>
      </div>
      {loading && (
        <LuLoaderCircle className="mt-1 flex-none animate-spin text-lg" />
      )}
    </button>
  );
}
