import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { Drawer } from '@aiostreams/ui/drawer';
import { cn } from '@aiostreams/ui/core/styling';
import { clock, fullTitle } from '../../lib/format';
import { focusOn, useRestoreFocus, usingKeys } from '../../lib/input';
import {
  CHAPTER_SNAP_MS,
  chapterAt,
  chapterSeekMs,
  type Chapter,
} from '../../lib/playback/chapters';
import type { PlayerController } from '../../lib/playback/controller';
import { usePlayhead } from '../../lib/playback/playhead';
import { nearestFirst } from '../../lib/playback/thumbnails';
import { useLatest } from '../../lib/use-latest';
import type { BaseItemDto } from '../../lib/types';

/** Chapters pictured before the list opens; the rest wait for it. */
const AHEAD = 24;
/** Past the start, once the player has settled. */
const AHEAD_AFTER_MS = 30_000;

const still = () => () => {};
const nothing = () => null;

export function ChaptersSheet({
  item,
  player,
  open,
  onClose,
}: {
  item: BaseItemDto;
  player: PlayerController;
  open: boolean;
  onClose(): void;
}) {
  const chapters = player.chapters ?? [];
  const feed = player.thumbnails;
  useChapterPictures(player, open);
  const pictures = React.useSyncExternalStore(
    open && feed ? feed.subscribe : still,
    feed?.kept ?? nothing
  );
  const pictured = !!feed && pictures !== null;
  // Before the first chapter, the first is the nearest.
  const current = usePlayhead(
    player.playhead,
    (h) => Math.max(0, chapterAt(chapters, h.positionMs + CHAPTER_SNAP_MS)),
    open
  );
  const latest = useLatest(player);
  const onPick = React.useCallback(
    (startMs: number) => {
      const { seek, thumbnails } = latest.current;
      seek(chapterSeekMs(startMs, thumbnails));
      onClose();
    },
    [latest, onClose]
  );
  const list = React.useRef<HTMLDivElement>(null);
  const restoreFocus = useRestoreFocus(open);

  // After the dialog focuses its first button.
  React.useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const box = list.current;
      const card = box?.querySelector<HTMLElement>('[data-current]');
      if (!box || !card) return;
      box.scrollTop =
        card.offsetTop - (box.clientHeight - card.offsetHeight) / 2;
      if (usingKeys()) focusOn(card);
    });
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <Drawer
      data-ui="dialog"
      data-name="chapters"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onCloseAutoFocus={restoreFocus}
      title={t`Chapters`}
      headerClass="sr-only"
      side="right"
      size={pictured ? 'lg' : 'md'}
      contentClass="flex flex-col gap-0 overflow-hidden p-0"
      closeClass="end-2 top-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      <div
        data-ui="player-chapters-header"
        className="min-w-0 px-4 pb-3 pe-12 pt-[calc(0.75rem+env(safe-area-inset-top))]"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
          <Trans>Chapters</Trans>
        </p>
        <p className="truncate font-semibold">{fullTitle(item)}</p>
      </div>
      <div
        ref={list}
        data-ui="player-chapters-list"
        data-nav-group
        className={cn(
          'relative min-h-0 flex-1 overflow-y-auto border-t border-white/5 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]',
          pictured ? 'grid grid-cols-2 content-start gap-1' : 'space-y-1'
        )}
      >
        {chapters.map((chapter, i) => (
          <ChapterCard
            key={`${chapter.startMs}-${i}`}
            index={i}
            chapter={chapter}
            pictured={pictured}
            picture={pictures?.get(chapter.startMs)?.src}
            current={i === current}
            onPick={onPick}
          />
        ))}
      </div>
    </Drawer>
  );
}

/** All while the list is open, else the nearest `AHEAD`; none while the player buffers. */
function useChapterPictures(player: PlayerController, open: boolean) {
  const feed = player.thumbnails;
  const { started, waiting } = player.state;
  const starts = (player.chapters ?? []).map((c) => c.startMs).join(',');
  const latest = useLatest(player);
  const [settled, setSettled] = React.useState<{
    feed: typeof feed;
    atMs: number;
  } | null>(null);
  const aheadAt = settled && settled.feed === feed ? settled.atMs : null;
  React.useEffect(() => {
    if (!feed || !started) return;
    const timer = setTimeout(
      () => setSettled({ feed, atMs: latest.current.playhead.positionMs }),
      AHEAD_AFTER_MS
    );
    return () => clearTimeout(timer);
  }, [feed, started, latest]);
  React.useEffect(() => {
    if (!feed || !starts) return;
    const all = starts.split(',').map(Number);
    if (open) feed.keep(all, latest.current.playhead.positionMs);
    else if (aheadAt === null || waiting) feed.keep([]);
    else feed.keep(nearestFirst(all, aheadAt).slice(0, AHEAD), aheadAt);
  }, [feed, starts, open, aheadAt, waiting, latest]);
}

const ITEM =
  'rounded-xl text-start outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--ring] [[data-tv]_&]:focus-visible:ring-[3px]';

const ChapterCard = React.memo(function ChapterCard({
  index,
  chapter,
  pictured,
  picture,
  current,
  onPick,
}: {
  index: number;
  chapter: Chapter;
  pictured: boolean;
  picture?: string;
  current: boolean;
  onPick(startMs: number): void;
}) {
  const number = index + 1;
  const title = chapter.title || t`Chapter ${number}`;
  const playing = current && (
    <span className="font-medium text-white">
      <Trans>Playing</Trans>
    </span>
  );
  const props = {
    type: 'button' as const,
    'data-ui': 'player-chapter',
    'data-current': current || undefined,
    'data-focus': 'own',
    'aria-current': current || undefined,
    onClick: () => onPick(chapter.startMs),
  };
  if (!pictured)
    return (
      <button
        {...props}
        className={cn(
          ITEM,
          'flex w-full items-center gap-3 px-3 py-2.5',
          current && 'bg-white/10'
        )}
      >
        <span className="w-6 flex-none text-center text-sm font-semibold tabular-nums text-[--muted]">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {playing && <p className="text-xs">{playing}</p>}
        </div>
        <span className="flex-none text-xs tabular-nums text-[--muted]">
          {clock(chapter.startMs)}
        </span>
      </button>
    );
  return (
    <button
      {...props}
      className={cn(
        ITEM,
        'flex min-w-0 flex-col gap-2 p-1.5',
        current && 'bg-white/10'
      )}
    >
      <div
        data-ui="player-chapter-image"
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-gray-900 ring-1 ring-white/5"
      >
        {picture ? (
          <img
            src={picture}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <span className="text-3xl font-bold tabular-nums text-white/25">
            {number}
          </span>
        )}
      </div>
      <div className="min-w-0 px-1 pb-0.5">
        <p className="line-clamp-2 text-sm font-semibold">{title}</p>
        <p className="mt-0.5 truncate text-xs tabular-nums text-[--muted]">
          {playing && (
            <>
              {playing}
              {' · '}
            </>
          )}
          {clock(chapter.startMs)}
        </p>
      </div>
    </button>
  );
});
