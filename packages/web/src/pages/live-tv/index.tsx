import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useLiveTvView } from '../../lib/queries';
import {
  ALL,
  FAVOURITES,
  RECENT,
  airingAt,
  endOf,
  lastGroup,
  lastChannelId,
  lastView,
  rememberChannel,
  rememberGroup,
  rememberView,
  setLineup,
  startOf,
  caughtUp,
  useChannelByNumber,
  useChannelGroups,
  useGuideRange,
  useReminders,
  useChannelPages,
  useNow,
  type LiveView,
} from '../../lib/live-tv';
import { currentHost } from '../../lib/hosts';
import { airTime, dayLabel } from '../../lib/format';
import { toast } from 'sonner';
import { lastVersions } from '../../lib/playback/play';
import {
  canPreview,
  expandPlayback,
  playDocked,
  usePlayback,
} from '../../lib/playback/session';
import { navigate, to } from '../../lib/paths';
import { focusOn, isTextField, useAction } from '../../lib/input';
import { NumberEntry, useNumberEntry } from '../../components/channel-number';
import type { BaseItemDto } from '../../lib/types';
import { PageMessage } from '../../components/layout';
import { fitsAsPills, PillTabs } from '../../components/pill-tabs';
import { Combobox } from '@aiostreams/ui/combobox';
import { Select } from '@aiostreams/ui/select';
import { useVersionPicker } from '../../components/version-picker';
import {
  BATCH,
  ChannelList,
  useRowSchedules,
} from '../../components/channel-list';
import { ChannelDetails, Preview, ProgrammeDetails } from './channel-details';
import { Guide, programmeAt } from './guide';

const WIDE = '(min-width: 1024px)';
const OWN_GROUPS = new Set([FAVOURITES, RECENT, ALL]);
/** How many more pages a typed number, or a return, loads to find its channel. */
const NUMBER_PAGES = 20;
const DAY_MS = 86_400_000;
/** The days ahead the guide offers, as far as servers keep programmes. */
const GUIDE_DAYS = 7;
/** Moving through the list waits this long before the details follow. */
const DETAILS_DELAY_MS = 150;

/** The window less the bars around the page, so only the list scrolls. */
const PAGE_HEIGHT =
  'h-[calc(100dvh-var(--nav-bar)-var(--mini-bar,0px)-var(--top-bar,0px))]';
const PAGE = cn(
  'relative z-[1] flex flex-col gap-4 px-4 pt-[calc(1rem+env(safe-area-inset-top))] lg:ps-0 lg:pe-10 lg:pt-[calc(2rem+env(safe-area-inset-top))]',
  PAGE_HEIGHT
);

const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0);

function dayName(offset: number, dayStart: number): string {
  if (offset === 0) return t`Today`;
  if (offset === 1) return t`Tomorrow`;
  if (offset === -1) return t`Yesterday`;
  return dayLabel(new Date(dayStart).toISOString());
}

/** Days from today the guide covers, by the server's range where it has one. */
function dayOffsets(
  today: number,
  range: { from: number; to: number } | undefined
): number[] {
  const count = (from: number, to: number) => Math.round((to - from) / DAY_MS);
  const back =
    range && range.from < today ? count(midnight(range.from), today) : 0;
  const ahead = range && range.to > today ? count(today, range.to) : GUIDE_DAYS;
  return Array.from({ length: back + ahead }, (_, i) => i - back);
}

function DayPicker({
  days,
  value,
  onChange,
}: {
  days: { value: number; label: string }[];
  value: number;
  onChange(offset: number): void;
}) {
  return (
    <div className="w-44">
      <Select
        data-ui="live-day-picker"
        aria-label={t`Day`}
        className="rounded-full"
        options={days.map((d) => ({ value: String(d.value), label: d.label }))}
        value={String(value)}
        onValueChange={(next) => next && onChange(Number(next))}
      />
    </div>
  );
}

export function LiveTvPage({
  group: requested,
  view: requestedView,
}: {
  group?: string;
  view?: string;
}) {
  const view = useLiveTvView();
  const { groups, isLoading: groupsLoading } = useChannelGroups();
  const wanted = requested ?? lastGroup();
  const group = groups.some((g) => g.id === wanted)
    ? wanted
    : groupsLoading
      ? wanted
      : ALL;
  const pages = useChannelPages(group, { enabled: !!view.data });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const channels = React.useMemo(
    () => pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [],
    [pages.data]
  );
  const total = pages.data?.pages.at(-1)?.TotalRecordCount ?? channels.length;
  React.useEffect(() => setLineup(channels), [channels]);
  const now = useNow();
  const playback = usePlayback();
  const docked = !!playback?.mini;
  const playingId = docked ? playback.itemId : undefined;
  const wide = useMediaQuery(WIDE);
  const picker = useVersionPicker();

  // The grid wants a wide screen, and is a TV's only once measured on one.
  const shownView: LiveView =
    requestedView === 'guide' || requestedView === 'list'
      ? requestedView
      : (lastView() ?? (currentHost().tv ? 'list' : 'guide'));
  // Addons without a guide list channels with nothing on, which would leave the
  // guide empty rows; the lineup's first page tells, and the guide waits for it.
  const lineupStart = useChannelPages(ALL, { enabled: !!view.data });
  const hasGuide = !!lineupStart.data?.pages[0]?.Items?.some(
    (c) => c.CurrentProgram
  );
  const guide = wide && shownView === 'guide' && hasGuide;
  const guideRange = useGuideRange().data;
  const reminders = useReminders();
  const reminded = React.useMemo(
    () => new Set(reminders.list.map((r) => r.id)),
    [reminders.list]
  );
  const [dayOffset, setDayOffset] = React.useState(0);
  const today = midnight(now);
  const dayStart = new Date(today).setDate(
    new Date(today).getDate() + dayOffset
  );
  const [at, setAt] = React.useState(now);

  const [active, setActive] = React.useState(0);
  // The guide and the list move the keys themselves, and the page follows
  // once they rest, so a press redraws only them.
  const following = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(following.current), []);
  // The page puts the keys somewhere on opening, on a typed number and on
  // another day; a view opens where the page last followed them to.
  const [jumps, setJumps] = React.useState(0);
  const place = (row: number, time = at) => {
    clearTimeout(following.current);
    setActive(row);
    setAt(time);
    setJumps((n) => n + 1);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only a jump or another view moves the keys
  const focusFrom = React.useMemo(() => ({ row: active, at }), [jumps, guide]);
  const follow = (row: number, time = at) => {
    rememberChannel(channels[row]?.Id);
    clearTimeout(following.current);
    following.current = setTimeout(() => {
      setActive(row);
      setAt(time);
    }, DETAILS_DELAY_MS);
  };

  /** The channel's index, loading on to it with `pages` left to read. */
  const indexOf = async (match: (c: BaseItemDto) => boolean, pages = 0) => {
    let list = channels;
    let more = hasNextPage;
    let index = list.findIndex(match);
    for (let page = 0; index < 0 && more && page < pages; page++) {
      const next = await fetchNextPage();
      list = next.data?.pages.flatMap((p) => p.Items ?? []) ?? list;
      more = next.hasNextPage;
      index = list.findIndex(match);
    }
    return index;
  };
  const focusChannels = () => {
    const grid = document.querySelector<HTMLElement>(
      '[data-ui=guide], [data-ui=channel-list]'
    );
    if (grid) focusOn(grid);
  };
  // Back from the player, the page opens on the channel it was left on, loading
  // on to it; another group looks among what it has, unless a number sent it there.
  const placed = React.useRef<string | null>(null);
  const seeking = React.useRef(false);
  React.useEffect(() => {
    if (!pages.data || placed.current === group) return;
    const far = placed.current === null || seeking.current;
    const typed = seeking.current;
    placed.current = group;
    seeking.current = false;
    const id = lastChannelId() ?? playingId;
    void indexOf((c) => c.Id === id, id && far ? NUMBER_PAGES : 0).then(
      (index) => {
        place(Math.max(0, index));
        if (typed) focusChannels();
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per group
  }, [pages.data, group]);

  const { schedules, onRange, range } = useRowSchedules(channels, {
    ...(guide && { from: dayStart, to: dayStart + DAY_MS }),
    pinned: active,
  });
  React.useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      Math.max(range.last, active) >= channels.length - BATCH
    )
      void fetchNextPage();
  }, [
    range.last,
    active,
    channels.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  const shown = channels[active] as BaseItemDto | undefined;
  const shownProgrammes = shown ? schedules.get(shown.Id!) : undefined;

  const play = (channel: BaseItemDto) => {
    if (canPreview())
      playDocked({
        itemId: channel.Id!,
        sourceId: lastVersions.get(channel.Id!) ?? '',
        startMs: 0,
      });
    else picker.play(channel);
  };
  const watch = (channel: BaseItemDto) => {
    if (docked && playingId === channel.Id) expandPlayback();
    else play(channel);
  };
  // Up from the channels lands on the group they are from, which a pill
  // focused on the way would pick instead.
  const leaveUp = () => {
    const target =
      document.querySelector<HTMLElement>(
        '[data-name=live-group] [aria-selected=true]'
      ) ?? document.querySelector<HTMLElement>('[data-ui=live-group-picker]');
    if (target) focusOn(target);
  };
  // A remote's digits go to the channel with that number, loading on to it.
  // Numbers run through the whole lineup, so one outside the group opens All
  // channels on it.
  const byNumber = useChannelByNumber();
  const goToNumber = async (number: string) => {
    const index = await indexOf(
      (c) => c.ChannelNumber === number,
      NUMBER_PAGES
    );
    if (index >= 0) {
      rememberChannel(channels[index]?.Id);
      place(index);
      focusChannels();
      return true;
    }
    if (group === ALL) return false;
    const channel = await byNumber(number);
    if (!channel) return false;
    rememberChannel(channel.Id);
    seeking.current = true;
    chooseGroup(ALL);
    return true;
  };
  const numbers = useNumberEntry(goToNumber, (text) => toast(text));
  useAction('player.jump', (digit) => {
    if (isTextField(document.activeElement)) return false;
    numbers.type(digit);
  });
  // The guide and the list keep their keys from the actions, digits with them.
  const onDigit = (e: React.KeyboardEvent) => {
    const keyed = (e.target as Element).closest('[role=grid], [role=listbox]');
    if (!keyed || !/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    numbers.type(e.key);
  };
  const fromStart = (programme: BaseItemDto) => {
    if (canPreview())
      playDocked({ itemId: programme.Id!, sourceId: '', startMs: 0 });
    else picker.play(programme);
  };
  const remind = (programme: BaseItemDto) => {
    const time = (programme.StartDate && airTime(programme.StartDate)) ?? '';
    if (reminders.toggle(programme))
      toast.success(t`You'll be reminded at ${time}`);
    else toast(t`Reminder removed`);
  };
  // One on now plays its channel, an earlier one from its start where the
  // channel keeps it, and a later one sets a reminder.
  const playFromGuide = (channel: BaseItemDto, programme?: BaseItemDto) => {
    if (!programme || (startOf(programme) <= now && now < endOf(programme)))
      watch(channel);
    else if (startOf(programme) > now) remind(programme);
    else if (caughtUp(programme)) fromStart(programme);
  };

  if (view.isError)
    return (
      <PageMessage>
        <LuffyError title={t`Could not load Live TV`} />
      </PageMessage>
    );
  if (!view.isLoading && !view.data)
    return (
      <PageMessage>
        <LuffyError title={t`No live TV here`} className="mt-0">
          <p className="text-sm text-[--muted]">
            <Trans>
              Channels show here once your setup has an addon with live TV.
            </Trans>
          </p>
        </LuffyError>
      </PageMessage>
    );

  const loading = pages.isLoading || view.isLoading;
  const days = dayOffsets(today, guideRange).map((offset) => ({
    value: offset,
    label: dayName(
      offset,
      new Date(today).setDate(new Date(today).getDate() + offset)
    ),
  }));
  const ownGroups = groups.filter((g) => OWN_GROUPS.has(g.id));
  const addonGroups = groups.filter((g) => !OWN_GROUPS.has(g.id));
  // Many groups go in a searchable picker, after the app's own.
  const picked = !fitsAsPills(addonGroups.map((g) => g.name));
  const chooseGroup = (next: string) => {
    rememberGroup(next);
    navigate(to.live({ group: next, view: requestedView }), {
      replace: true,
    });
  };
  const empty = !loading && !channels.length && (
    <p className="p-4 text-[--muted]">
      <Trans>No channels in this group.</Trans>
    </p>
  );
  const numberShown = numbers.typed && (
    <NumberEntry typed={numbers.typed} className="fixed z-50" />
  );
  // One row of controls, so the day and the view are a few presses on from the group.
  const header = (
    <header className="flex flex-none flex-col gap-3">
      <h1 data-ui="page-title" className="text-3xl font-bold">
        <Trans>Live TV</Trans>
      </h1>
      <div
        data-ui="live-controls"
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        <PillTabs
          name="live-group"
          options={(picked ? ownGroups : groups).map((g) => ({
            value: g.id,
            label: g.name,
          }))}
          value={group}
          onChange={chooseGroup}
        />
        {picked && (
          <div className="w-full sm:w-64">
            <Combobox
              data-ui="live-group-picker"
              aria-label={t`Group`}
              placeholder={t`Groups`}
              emptyMessage={t`Nothing matches.`}
              keepOpenOnSelect={false}
              className="rounded-full"
              options={addonGroups.map((g) => ({
                value: g.id,
                label: g.name,
                textValue: g.name,
              }))}
              value={addonGroups.some((g) => g.id === group) ? [group] : []}
              onValueChange={(next) => next[0] && chooseGroup(next[0])}
            />
          </div>
        )}
        <div className="ms-auto" />
        {guide && (
          <DayPicker
            days={days}
            value={dayOffset}
            onChange={(offset) => {
              setDayOffset(offset);
              // Another day opens at the same time of day.
              place(
                active,
                new Date(now).setDate(new Date(now).getDate() + offset)
              );
            }}
          />
        )}
        {wide && hasGuide && (
          <PillTabs
            name="live-view"
            options={[
              { value: 'guide' as const, label: t`Guide` },
              { value: 'list' as const, label: t`Channels` },
            ]}
            value={shownView}
            onChange={(next) => {
              rememberView(next);
              navigate(to.live({ group: requested, view: next }), {
                replace: true,
              });
            }}
          />
        )}
      </div>
    </header>
  );

  if (guide) {
    const programme = programmeAt(shownProgrammes, at);
    return (
      <div
        data-ui="live-tv"
        data-view="guide"
        className={PAGE}
        onKeyDown={onDigit}
      >
        {numberShown}
        {header}
        <div
          data-ui="live-top"
          className="flex h-[min(34%,20rem)] flex-none gap-6"
        >
          {shown ? (
            <ProgrammeDetails
              className="flex-1"
              channel={shown}
              programme={programme}
              now={now}
              playing={docked && playingId === shown.Id}
              onWatch={() => watch(shown)}
              onFromStart={() => programme && fromStart(programme)}
              reminded={reminders.has(programme?.Id)}
              onRemind={() => programme && remind(programme)}
            />
          ) : (
            <div className="flex-1" />
          )}
          <Preview
            channel={shown}
            programme={programme}
            playing={docked}
            onPress={() => (docked ? expandPlayback() : shown && watch(shown))}
            className="h-full w-auto flex-none"
          />
        </div>
        {loading ? (
          <Skeleton className="min-h-0 flex-1 rounded-xl" />
        ) : (
          empty || (
            <div data-nav-start className="flex min-h-0 flex-1 flex-col pb-4">
              <Guide
                className="min-h-0 flex-1"
                channels={channels}
                total={Math.max(total, channels.length)}
                schedules={schedules}
                dayStart={dayStart}
                now={now}
                placed={focusFrom}
                playingId={playingId}
                onFocus={(next) => follow(next.row, next.at)}
                onPlay={playFromGuide}
                onRange={onRange}
                onLeaveUp={leaveUp}
                reminded={reminded}
              />
            </div>
          )
        )}
      </div>
    );
  }

  const list = loading ? (
    <div className="space-y-2 p-1">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
      ))}
    </div>
  ) : (
    empty || (
      <ChannelList
        className="min-h-0 flex-1"
        channels={channels}
        total={Math.max(total, channels.length)}
        schedules={schedules}
        now={now}
        placed={focusFrom}
        playingId={playingId}
        onActive={follow}
        onLeaveUp={leaveUp}
        onPlay={watch}
        onRange={onRange}
      />
    )
  );

  return (
    <div
      data-ui="live-tv"
      data-view="list"
      className={PAGE}
      onKeyDown={onDigit}
    >
      {numberShown}
      {header}
      {!wide && docked && (
        <Preview playing onPress={expandPlayback} className="flex-none" />
      )}
      <div className="flex min-h-0 flex-1 gap-8">
        <div
          data-nav-start
          className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-w-md xl:max-w-xl"
        >
          {list}
        </div>
        {wide && (
          <aside
            data-ui="live-side"
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 pb-6"
          >
            <Preview
              channel={shown}
              programme={
                shownProgrammes ? airingAt(shownProgrammes, now) : undefined
              }
              playing={docked}
              onPress={() =>
                docked ? expandPlayback() : shown && watch(shown)
              }
              // A short window keeps room for the programme under it.
              className="w-[min(100%,64dvh)] flex-none"
            />
            {shown && (
              <ChannelDetails
                channel={shown}
                programmes={shownProgrammes}
                now={now}
                playing={docked && playingId === shown.Id}
                onWatch={() => watch(shown)}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
