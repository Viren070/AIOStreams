import React from 'react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { useCalendar } from '../lib/queries';
import {
  airDay,
  airTime,
  episodeCode,
  itemSubtitle,
  itemTitle,
} from '../lib/format';
import { landscapeUrls } from '../lib/images';
import { href, itemPath, navigate, to } from '../lib/paths';
import { PageBody } from '../components/layout';
import { Artwork } from '../components/cards';
import type { BaseItemDto } from '../lib/types';
import { Anchor } from '../components/anchor';

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(d: Date): string {
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseMonth(month: string | undefined): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  const now = new Date();
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);
}

/** The locale's first day of the week, as `Date.getDay` numbers it; Monday where unknown. */
function weekStart(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?(): { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return firstDay ? firstDay % 7 : 1;
  } catch {
    return 1;
  }
}

function gridDays(first: Date, startDay: number): Date[] {
  const lead = (first.getDay() - startDay + 7) % 7;
  const inMonth = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0
  ).getDate();
  return Array.from({ length: Math.ceil((lead + inMonth) / 7) * 7 }, (_, i) => {
    const d = new Date(first);
    d.setDate(1 - lead + i);
    return d;
  });
}

function longDay(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function EpisodeRow({ item }: { item: BaseItemDto }) {
  const { client } = useSession();
  const played = !!item.UserData?.Played;
  return (
    <Anchor
      href={href(itemPath(item))}
      data-ui="calendar-entry"
      data-watched={played || undefined}
      data-focus="own"
      className={cn(
        'flex items-center gap-3 rounded-xl p-1 transition-colors hover:bg-white/5 focus-visible:bg-white/10',
        played && 'text-[--muted]'
      )}
    >
      <div className="relative aspect-video w-28 flex-none overflow-hidden rounded-lg bg-gray-900">
        <Artwork
          src={(width) => landscapeUrls(client, item, { maxWidth: width })}
          alt={itemTitle(item)}
        />
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{itemTitle(item)}</p>
        <p className="truncate text-sm text-[--muted]">
          {[itemSubtitle(item), item.PremiereDate && airTime(item.PremiereDate)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </Anchor>
  );
}

const SHOWN_PER_DAY = 2;

function DayCell({
  day,
  items,
  outside,
  today,
  onOpen,
}: {
  day: Date;
  items: BaseItemDto[];
  outside: boolean;
  today: boolean;
  onOpen(): void;
}) {
  const { client } = useSession();
  const [hovered, setHovered] = React.useState<BaseItemDto>();
  const listed = items.slice(0, SHOWN_PER_DAY);
  const shown = hovered ?? items[0];
  const extra = items.length - SHOWN_PER_DAY;
  return (
    <div
      data-ui="calendar-day"
      data-today={today || undefined}
      role={items.length ? 'button' : undefined}
      tabIndex={items.length ? 0 : undefined}
      onClick={items.length ? onOpen : undefined}
      onKeyDown={(e) => {
        if (items.length && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group/day relative flex h-40 min-w-0 flex-col justify-between overflow-hidden rounded-lg bg-white/[0.03] p-2 transition-colors',
        items.length && 'cursor-pointer hover:bg-white/[0.05]',
        outside && 'opacity-30 focus-within:opacity-100'
      )}
    >
      {shown && (
        // Every listed episode's art is kept, so hovering one fades between them.
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {listed.map((item) => (
            <div
              key={item.Id}
              className={cn(
                'absolute inset-0 transition-opacity duration-500',
                item !== shown
                  ? 'opacity-0'
                  : today
                    ? 'opacity-85'
                    : 'opacity-50 group-hover/day:opacity-65'
              )}
            >
              <Artwork
                src={(width) =>
                  landscapeUrls(client, item, { maxWidth: width })
                }
                alt=""
              />
            </div>
          ))}
          <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/70 via-35% to-transparent to-70%" />
        </div>
      )}
      <span
        className={cn(
          'relative flex size-7 items-center justify-center rounded-full text-sm font-semibold',
          today
            ? 'bg-brand-500 text-white'
            : 'text-gray-200 [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]'
        )}
      >
        {day.getDate()}
      </span>
      <ol className="relative space-y-1">
        {listed.map((item) => (
          <li key={item.Id}>
            <Anchor
              href={href(itemPath(item))}
              data-ui="calendar-entry"
              data-watched={item.UserData?.Played || undefined}
              data-focus="own"
              onClick={(e) => e.stopPropagation()}
              onPointerEnter={() => setHovered(item)}
              onPointerLeave={() => setHovered(undefined)}
              className="block min-w-0 rounded-md px-1 transition-colors duration-200 hover:bg-white/10 focus-visible:bg-white/20 focus-visible:[&_p]:text-white"
            >
              <p
                className={cn(
                  'truncate text-sm font-medium',
                  item.UserData?.Played ? 'text-[--muted]' : 'text-gray-100'
                )}
              >
                {itemTitle(item)}
              </p>
              <p className="truncate text-xs text-[--muted]">
                {[
                  episodeCode(item.ParentIndexNumber, item.IndexNumber),
                  item.PremiereDate && airTime(item.PremiereDate),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </Anchor>
          </li>
        ))}
        {extra > 0 && (
          <li className="px-1 text-xs text-[--muted]">+{extra} more</li>
        )}
      </ol>
    </div>
  );
}

function MonthGrid({
  days,
  month,
  byDay,
  onOpen,
}: {
  days: Date[];
  month: number;
  byDay: Map<string, BaseItemDto[]>;
  onOpen(day: Date): void;
}) {
  const today = dayKey(new Date());
  return (
    <div
      data-ui="calendar-grid"
      className="space-y-2 rounded-xl border border-white/10 bg-gray-950/40 p-2"
    >
      <div className="grid grid-cols-7 gap-2">
        {days.slice(0, 7).map((d) => (
          <div
            key={d.getDay()}
            className="py-1 text-center text-xs font-semibold uppercase tracking-wide text-[--muted]"
          >
            {d.toLocaleDateString(undefined, { weekday: 'short' })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => (
          <DayCell
            key={dayKey(d)}
            day={d}
            items={byDay.get(dayKey(d)) ?? []}
            outside={d.getMonth() !== month}
            today={dayKey(d) === today}
            onOpen={() => onOpen(d)}
          />
        ))}
      </div>
    </div>
  );
}

function Agenda({
  days,
  month,
  byDay,
}: {
  days: Date[];
  month: number;
  byDay: Map<string, BaseItemDto[]>;
}) {
  const today = dayKey(new Date());
  const shown = days.filter(
    (d) => d.getMonth() === month && byDay.has(dayKey(d))
  );
  return (
    <div data-ui="calendar-agenda" className="space-y-5">
      {shown.map((d) => (
        <section key={dayKey(d)} className="space-y-2">
          <h2
            className={cn(
              'text-sm font-semibold',
              dayKey(d) === today ? 'text-white' : 'text-[--muted]'
            )}
          >
            {longDay(d)}
          </h2>
          {byDay.get(dayKey(d))!.map((item) => (
            <EpisodeRow key={item.Id} item={item} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function CalendarPage({ month }: { month?: string }) {
  const first = parseMonth(month);
  const days = gridDays(first, React.useMemo(weekStart, []));
  const [openDay, setOpenDay] = React.useState<Date | null>(null);
  // A day either side, for dates that arrive as midnight UTC.
  const from = new Date(days[0]);
  from.setDate(from.getDate() - 1);
  const until = new Date(days[days.length - 1]);
  until.setDate(until.getDate() + 2);
  const calendar = useCalendar(from, until);

  const byDay = new Map<string, BaseItemDto[]>();
  for (const item of calendar.data?.Items ?? []) {
    if (!item.PremiereDate) continue;
    const key = dayKey(airDay(item.PremiereDate));
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const inMonth = days.some(
    (d) => d.getMonth() === first.getMonth() && byDay.has(dayKey(d))
  );
  const go = (offset: number) =>
    navigate(
      to.calendar(
        monthKey(new Date(first.getFullYear(), first.getMonth() + offset, 1))
      ),
      { replace: true }
    );

  return (
    <PageBody>
      <div className="space-y-6">
        <div
          data-ui="page-header"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <h1 data-ui="page-title" className="text-3xl font-bold">
            Calendar
          </h1>
          <div className="flex items-center gap-1">
            <IconButton
              size="sm"
              intent="gray-subtle"
              className="rounded-full"
              icon={<LuChevronLeft />}
              aria-label="Previous month"
              onClick={() => go(-1)}
            />
            <IconButton
              size="sm"
              intent="gray-subtle"
              className="rounded-full"
              icon={<LuChevronRight />}
              aria-label="Next month"
              onClick={() => go(1)}
            />
            <span className="ml-2 text-lg font-semibold">
              {first.toLocaleDateString(undefined, {
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
          {monthKey(first) !== monthKey(new Date()) && (
            <Button
              size="sm"
              intent="gray-outline"
              className="rounded-full"
              onClick={() => navigate(to.calendar(), { replace: true })}
            >
              Today
            </Button>
          )}
        </div>

        {calendar.isError ? (
          <LuffyError title="Could not load the calendar" />
        ) : calendar.isLoading ? (
          <Skeleton className="h-[40rem] w-full rounded-xl" />
        ) : (
          <>
            <div className="hidden md:block">
              <MonthGrid
                days={days}
                month={first.getMonth()}
                byDay={byDay}
                onOpen={setOpenDay}
              />
            </div>
            <div className="md:hidden">
              <Agenda days={days} month={first.getMonth()} byDay={byDay} />
            </div>
            {!inMonth && (
              <p className="text-[--muted]">
                Nothing airs this month from your shows or watchlist.
              </p>
            )}
          </>
        )}
      </div>
      <Modal
        data-ui="dialog"
        data-name="calendar-day"
        open={!!openDay}
        onOpenChange={(open) => !open && setOpenDay(null)}
        title={openDay ? longDay(openDay) : undefined}
        contentClass="max-w-lg"
      >
        <div className="space-y-1">
          {(openDay ? (byDay.get(dayKey(openDay)) ?? []) : []).map((item) => (
            <EpisodeRow key={item.Id} item={item} />
          ))}
        </div>
      </Modal>
    </PageBody>
  );
}
