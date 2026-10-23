import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../lib/session';
import { currentHost } from '../../lib/hosts';
import { usePlaybackInfoOptions } from '../../lib/queries';
import { usePlaylistName, useUpNext, type UpNext } from '../../lib/playlists';
import type { PartyNeighbours } from '../../lib/party/follow';
import { landscapeUrl } from '../../lib/images';
import {
  episodeCode,
  fullTitle,
  itemSubtitle,
  itemTitle,
  ticksToMs,
} from '../../lib/format';
import { navigate, to, versionsPath } from '../../lib/paths';
import { playableSources } from '../../lib/playback/play';
import { playerUrl, requiredHeaders } from '../../lib/playback/stream';
import { useFindDownloaded } from '../../lib/downloads';
import {
  focusOn,
  inputCount,
  keyboardFocus,
  noteInput,
  useAction,
} from '../../lib/input';
import { settings, useSetting, type NextPrompt } from '../../lib/settings';
import { usePlaybackPrefs } from '../../lib/user-config';
import { useLatest } from '../../lib/use-latest';
import type { PlayerController } from '../../lib/playback/controller';
import type { BaseItemDto, MediaSegmentDto, SourceInfo } from '../../lib/types';
import { CachedImage } from '../cached-image';
import { PlayerAction } from './buttons';
import { usePlayhead } from '../../lib/playback/playhead';

/** One notice, which a later press takes over. */
const NOTICE = 'episode-versions';

/** Sonner adds a toast on a timer but drops one on the next frame, which can come first. */
function dismissNotice() {
  setTimeout(() => toast.dismiss(NOTICE));
}

/** Shorter than this, a video gets no prompt. */
const MIN_DURATION_MS = 40_000;
/** Credits count as the end when they finish this close to it. */
const CREDITS_TAIL_MS = 30_000;
/** How long before the next episode comes up its versions are looked up. */
const LIST_LEAD_MS = 2 * 60_000;
/** With no prompt, how long before the end the version that plays on is opened. */
const OPEN_LEAD_MS = 30_000;

/**
 * When the prompt shows: at the credits when they end the video, else `lead`
 * seconds before the end.
 */
/** A segment ending in the episode's last stretch, whose credits the next episode's card can take over. */
export const endsEpisode = (durationMs: number, endMs: number) =>
  endMs >= durationMs * 0.9 && durationMs - endMs <= CREDITS_TAIL_MS;

function promptAt(
  durationMs: number,
  outro: MediaSegmentDto | undefined,
  prompt: NextPrompt,
  lead: number
): number | null {
  if (prompt === 'off' || durationMs < MIN_DURATION_MS) return null;
  if (prompt === 'credits' && outro) {
    const start = ticksToMs(outro.StartTicks);
    const end = ticksToMs(outro.EndTicks);
    if (endsEpisode(durationMs, end)) return start;
  }
  return durationMs - lead * 1000;
}

/**
 * The version of what plays next that carries on from this one: the one in
 * the same binge group, else the only or first one when allowed.
 */
function carryOn(
  sources: SourceInfo[],
  current: SourceInfo,
  fallbackFirst: boolean
): SourceInfo | undefined {
  const group = current.aiostreams?.bingeGroup;
  const same = group
    ? sources.find((s) => s.aiostreams?.bingeGroup === group)
    : undefined;
  return (
    same ?? (sources.length === 1 || fallbackFirst ? sources[0] : undefined)
  );
}

function resumeMs(item: BaseItemDto): number {
  return item.UserData?.Played
    ? 0
    : ticksToMs(item.UserData?.PlaybackPositionTicks);
}

/** Titles the player moved on to by itself since the last input it saw. */
const unattended = { titles: 0, inputs: -1 };

function unattendedTitles(): number {
  const inputs = inputCount();
  if (inputs !== unattended.inputs) {
    unattended.titles = 0;
    unattended.inputs = inputs;
  }
  return unattended.titles;
}

export function countPlayedOn(): void {
  unattendedTitles();
  unattended.titles++;
}

/** Whether playing on now would make `limit` titles in a row with nobody there. */
function asksFirst(limit: number): boolean {
  return limit > 0 && unattendedTitles() + 1 >= limit;
}

/** In a party, what plays either side is its queue's, for everyone. */
function partyUpNext(
  item: BaseItemDto,
  queued: PartyNeighbours | undefined
): UpNext {
  const next = queued?.next ?? null;
  const previous = queued?.previous ?? null;
  const step = next ?? previous;
  const listed =
    !!step && (step.Type !== 'Episode' || step.SeriesId !== item.SeriesId);
  return { next, previous, listed };
}

/**
 * Offers what plays next near the end: the next episode, or the next title
 * of the playlist it plays from. It counts down to it when the user lets
 * titles play on, and asks whether anyone is still watching after a run of
 * them. `playOn` serves the end of the file.
 */
export function useUpNextPrompt({
  item,
  source,
  player,
  segments,
  onBack,
  group,
  playlist,
}: {
  item: BaseItemDto;
  source: SourceInfo;
  player: PlayerController;
  segments: MediaSegmentDto[] | null | undefined;
  onBack: () => void;
  /** Moves a watch party on instead, for everyone. */
  group?: {
    queued: PartyNeighbours | undefined;
    step(direction: 'next' | 'previous'): void;
    play(target: BaseItemDto, playlist?: string): void;
  };
  /** The playlist it was started from. */
  playlist?: string;
}) {
  const { client } = useSession();
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  const downloaded = useFindDownloaded();
  const own = useUpNext(item, playlist);
  const upNext = group ? partyUpNext(item, group.queued) : own;
  const { next, previous } = upNext;
  const listed = !!upNext.playlist || !!upNext.listed;
  const playlistName = usePlaylistName(upNext.playlist);
  const [prompt] = useSetting(settings.next.prompt);
  const [lead] = useSetting(settings.next.lead);
  const [countdown] = useSetting(settings.next.countdown);
  const [fallbackFirst] = useSetting(settings.next.fallbackFirst);
  const [stillWatching] = useSetting(settings.next.stillWatching);
  const { prefs } = usePlaybackPrefs();
  const autoplay = prefs.EnableNextEpisodeAutoPlay !== false;
  const { durationMs, paused } = player.state;

  const outro = segments?.find((s) => String(s.Type) === 'Outro');
  const at = promptAt(durationMs, outro, prompt, lead);
  // Naming a version opens its stream on some servers, so that waits until it plays on.
  const comesUpAt = at ?? durationMs;
  const { playhead } = player;
  const pastPrompt = usePlayhead(
    playhead,
    (h) => h.positionMs >= (at ?? Infinity)
  );
  const pastList = usePlayhead(
    playhead,
    (h) => h.positionMs >= comesUpAt - LIST_LEAD_MS
  );
  const pastOpen = usePlayhead(
    playhead,
    (h) => h.positionMs >= (at ?? durationMs - OPEN_LEAD_MS)
  );
  const due = !!next && pastPrompt;
  const [dismissed, setDismissed] = React.useState(false);
  // Seeking back before the prompt brings it back next time.
  if (!due && dismissed) setDismissed(false);
  const [asking, setAsking] = React.useState(false);
  const shown = due && !dismissed && !asking;

  const leaving = React.useRef(false);
  // The latest press wins; a lookup it overtook is dropped when it lands.
  const wanted = React.useRef<string | null>(null);
  /** `previous`, `next`, or the id of a title picked from a list. */
  const [loading, setLoading] = React.useState<string | null>(null);
  const playOne = React.useCallback(
    async (key: string, target: BaseItemDto | null, playlist?: string) => {
      if (!target || leaving.current) return false;
      if (group) {
        if (key === 'next' || key === 'previous') group.step(key);
        else group.play(target, playlist);
        return true;
      }
      if (wanted.current === key) return true;
      wanted.current = key;
      const go = (sourceId: string) =>
        navigate(to.play(target.Id!, sourceId, resumeMs(target), playlist), {
          replace: true,
        });
      // A downloaded title plays its own file, as Play does.
      const local = downloaded(target);
      if (local) {
        leaving.current = true;
        go(local.source!.Id!);
        return true;
      }
      setLoading(key);
      const code = episodeCode(target.ParentIndexNumber, target.IndexNumber);
      const name = code || target.Name || '';
      toast.loading(t`Finding versions of ${name}…`, {
        id: NOTICE,
      });
      try {
        const info = await queryClient.fetchQuery(infoOptions(target.Id!));
        if (wanted.current !== key) return true;
        leaving.current = true;
        const version = carryOn(playableSources(info), source, fallbackFirst);
        if (version) go(version.Id!);
        else navigate(versionsPath(target, playlist), { replace: true });
        return true;
      } catch {
        if (wanted.current !== key) return true;
        toast.error(
          playlist
            ? t`Could not find versions of that title`
            : t`Could not find versions of that episode`
        );
        return false;
      } finally {
        if (wanted.current === key) {
          wanted.current = null;
          setLoading(null);
          dismissNotice();
        }
      }
    },
    [queryClient, infoOptions, source, fallbackFirst, group, downloaded]
  );
  React.useEffect(() => dismissNotice, []);
  const playNext = React.useCallback(
    () => playOne('next', next, upNext.playlist),
    [playOne, next, upNext.playlist]
  );
  const playPrevious = React.useCallback(
    () => playOne('previous', previous, upNext.playlist),
    [playOne, previous, upNext.playlist]
  );
  // An episode picked from the show's list leaves the playlist.
  const playEpisode = React.useCallback(
    (episode: BaseItemDto) => void playOne(episode.Id!, episode),
    [playOne]
  );
  const playEntry = React.useCallback(
    (entry: BaseItemDto, playlist: string) =>
      void playOne(entry.Id!, entry, playlist),
    [playOne]
  );

  const latestPlayer = useLatest(player);
  const playOn = React.useCallback(
    ({ pause = false } = {}) => {
      if (!next) return Promise.resolve(false);
      if (!group && asksFirst(stillWatching)) {
        const { state, togglePlay } = latestPlayer.current;
        if (pause && !state.paused) togglePlay();
        setAsking(true);
        return Promise.resolve(true);
      }
      countPlayedOn();
      return playNext();
    },
    [next, stillWatching, playNext, latestPlayer, group]
  );

  // A player in its own window takes input there; its pauses are what the page sees of it.
  const external = !!player.external;
  const wasPaused = React.useRef(paused);
  React.useEffect(() => {
    if (external && wasPaused.current !== paused) noteInput();
    wasPaused.current = paused;
  }, [external, paused]);

  const listDue =
    !!next &&
    durationMs >= MIN_DURATION_MS &&
    (at !== null || autoplay) &&
    pastList;
  const openDue = listDue && autoplay && !asksFirst(stillWatching) && pastOpen;
  React.useEffect(() => {
    if (listDue && next && !downloaded(next))
      void queryClient.prefetchQuery(infoOptions(next.Id!));
  }, [listDue, next, queryClient, infoOptions, downloaded]);
  React.useEffect(() => {
    if (!openDue || !next || downloaded(next)) return;
    let current = true;
    queryClient
      .fetchQuery(infoOptions(next.Id!))
      .then((info) => {
        const target = carryOn(playableSources(info), source, fallbackFirst);
        if (current && target)
          void queryClient.prefetchQuery(infoOptions(next.Id!, target.Id!));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [
    openDue,
    next,
    queryClient,
    infoOptions,
    source,
    fallbackFirst,
    downloaded,
  ]);

  // A player with a playlist of its own gets what plays next once this plays.
  const queueNext = useLatest(player.queueNext);
  const queues = !!player.queueNext && player.state.started;
  const canQueue = queues && autoplay && !asksFirst(stillWatching);
  React.useEffect(() => {
    if (!queues) return;
    if (!canQueue || !next) return void queueNext.current?.(null);
    const local = downloaded(next);
    if (local) {
      queueNext.current?.({
        itemId: next.Id!,
        source: local.source!,
        startMs: resumeMs(next),
        url: local.local!.video,
        playlist: upNext.playlist,
      });
      return;
    }
    let current = true;
    queryClient
      .fetchQuery(infoOptions(next.Id!))
      .then(async (info) => {
        const target = carryOn(playableSources(info), source, fallbackFirst);
        if (!current || !target) return;
        const url = await playerUrl(client, next.Id!, target);
        if (!current || !url) return;
        queueNext.current?.({
          itemId: next.Id!,
          source: target,
          startMs: resumeMs(next),
          url,
          headers: requiredHeaders(target),
          playlist: upNext.playlist,
        });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [
    queues,
    canQueue,
    next,
    queryClient,
    infoOptions,
    source,
    fallbackFirst,
    client,
    queueNext,
    downloaded,
    upNext.playlist,
  ]);

  const [leftMs, setLeftMs] = React.useState(countdown * 1000);
  const counting = shown && autoplay && !paused;
  const seconds = Math.max(1, Math.ceil(leftMs / 1000));
  React.useEffect(() => {
    if (!shown) setLeftMs(countdown * 1000);
  }, [shown, countdown]);
  React.useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setLeftMs((ms) => ms - 250), 250);
    return () => clearInterval(timer);
  }, [counting]);
  React.useEffect(() => {
    if (counting && leftMs <= 0) void playOn({ pause: true });
  }, [counting, leftMs, playOn]);

  // While it shows, it stands in for the skip button, and Back from it hides it.
  const card = React.useRef<HTMLDivElement>(null);
  // A remote is on it as it comes up, rather than a press away.
  React.useEffect(() => {
    if (!shown || !currentHost().tv || keyboardFocus()) return;
    const play = card.current?.querySelector<HTMLElement>('[data-name=play]');
    if (play) focusOn(play);
  }, [shown]);
  useAction('player.skipSegment', () => void playNext(), shown);
  useAction(
    'player.controls',
    () => {
      const play = card.current?.querySelector<HTMLElement>('[data-name=play]');
      if (keyboardFocus() || !play) return false;
      focusOn(play);
    },
    shown
  );
  useAction(
    'back',
    () => {
      const el = keyboardFocus();
      if (!el || !card.current?.contains(el)) return false;
      setDismissed(true);
    },
    shown
  );

  const image = next ? landscapeUrl(client, next, { maxWidth: 320 }) : null;
  const heading = !listed
    ? t`Next episode`
    : playlistName
      ? t`Next in ${playlistName}`
      : t`Up next`;
  const element =
    asking && next ? (
      <StillWatching
        next={next}
        title={listed ? fullTitle(next) : itemSubtitle(next)}
        loading={loading === 'next'}
        onContinue={() => void playNext()}
        onBack={onBack}
      />
    ) : shown && next ? (
      <div
        ref={card}
        data-ui="next-episode-card"
        data-playlist={listed ? '' : undefined}
        className="fixed bottom-[calc(2rem+env(safe-area-inset-bottom))] end-4 z-20 transition-[bottom] peer-data-[visible]:bottom-24 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-gray-950 shadow-2xl duration-300 animate-in fade-in-0 slide-in-from-right-4 rtl:slide-in-from-left-4"
      >
        {image && (
          <CachedImage
            data-ui="next-episode-image"
            src={image}
            alt=""
            className="aspect-video w-full object-cover [@media(max-height:640px)]:hidden"
          />
        )}
        <div className="space-y-3 p-4">
          <div>
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-[--muted]">
              {heading}
            </p>
            {listed ? (
              <>
                <p className="line-clamp-2 font-semibold">{itemTitle(next)}</p>
                {next.Type === 'Episode' && (
                  <p className="line-clamp-1 text-sm text-gray-300">
                    {itemSubtitle(next)}
                  </p>
                )}
              </>
            ) : (
              <p className="line-clamp-2 font-semibold">{itemSubtitle(next)}</p>
            )}
          </div>
          <div className="flex gap-2">
            <PlayerAction
              primary
              data-ui="next-episode-action"
              data-name="play"
              className="flex-1"
              onClick={() => void playNext()}
            >
              {counting ? t`Play in ${seconds}s` : t`Play now`}
            </PlayerAction>
            <PlayerAction
              data-ui="next-episode-action"
              data-name="hide"
              onClick={() => setDismissed(true)}
            >
              <Trans>Hide</Trans>
            </PlayerAction>
          </div>
        </div>
        {autoplay && (
          <div data-ui="next-episode-countdown" className="h-1 bg-white/10">
            <div
              className="h-full bg-white transition-[width] duration-200 ease-linear"
              style={{
                width: `${Math.max(0, Math.min(100, (leftMs / (countdown * 1000)) * 100))}%`,
              }}
            />
          </div>
        )}
      </div>
    ) : null;

  return {
    element,
    asking,
    next,
    previous,
    /** The playlist it plays on through. */
    playlist: upNext.playlist,
    /** Steps through a list rather than a show's episodes. */
    listed,
    autoplay,
    playNext,
    playOn,
    playPrevious,
    playEpisode,
    playEntry,
    loading,
  };
}

function StillWatching({
  next,
  title: upNext,
  loading,
  onContinue,
  onBack,
}: {
  next: BaseItemDto;
  title: string;
  loading: boolean;
  onContinue: () => void;
  onBack: () => void;
}) {
  const { client } = useSession();
  const image = landscapeUrl(client, next, { maxWidth: 480 });
  useAction('back', onBack);
  return (
    <div
      data-ui="still-watching"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/80 p-6 duration-300 animate-in fade-in-0"
    >
      <div className="w-full max-w-sm space-y-5 text-center">
        {image && (
          <CachedImage
            data-ui="still-watching-image"
            src={image}
            alt=""
            className="aspect-video w-full rounded-xl object-cover [@media(max-height:640px)]:hidden"
          />
        )}
        <div className="space-y-1">
          <p className="text-2xl font-semibold">
            <Trans>Are you still watching?</Trans>
          </p>
          <p className="line-clamp-2 text-sm text-[--muted]">
            <Trans>Up next: {upNext}</Trans>
          </p>
        </div>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <PlayerAction
            primary
            data-ui="still-watching-action"
            data-name="continue"
            loading={loading}
            autoFocus
            onClick={onContinue}
          >
            <Trans>Continue watching</Trans>
          </PlayerAction>
          <PlayerAction
            data-ui="still-watching-action"
            data-name="back"
            onClick={onBack}
          >
            <Trans>Back</Trans>
          </PlayerAction>
        </div>
      </div>
    </div>
  );
}
