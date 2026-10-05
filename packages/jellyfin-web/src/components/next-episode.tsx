import React from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@aiostreams/ui/button';
import { useSession } from '../lib/session';
import { useAdjacentEpisodes, usePlaybackInfoOptions } from '../lib/queries';
import { landscapeUrl } from '../lib/images';
import { episodeCode, itemSubtitle, ticksToMs } from '../lib/format';
import { navigate, to, versionsPath } from '../lib/paths';
import { playableSources } from '../lib/playback/play';
import { streamUrl } from '../lib/playback/stream';
import {
  focusOn,
  inputCount,
  keyboardFocus,
  noteInput,
  useAction,
} from '../lib/input';
import { settings, useSetting, type NextPrompt } from '../lib/settings';
import { usePlaybackPrefs } from '../lib/user-config';
import { useLatest } from '../lib/use-latest';
import type { PlayerController } from '../lib/playback/controller';
import type { BaseItemDto, MediaSegmentDto, SourceInfo } from '../lib/types';

type Direction = 'previous' | 'next';

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
    if (end >= durationMs * 0.9 && durationMs - end <= CREDITS_TAIL_MS)
      return start;
  }
  return durationMs - lead * 1000;
}

/**
 * The version of another episode that carries on from this one: the one in
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

/** Episodes the player moved on to by itself since the last input it saw. */
const unattended = { episodes: 0, inputs: -1 };

function unattendedEpisodes(): number {
  const inputs = inputCount();
  if (inputs !== unattended.inputs) {
    unattended.episodes = 0;
    unattended.inputs = inputs;
  }
  return unattended.episodes;
}

export function countPlayedOn(): void {
  unattendedEpisodes();
  unattended.episodes++;
}

/** Whether playing on now would make `limit` episodes in a row with nobody there. */
function asksFirst(limit: number): boolean {
  return limit > 0 && unattendedEpisodes() + 1 >= limit;
}

/**
 * Offers the next episode near the end, counting down to it when the user
 * lets episodes play on, and asks whether anyone is still watching after a
 * run of them. `playOn` serves the end of the file.
 */
export function useNextEpisodePrompt({
  item,
  source,
  player,
  segments,
  onBack,
}: {
  item: BaseItemDto;
  source: SourceInfo;
  player: PlayerController;
  segments: MediaSegmentDto[] | null | undefined;
  onBack: () => void;
}) {
  const { client } = useSession();
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  const adjacent = useAdjacentEpisodes(item).data;
  const next = adjacent?.next ?? null;
  const previous = adjacent?.previous ?? null;
  const [prompt] = useSetting(settings.next.prompt);
  const [lead] = useSetting(settings.next.lead);
  const [countdown] = useSetting(settings.next.countdown);
  const [fallbackFirst] = useSetting(settings.next.fallbackFirst);
  const [stillWatching] = useSetting(settings.next.stillWatching);
  const { prefs } = usePlaybackPrefs();
  const autoplay = prefs.EnableNextEpisodeAutoPlay !== false;
  const { positionMs, durationMs, paused } = player.state;

  const outro = segments?.find((s) => String(s.Type) === 'Outro');
  const at = promptAt(durationMs, outro, prompt, lead);
  const due = !!next && at !== null && positionMs >= at;
  const [dismissed, setDismissed] = React.useState(false);
  // Seeking back before the prompt brings it back next time.
  if (!due && dismissed) setDismissed(false);
  const [asking, setAsking] = React.useState(false);
  const shown = due && !dismissed && !asking;

  const leaving = React.useRef(false);
  // The latest press wins; a lookup it overtook is dropped when it lands.
  const wanted = React.useRef<Direction | null>(null);
  const [loading, setLoading] = React.useState<Direction | null>(null);
  const playEpisode = React.useCallback(
    async (direction: Direction, episode: BaseItemDto | null) => {
      if (!episode || leaving.current) return false;
      if (wanted.current === direction) return true;
      wanted.current = direction;
      setLoading(direction);
      const code = episodeCode(episode.ParentIndexNumber, episode.IndexNumber);
      toast.loading(`Finding versions of ${code || episode.Name}…`, {
        id: NOTICE,
      });
      try {
        const info = await queryClient.fetchQuery(infoOptions(episode.Id!));
        if (wanted.current !== direction) return true;
        leaving.current = true;
        const target = carryOn(playableSources(info), source, fallbackFirst);
        if (target)
          navigate(to.play(episode.Id!, target.Id!, resumeMs(episode)), {
            replace: true,
          });
        else navigate(versionsPath(episode), { replace: true });
        return true;
      } catch {
        if (wanted.current !== direction) return true;
        toast.error('Could not find versions of that episode');
        return false;
      } finally {
        if (wanted.current === direction) {
          wanted.current = null;
          setLoading(null);
          dismissNotice();
        }
      }
    },
    [queryClient, infoOptions, source, fallbackFirst]
  );
  React.useEffect(() => dismissNotice, []);
  const playNext = React.useCallback(
    () => playEpisode('next', next),
    [playEpisode, next]
  );
  const playPrevious = React.useCallback(
    () => playEpisode('previous', previous),
    [playEpisode, previous]
  );

  const latestPlayer = useLatest(player);
  const playOn = React.useCallback(
    ({ pause = false } = {}) => {
      if (!next) return Promise.resolve(false);
      if (asksFirst(stillWatching)) {
        const { state, togglePlay } = latestPlayer.current;
        if (pause && !state.paused) togglePlay();
        setAsking(true);
        return Promise.resolve(true);
      }
      countPlayedOn();
      return playNext();
    },
    [next, stillWatching, playNext, latestPlayer]
  );

  // A player in its own window takes input there; its pauses are what the page sees of it.
  const external = !!player.external;
  const wasPaused = React.useRef(paused);
  React.useEffect(() => {
    if (external && wasPaused.current !== paused) noteInput();
    wasPaused.current = paused;
  }, [external, paused]);

  // Naming a version opens its stream on some servers, so that waits until it plays on.
  const comesUpAt = at ?? durationMs;
  const listDue =
    !!next &&
    durationMs >= MIN_DURATION_MS &&
    (at !== null || autoplay) &&
    positionMs >= comesUpAt - LIST_LEAD_MS;
  const openDue =
    listDue &&
    autoplay &&
    !asksFirst(stillWatching) &&
    positionMs >= (at ?? durationMs - OPEN_LEAD_MS);
  React.useEffect(() => {
    if (listDue && next) void queryClient.prefetchQuery(infoOptions(next.Id!));
  }, [listDue, next, queryClient, infoOptions]);
  React.useEffect(() => {
    if (!openDue || !next) return;
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
  }, [openDue, next, queryClient, infoOptions, source, fallbackFirst]);

  // A player with a playlist of its own gets the next episode once this one plays.
  const queueNext = useLatest(player.queueNext);
  const canQueue =
    !!player.queueNext &&
    autoplay &&
    player.state.started &&
    !asksFirst(stillWatching);
  React.useEffect(() => {
    if (!canQueue || !next) return;
    let current = true;
    queryClient
      .fetchQuery(infoOptions(next.Id!))
      .then((info) => {
        const target = carryOn(playableSources(info), source, fallbackFirst);
        if (!current || !target) return;
        queueNext.current?.({
          itemId: next.Id!,
          source: target,
          startMs: resumeMs(next),
          url: streamUrl(client, next.Id!, target, info.PlaySessionId),
        });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [
    canQueue,
    next,
    queryClient,
    infoOptions,
    source,
    fallbackFirst,
    client,
    queueNext,
  ]);

  const [leftMs, setLeftMs] = React.useState(countdown * 1000);
  const counting = shown && autoplay && !paused;
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
  const element =
    asking && next ? (
      <StillWatching
        next={next}
        loading={loading === 'next'}
        onContinue={() => void playNext()}
        onBack={onBack}
      />
    ) : shown && next ? (
      <div
        ref={card}
        data-ui="next-episode-card"
        className="fixed bottom-24 right-4 z-20 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-gray-950/90 shadow-2xl backdrop-blur duration-300 animate-in fade-in-0 slide-in-from-right-4"
      >
        {image && (
          <img
            data-ui="next-episode-image"
            src={image}
            alt=""
            className="aspect-video w-full object-cover"
          />
        )}
        <div className="space-y-3 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
              Next episode
            </p>
            <p className="line-clamp-2 font-semibold">{itemSubtitle(next)}</p>
          </div>
          <div className="flex gap-2">
            <Button
              data-ui="next-episode-action"
              data-name="play"
              intent="white"
              className="flex-1 rounded-full"
              onClick={() => void playNext()}
            >
              {counting
                ? `Play in ${Math.max(1, Math.ceil(leftMs / 1000))}s`
                : 'Play now'}
            </Button>
            <Button
              data-ui="next-episode-action"
              data-name="hide"
              intent="gray-outline"
              className="rounded-full"
              onClick={() => setDismissed(true)}
            >
              Hide
            </Button>
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
    autoplay,
    playNext,
    playOn,
    playPrevious,
    loading,
  };
}

function StillWatching({
  next,
  loading,
  onContinue,
  onBack,
}: {
  next: BaseItemDto;
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
          <img
            data-ui="still-watching-image"
            src={image}
            alt=""
            className="aspect-video w-full rounded-xl object-cover"
          />
        )}
        <div className="space-y-1">
          <p className="text-2xl font-semibold">Are you still watching?</p>
          <p className="line-clamp-2 text-sm text-[--muted]">
            Up next: {itemSubtitle(next)}
          </p>
        </div>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            data-ui="still-watching-action"
            data-name="continue"
            intent="white"
            className="rounded-full"
            loading={loading}
            autoFocus
            onClick={onContinue}
          >
            Continue watching
          </Button>
          <Button
            data-ui="still-watching-action"
            data-name="back"
            intent="gray-outline"
            className="rounded-full"
            onClick={onBack}
          >
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
