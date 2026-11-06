import { t } from '@lingui/core/macro';
import React from 'react';
import { BiBell } from 'react-icons/bi';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../../lib/session';
import { posterUrl } from '../../lib/images';
import { airTime, clockTime } from '../../lib/format';
import { move, runAction } from '../../lib/input';
import { caughtUp, endOf, startOf } from '../../lib/live-tv';
import type { BaseItemDto } from '../../lib/types';
import { CachedImage } from '../../components/cached-image';
import { OVERSCAN, useKeyFocus } from '../../components/channel-list';
import { useOpenItemMenu } from '../../components/item-menu';

const ROW = 64;
const RULER = 32;
const CHANNEL_COLUMN = 264;
const PX_PER_MINUTE = 5;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const HALF_HOUR = 30 * MINUTE;
/** Programmes are drawn a chunk at a time, so a scroll redraws rows only now and then. */
const CHUNK_PX = 600;
/** Room kept between the active programme and the edges as keys move it. */
const EDGE_PX = 80;
const EDGE_ROWS = 2;

const xOf = (at: number, dayStart: number) =>
  ((at - dayStart) / MINUTE) * PX_PER_MINUTE;

/** Where the keys are: a row, and a time its programme is found at. */
export interface GuideFocus {
  row: number;
  at: number;
}

/** The programme at `at`, or the next one after it. */
export function programmeAt(
  programmes: BaseItemDto[] | undefined,
  at: number
): BaseItemDto | undefined {
  return programmes?.find((p) => endOf(p) > at);
}

/**
 * A day of programmes, channels down and time across. The grid keeps focus
 * itself and moves over its data with the keys, so a press reads no boxes.
 */
export function Guide({
  channels,
  total,
  schedules,
  dayStart,
  now,
  placed,
  playingId,
  onFocus,
  onPlay,
  onRange,
  onLeaveUp,
  reminded,
  className,
}: {
  channels: BaseItemDto[];
  total: number;
  schedules: Map<string, BaseItemDto[]>;
  dayStart: number;
  now: number;
  placed: GuideFocus;
  playingId?: string;
  onFocus(focus: GuideFocus): void;
  onPlay(channel: BaseItemDto, programme?: BaseItemDto): void;
  onRange(first: number, last: number): void;
  /** Up from the first row, which the page sends on to what is above. */
  onLeaveUp(): void;
  reminded: ReadonlySet<string>;
  className?: string;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });
  const openMenu = useOpenItemMenu();
  const dayEnd = dayStart + DAY;
  const width = CHANNEL_COLUMN + xOf(dayEnd, dayStart);
  const [keys, setFocus] = useKeyFocus(placed, onFocus);
  const focus = { row: Math.min(keys.row, channels.length - 1), at: keys.at };

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS variable
      el.style.setProperty('--guide-scroll', `${el.scrollLeft}px`);
      setView((last) =>
        last.top === el.scrollTop &&
        last.left === el.scrollLeft &&
        last.width === el.clientWidth &&
        last.height === el.clientHeight
          ? last
          : {
              top: el.scrollTop,
              left: el.scrollLeft,
              width: el.clientWidth,
              height: el.clientHeight,
            }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(
    total - 1,
    Math.ceil((view.top + view.height) / ROW) + OVERSCAN
  );
  const latestRange = React.useRef(onRange);
  latestRange.current = onRange;
  React.useEffect(() => {
    latestRange.current(first, last);
  }, [first, last]);

  // A day opens on the time the focus is at, which is now for today.
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, xOf(focus.at - HALF_HOUR, dayStart));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart]);

  const focusChannel = channels[focus.row];
  const focused = programmeAt(
    focusChannel && schedules.get(focusChannel.Id!),
    focus.at
  );
  const focusStart = focused ? Math.max(startOf(focused), dayStart) : focus.at;
  const focusEnd = focused ? Math.min(endOf(focused), dayEnd) : focus.at;
  const focusSpan = React.useRef({ start: focusStart, end: focusEnd });
  focusSpan.current = { start: focusStart, end: focusEnd };

  // Follows the focus only as it moves: a scroll that loads other rows' programmes leaves it be.
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !el.clientHeight) return;
    const top = focus.row * ROW;
    const margin = EDGE_ROWS * ROW;
    const visible = el.clientHeight - RULER;
    if (top - margin < el.scrollTop) el.scrollTop = Math.max(0, top - margin);
    else if (top + ROW + margin > el.scrollTop + visible)
      el.scrollTop = top + ROW + margin - visible;
    // Only a programme out of sight moves the time, so up and down keep it.
    const from = xOf(focusSpan.current.start, dayStart);
    const to = xOf(focusSpan.current.end, dayStart);
    const shown = el.clientWidth - CHANNEL_COLUMN;
    if (to < el.scrollLeft + EDGE_PX || from > el.scrollLeft + shown - EDGE_PX)
      el.scrollLeft = Math.max(0, from - EDGE_PX);
  }, [focus.row, focus.at, dayStart]);

  const go = (row: number, at = focus.at) =>
    setFocus({ row: Math.max(0, Math.min(total - 1, row)), at });
  const step = (sign: number) => {
    const programmes = focusChannel && schedules.get(focusChannel.Id!);
    if (!programmes?.length || !focused) {
      const at = focus.at + sign * HALF_HOUR;
      if (at < dayStart) return move('left');
      if (at < dayEnd) go(focus.row, at);
      return;
    }
    const index = programmes.indexOf(focused);
    const next = programmes[index + sign];
    if (!next || endOf(next) <= dayStart || startOf(next) >= dayEnd) {
      if (sign < 0) move('left');
      return;
    }
    go(focus.row, Math.max(startOf(next), dayStart));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const pageRows = Math.max(1, Math.floor((view.height - RULER) / ROW) - 1);
    switch (e.key) {
      case 'ArrowDown':
        if (focus.row < total - 1) go(focus.row + 1);
        break;
      case 'ArrowUp':
        if (focus.row > 0) go(focus.row - 1);
        else onLeaveUp();
        break;
      case 'ArrowLeft':
        step(-1);
        break;
      case 'ArrowRight':
        step(1);
        break;
      case 'PageDown':
        go(focus.row + pageRows);
        break;
      case 'PageUp':
        go(focus.row - pageRows);
        break;
      case 'Enter':
      case ' ':
        if (focusChannel) onPlay(focusChannel, focused);
        break;
      case 'Escape':
        runAction('back');
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const pointed = (target: EventTarget) => {
    const cell = (target as Element).closest<HTMLElement>('[data-row]');
    if (!cell) return null;
    const row = Number(cell.dataset.row);
    const at = cell.dataset.at ? Number(cell.dataset.at) : focus.at;
    return { row, at };
  };

  const left = (Math.floor(view.left / CHUNK_PX) - 1) * CHUNK_PX;
  const right = (Math.ceil((view.left + view.width) / CHUNK_PX) + 1) * CHUNK_PX;
  const rows: React.ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const channel = channels[i];
    rows.push(
      <GuideRow
        key={channel?.Id ?? `loading-${i}`}
        index={i}
        channel={channel}
        programmes={channel && schedules.get(channel.Id!)}
        dayStart={dayStart}
        left={left}
        right={right}
        now={now}
        focusAt={i === focus.row ? focusStart : undefined}
        playing={!!channel && channel.Id === playingId}
        reminded={reminded}
      />
    );
  }

  const nowX = now >= dayStart && now < dayEnd ? xOf(now, dayStart) : null;
  return (
    <div
      ref={scroller}
      data-ui="guide"
      // Time runs left to right, as cells are placed from the left.
      dir="ltr"
      role="grid"
      tabIndex={0}
      data-focus="own"
      aria-label={t`Guide`}
      aria-rowcount={total}
      className={cn(
        'relative overflow-auto overscroll-contain [scrollbar-width:thin]',
        className
      )}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        const at = pointed(e.target);
        const channel = at && channels[at.row];
        if (!at || !channel) return;
        go(at.row, at.at);
        onPlay(channel, programmeAt(schedules.get(channel.Id!), at.at));
      }}
      onContextMenu={(e) => {
        const at = pointed(e.target);
        const channel = channels[at?.row ?? focus.row];
        if (!channel || !openMenu) return;
        e.preventDefault();
        openMenu({ item: channel }, e);
      }}
    >
      <div className="relative" style={{ width, height: RULER + total * ROW }}>
        <Ruler dayStart={dayStart} left={left} right={right} />
        {rows}
        {nowX !== null && (
          <div
            data-ui="guide-now"
            aria-hidden
            className="pointer-events-none absolute z-[1] w-0.5 bg-red-500"
            style={{
              left: CHANNEL_COLUMN + nowX,
              top: RULER,
              height: total * ROW,
            }}
          />
        )}
      </div>
    </div>
  );
}

const Ruler = React.memo(function Ruler({
  dayStart,
  left,
  right,
}: {
  dayStart: number;
  left: number;
  right: number;
}) {
  const marks: React.ReactNode[] = [];
  for (let at = dayStart; at < dayStart + DAY; at += HALF_HOUR) {
    const x = xOf(at, dayStart);
    if (x + xOf(dayStart + HALF_HOUR, dayStart) < left || x > right) continue;
    marks.push(
      <span
        key={at}
        className="absolute top-0 flex h-full items-center border-s border-white/10 ps-2 text-xs tabular-nums text-[--muted]"
        style={{ left: CHANNEL_COLUMN + x }}
      >
        {clockTime(at)}
      </span>
    );
  }
  return (
    <div
      data-ui="guide-ruler"
      className="sticky top-0 z-[3] bg-[--background]"
      style={{ height: RULER }}
    >
      {marks}
      <div
        className="sticky start-0 z-[1] h-full bg-[--background]"
        style={{ width: CHANNEL_COLUMN }}
      />
    </div>
  );
});

const GuideRow = React.memo(function GuideRow({
  index,
  channel,
  programmes,
  dayStart,
  left,
  right,
  now,
  focusAt,
  playing,
  reminded,
}: {
  index: number;
  channel: BaseItemDto | undefined;
  programmes: BaseItemDto[] | undefined;
  dayStart: number;
  left: number;
  right: number;
  now: number;
  /** The start of the programme the keys are on, in this row. */
  focusAt?: number;
  playing: boolean;
  reminded: ReadonlySet<string>;
}) {
  const { client } = useSession();
  const dayEnd = dayStart + DAY;
  const logo = channel && posterUrl(client, channel, { maxWidth: 96 });
  const cells: React.ReactNode[] = [];
  for (const p of programmes ?? []) {
    const start = Math.max(startOf(p), dayStart);
    const end = Math.min(endOf(p), dayEnd);
    if (end <= start) continue;
    const x = xOf(start, dayStart);
    const w = xOf(end, dayStart) - x;
    if (x + w < left || x > right) continue;
    const airing = startOf(p) <= now && now < endOf(p);
    const gone = endOf(p) <= now && !caughtUp(p);
    const focused = focusAt === start;
    cells.push(
      <div
        key={p.Id}
        role="gridcell"
        aria-selected={focused}
        data-ui="guide-cell"
        data-row={index}
        data-at={start}
        data-airing={airing || undefined}
        data-catchup={caughtUp(p) || undefined}
        data-reminder={reminded.has(p.Id!) || undefined}
        data-active={focused || undefined}
        data-focus-frame={focused || undefined}
        className={cn(
          'absolute inset-y-1 overflow-hidden rounded-lg py-1.5 text-start',
          focused
            ? 'bg-white text-black'
            : airing
              ? 'bg-white/15 hover:bg-white/20'
              : 'bg-white/[0.07] hover:bg-white/15',
          gone && !focused && 'text-[--muted] opacity-60'
        )}
        style={
          {
            left: CHANNEL_COLUMN + x + 2,
            width: Math.max(0, w - 4),
            '--x': `${x}px`,
            '--w': `${w}px`,
          } as React.CSSProperties
        }
      >
        <div data-name="text" className="pe-2">
          <p className="truncate text-sm font-semibold">{p.Name}</p>
          <p
            className={cn(
              'truncate text-xs tabular-nums',
              focused ? 'text-black/70' : 'text-[--muted]'
            )}
          >
            {reminded.has(p.Id!) && (
              <BiBell aria-label={t`Reminder`} className="me-1 inline" />
            )}
            {p.StartDate && airTime(p.StartDate)}
          </p>
        </div>
      </div>
    );
  }
  const empty = channel && !programmes?.length;
  return (
    <div
      role="row"
      data-ui="guide-row"
      data-playing={playing || undefined}
      className="absolute inset-x-0"
      style={{ top: RULER + index * ROW, height: ROW }}
    >
      <div
        data-ui="guide-channel"
        data-row={index}
        className="sticky start-0 z-[2] flex h-full items-center gap-2 bg-[--background] pe-2"
        style={{ width: CHANNEL_COLUMN }}
      >
        {channel ? (
          <>
            <span className="w-8 flex-none text-end text-xs tabular-nums text-[--muted]">
              {channel.ChannelNumber}
            </span>
            <div className="relative flex h-10 w-16 flex-none items-center justify-center overflow-hidden rounded-md bg-white/5">
              {logo && (
                <CachedImage
                  src={logo}
                  alt=""
                  className="h-full w-full object-contain p-1"
                />
              )}
              {playing && (
                <span className="absolute end-1 top-1 size-2 rounded-full bg-brand-500" />
              )}
            </div>
            <span className="line-clamp-2 min-w-0 text-sm font-semibold leading-tight [overflow-wrap:anywhere]">
              {channel.Name}
            </span>
          </>
        ) : (
          <div className="h-10 w-full animate-pulse rounded-md bg-white/5" />
        )}
      </div>
      {cells}
      {empty && (
        <div
          role="gridcell"
          data-ui="guide-cell"
          data-row={index}
          data-active={focusAt !== undefined || undefined}
          data-focus-frame={focusAt !== undefined || undefined}
          className={cn(
            'absolute inset-y-1 flex items-center overflow-hidden rounded-lg text-sm',
            focusAt !== undefined
              ? 'bg-white text-black'
              : 'bg-white/[0.04] text-[--muted]'
          )}
          style={
            {
              left: CHANNEL_COLUMN + 2,
              width: xOf(dayEnd, dayStart) - 4,
              '--x': '0px',
              '--w': `${xOf(dayEnd, dayStart)}px`,
            } as React.CSSProperties
          }
        >
          <span data-name="text" className="truncate">
            {channel?.Name}
          </span>
        </div>
      )}
    </div>
  );
});
