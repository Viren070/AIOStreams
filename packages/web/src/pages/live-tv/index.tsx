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
  lastGroup,
  rememberGroup,
  useChannelGroups,
  useChannelPages,
  useNow,
  useSchedules,
  airingAt,
} from '../../lib/live-tv';
import { lastVersions } from '../../lib/playback/play';
import {
  canPreview,
  expandPlayback,
  playDocked,
  usePlayback,
} from '../../lib/playback/session';
import { navigate, to } from '../../lib/paths';
import type { BaseItemDto } from '../../lib/types';
import { PageMessage } from '../../components/layout';
import { PillTabs } from '../../components/pill-tabs';
import { useVersionPicker } from '../../components/version-picker';
import { BATCH, ChannelList } from './channel-list';
import { ChannelDetails, Preview } from './channel-details';

const WIDE = '(min-width: 1024px)';
/** Moving through the list waits this long before the details follow. */
const DETAILS_DELAY_MS = 150;

/** The window less the bars around the page, so only the list scrolls. */
const PAGE_HEIGHT =
  'h-[calc(100dvh-var(--nav-bar)-var(--mini-bar,0px)-var(--top-bar,0px))]';

function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

function batchesOf(channels: BaseItemDto[], first: number, last: number) {
  const batches: string[][] = [];
  for (let b = Math.floor(first / BATCH); b <= Math.floor(last / BATCH); b++)
    batches.push(channels.slice(b * BATCH, (b + 1) * BATCH).map((c) => c.Id!));
  return batches.filter((ids) => ids.length);
}

export function LiveTvPage({ group: requested }: { group?: string }) {
  const view = useLiveTvView();
  const { groups, isLoading: groupsLoading } = useChannelGroups();
  const wanted = requested ?? lastGroup();
  const group = groups.some((g) => g.id === wanted)
    ? wanted
    : groupsLoading
      ? wanted
      : ALL;
  const pages = useChannelPages(group, { enabled: !!view.data });
  const channels = React.useMemo(
    () => pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [],
    [pages.data]
  );
  const total = pages.data?.pages.at(-1)?.TotalRecordCount ?? channels.length;
  const now = useNow();
  const playback = usePlayback();
  const docked = !!playback?.mini;
  const playingId = docked ? playback.itemId : undefined;
  const wide = useMediaQuery(WIDE);
  const picker = useVersionPicker();

  const [active, setActive] = React.useState(0);
  // A group opens on the channel playing, where it is listed.
  const placed = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!pages.data || placed.current === group) return;
    placed.current = group;
    const at = channels.findIndex((c) => c.Id === playingId);
    setActive(Math.max(0, at));
  }, [pages.data, group, channels, playingId]);

  const [range, setRange] = React.useState({ first: 0, last: 0 });
  const onRange = React.useCallback(
    (first: number, last: number) => setRange({ first, last }),
    []
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
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
  const batches = React.useMemo(
    () => batchesOf(channels, range.first, range.last),
    [channels, range.first, range.last]
  );
  const schedules = useSchedules(batches);

  const shown = useSettled(channels[active], DETAILS_DELAY_MS);
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
  const watchShown = () => {
    if (!shown) return;
    if (docked && playingId === shown.Id) expandPlayback();
    else play(shown);
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

  const list =
    pages.isLoading || view.isLoading ? (
      <div className="space-y-2 p-1">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
        ))}
      </div>
    ) : channels.length ? (
      <ChannelList
        className="min-h-0 flex-1"
        channels={channels}
        total={Math.max(total, channels.length)}
        schedules={schedules}
        now={now}
        active={Math.min(active, channels.length - 1)}
        playingId={playingId}
        onActive={setActive}
        onPlay={(channel) =>
          docked && channel.Id === playingId ? expandPlayback() : play(channel)
        }
        onRange={onRange}
      />
    ) : (
      <p className="p-4 text-[--muted]">
        <Trans>No channels in this group.</Trans>
      </p>
    );

  return (
    <div
      data-ui="live-tv"
      className={cn(
        'relative z-[1] flex flex-col gap-4 px-4 pt-[calc(1rem+env(safe-area-inset-top))] lg:ps-0 lg:pe-10 lg:pt-[calc(2rem+env(safe-area-inset-top))]',
        PAGE_HEIGHT
      )}
    >
      <header className="flex flex-none flex-col gap-3">
        <h1 data-ui="page-title" className="text-3xl font-bold">
          <Trans>Live TV</Trans>
        </h1>
        <PillTabs
          name="live-group"
          options={groups.map((g) => ({ value: g.id, label: g.name }))}
          value={group}
          onChange={(next) => {
            rememberGroup(next);
            navigate(to.live(next), { replace: true });
          }}
        />
      </header>
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
              onPress={docked ? expandPlayback : watchShown}
              // A short window keeps room for the programme under it.
              className="w-[min(100%,64dvh)] flex-none"
            />
            {shown && (
              <ChannelDetails
                channel={shown}
                programmes={shownProgrammes}
                now={now}
                playing={docked && playingId === shown.Id}
                onWatch={watchShown}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
