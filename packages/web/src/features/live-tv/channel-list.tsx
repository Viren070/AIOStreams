import { t } from '@lingui/core/macro';
import React from 'react';
import { BiSolidHeart } from 'react-icons/bi';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '@/lib/jellyfin/session';
import { posterUrl } from '@/lib/artwork/urls';
import { airTime } from '@/lib/format';
import { move, runAction } from '@/lib/input';
import { airedShare, airingAt, startOf, useSchedules } from './live-tv';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { CachedImage } from '@/components/cached-image';
import { useOpenItemMenu } from '@/components/media/item-menu';

export const ROW_HEIGHT = 76;
/** Rows drawn past each edge, so a quick scroll shows no gap. */
export const OVERSCAN = 6;
/** Rows of programmes asked for together. */
export const BATCH = 20;
/** Rows kept between the active row and an edge as keys move it. */
const EDGE_ROWS = 2;

function batchesOf(channels: BaseItemDto[], first: number, last: number) {
  const batches: string[][] = [];
  for (let b = Math.floor(first / BATCH); b <= Math.floor(last / BATCH); b++)
    batches.push(channels.slice(b * BATCH, (b + 1) * BATCH).map((c) => c.Id!));
  return batches.filter((ids) => ids.length);
}

/**
 * The programmes of the rows in sight, asked for a batch of rows at a time,
 * and of the `pinned` row's batch, which a page shows the details of.
 */
export function useRowSchedules(
  channels: BaseItemDto[],
  window: { from?: number; to?: number; pinned?: number } = {}
) {
  const [range, setRange] = React.useState({ first: 0, last: 0 });
  // Whole batches, so scrolling within one redraws nothing above the list.
  const onRange = React.useCallback((first: number, last: number) => {
    const from = Math.floor(first / BATCH) * BATCH;
    const to = (Math.floor(last / BATCH) + 1) * BATCH - 1;
    setRange((was) =>
      was.first === from && was.last === to ? was : { first: from, last: to }
    );
  }, []);
  const pinned = window.pinned ?? range.first;
  const batches = React.useMemo(() => {
    const shown = batchesOf(channels, range.first, range.last);
    const held = batchesOf(channels, pinned, pinned)[0];
    return held && !shown.some((ids) => ids[0] === held[0])
      ? [...shown, held]
      : shown;
  }, [channels, range.first, range.last, pinned]);
  const schedules = useSchedules(batches, {
    from: window.from,
    to: window.to,
  });
  return { schedules, onRange, range };
}

/**
 * The row the keys are on, kept here so a press redraws only the list: a new
 * `placed` puts them there, and `onMove` hears each move from it.
 */
export function useKeyFocus<T extends { row: number }>(
  placed: T,
  onMove: (next: T) => void
) {
  const [focus, setFocus] = React.useState(placed);
  const [from, setFrom] = React.useState(placed);
  if (placed !== from) {
    setFrom(placed);
    setFocus(placed);
  }
  const go = (next: T) => {
    setFocus(next);
    onMove(next);
  };
  return [focus, go] as const;
}

function visibleRows(scrollTop: number, height: number, total: number) {
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    total - 1,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN
  );
  return { first, last };
}

/**
 * A group's channels, drawn only near the screen. The list keeps focus itself
 * and moves an active row with the keys, so a remote's press touches two rows
 * rather than measuring the page.
 */
export function ChannelList({
  channels,
  total,
  schedules,
  now,
  placed,
  playingId,
  onActive,
  onPlay,
  onRange,
  onLeaveUp = () => void move('up'),
  className,
}: {
  channels: BaseItemDto[];
  /** Channels in the group, loaded or not. */
  total: number;
  schedules: Map<string, BaseItemDto[]>;
  now: number;
  placed: { row: number };
  playingId?: string;
  onActive?(index: number): void;
  onPlay(channel: BaseItemDto): void;
  onRange(first: number, last: number): void;
  /** Up from the first row, which goes to what is above where not given. */
  onLeaveUp?: () => void;
  className?: string;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ top: 0, height: 0 });
  const openMenu = useOpenItemMenu();
  const [focus, setFocus] = useKeyFocus(placed, (next) => onActive?.(next.row));
  const active = Math.min(focus.row, channels.length - 1);

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () =>
      setView((last) =>
        last.top === el.scrollTop && last.height === el.clientHeight
          ? last
          : { top: el.scrollTop, height: el.clientHeight }
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);

  const { first, last } = visibleRows(view.top, view.height, total);
  const latestRange = React.useRef(onRange);
  latestRange.current = onRange;
  React.useEffect(() => {
    latestRange.current(first, last);
  }, [first, last]);

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !el.clientHeight) return;
    const top = active * ROW_HEIGHT;
    const margin = EDGE_ROWS * ROW_HEIGHT;
    if (top - margin < el.scrollTop) el.scrollTop = Math.max(0, top - margin);
    else if (top + ROW_HEIGHT + margin > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_HEIGHT + margin - el.clientHeight;
  }, [active]);

  const pageRows = Math.max(1, Math.floor(view.height / ROW_HEIGHT) - 1);
  const go = (index: number) =>
    setFocus({ row: Math.max(0, Math.min(total - 1, index)) });
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const channel = channels[active];
    switch (e.key) {
      case 'ArrowDown':
        if (active < total - 1) go(active + 1);
        break;
      case 'ArrowUp':
        if (active > 0) go(active - 1);
        else onLeaveUp();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        move(e.key === 'ArrowLeft' ? 'left' : 'right');
        break;
      case 'PageDown':
        go(active + pageRows);
        break;
      case 'PageUp':
        go(active - pageRows);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(total - 1);
        break;
      case 'Enter':
      case ' ':
        if (channel) onPlay(channel);
        break;
      case 'Escape':
        runAction('back');
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const rowAt = (target: EventTarget) =>
    Number(
      (target as Element).closest<HTMLElement>('[data-index]')?.dataset.index ??
        -1
    );

  const rows: React.ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const channel = channels[i];
    rows.push(
      channel ? (
        <ChannelRow
          key={channel.Id}
          index={i}
          channel={channel}
          programmes={schedules.get(channel.Id!)}
          now={now}
          active={i === active}
          playing={channel.Id === playingId}
        />
      ) : (
        <div
          key={`loading-${i}`}
          aria-hidden
          className="absolute inset-x-0 px-2 py-2"
          style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
        >
          <div className="h-full animate-pulse rounded-xl bg-white/5" />
        </div>
      )
    );
  }

  return (
    <div
      ref={scroller}
      data-ui="channel-list"
      role="listbox"
      tabIndex={0}
      data-focus="own"
      aria-label={t`Channels`}
      aria-activedescendant={
        channels[active] ? `channel-${channels[active].Id}` : undefined
      }
      className={cn(
        'relative overflow-y-auto overscroll-contain [scrollbar-width:thin]',
        className
      )}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        const index = rowAt(e.target);
        const channel = channels[index];
        if (!channel) return;
        go(index);
        onPlay(channel);
      }}
      onContextMenu={(e) => {
        const pointed = rowAt(e.target);
        const index = pointed < 0 ? active : pointed;
        const channel = channels[index];
        if (!channel || !openMenu) return;
        e.preventDefault();
        go(index);
        // A key's menu opens beside the active row.
        const row = scroller.current?.querySelector(`[data-index="${index}"]`);
        const box = row?.getBoundingClientRect();
        const at =
          e.clientX || e.clientY || !box
            ? e
            : { clientX: box.left + 24, clientY: box.bottom };
        openMenu({ item: channel }, at);
      }}
    >
      <div className="relative" style={{ height: total * ROW_HEIGHT }}>
        {rows}
      </div>
    </div>
  );
}

const ChannelRow = React.memo(function ChannelRow({
  index,
  channel,
  programmes,
  now,
  active,
  playing,
}: {
  index: number;
  channel: BaseItemDto;
  programmes: BaseItemDto[] | undefined;
  now: number;
  active: boolean;
  playing: boolean;
}) {
  const { client } = useSession();
  const logo = posterUrl(client, channel, { maxWidth: 96 });
  const current =
    (programmes && airingAt(programmes, now)) ??
    (channel.CurrentProgram && airingAt([channel.CurrentProgram], now));
  const next = programmes?.find((p) => startOf(p) > now);
  const nextAt = next?.StartDate ? airTime(next.StartDate) : null;
  return (
    <div
      id={`channel-${channel.Id}`}
      role="option"
      aria-selected={active}
      data-ui="channel-row"
      data-index={index}
      data-active={active || undefined}
      data-playing={playing || undefined}
      className="absolute inset-x-0 cursor-pointer px-1 py-1"
      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
    >
      <div
        data-focus-frame={active || undefined}
        className={cn(
          'flex h-full items-center gap-3 rounded-xl px-2',
          active ? 'bg-white/10' : 'hover:bg-white/5'
        )}
      >
        <span
          data-name="number"
          className="w-8 flex-none text-end text-xs tabular-nums text-[--muted]"
        >
          {channel.ChannelNumber}
        </span>
        <div className="relative flex h-11 w-[4.5rem] flex-none items-center justify-center overflow-hidden rounded-lg bg-white/5">
          {logo ? (
            <CachedImage
              src={logo}
              alt=""
              className="h-full w-full object-contain p-1"
            />
          ) : (
            <span className="text-xs font-semibold text-[--muted]">
              {(channel.Name ?? '').slice(0, 3)}
            </span>
          )}
          {playing && (
            <span
              data-name="playing"
              className="absolute end-1 top-1 size-2 rounded-full bg-brand-500"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
            <span className="truncate">{channel.Name}</span>
            {channel.UserData?.IsFavorite && (
              <BiSolidHeart
                aria-label={t`Favourite`}
                className="flex-none text-xs text-[--muted]"
              />
            )}
          </p>
          {current ? (
            <>
              <p data-name="now" className="truncate text-xs text-gray-300">
                {current.Name}
              </p>
              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-white/60"
                  style={{ width: `${airedShare(current, now) * 100}%` }}
                />
              </div>
            </>
          ) : null}
          {next && (
            <p
              data-name="next"
              className="mt-0.5 truncate text-xs text-[--muted]"
            >
              {nextAt && <span className="tabular-nums">{nextAt} </span>}
              {next.Name}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
