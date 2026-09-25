import React from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@aiostreams/ui/button';
import { useSession } from '../lib/session';
import { useAdjacentEpisodes, usePlaybackInfoOptions } from '../lib/queries';
import { landscapeUrl } from '../lib/images';
import { episodeCode, itemSubtitle, ticksToMs } from '../lib/format';
import { navigate, to, versionsPath } from '../lib/paths';
import { playableSources } from '../lib/use-play';
import {
  useNextCountdown,
  useNextFallbackFirst,
  useNextLead,
  useNextPrompt,
  type NextPrompt,
} from '../lib/settings';
import { usePlaybackPrefs } from '../lib/user-config';
import type { PlayerController } from '../lib/player';
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

/**
 * Offers the next episode near the end, counting down to it when the user
 * lets episodes play on. `playNext` also serves the end of the file.
 */
export function useNextEpisodePrompt({
  item,
  source,
  player,
  segments,
}: {
  item: BaseItemDto;
  source: SourceInfo;
  player: PlayerController;
  segments: MediaSegmentDto[] | null | undefined;
}) {
  const { client } = useSession();
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  const adjacent = useAdjacentEpisodes(item).data;
  const next = adjacent?.next ?? null;
  const previous = adjacent?.previous ?? null;
  const [prompt] = useNextPrompt();
  const [lead] = useNextLead();
  const [countdown] = useNextCountdown();
  const [fallbackFirst] = useNextFallbackFirst();
  const { prefs } = usePlaybackPrefs();
  const autoplay = prefs.EnableNextEpisodeAutoPlay !== false;
  const { positionMs, durationMs, paused } = player.state;

  const outro = segments?.find((s) => String(s.Type) === 'Outro');
  const at = promptAt(durationMs, outro, prompt, lead);
  const due = !!next && at !== null && positionMs >= at;
  const [dismissed, setDismissed] = React.useState(false);
  // Seeking back before the prompt brings it back next time.
  if (!due && dismissed) setDismissed(false);
  const shown = due && !dismissed;

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

  React.useEffect(() => {
    if (shown && next) void queryClient.prefetchQuery(infoOptions(next.Id!));
  }, [shown, next, queryClient, infoOptions]);

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
    if (counting && leftMs <= 0) void playNext();
  }, [counting, leftMs, playNext]);

  const image = next ? landscapeUrl(client, next, { maxWidth: 640 }) : null;
  const element =
    shown && next ? (
      <div
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
              intent="white"
              className="flex-1 rounded-full"
              onClick={() => void playNext()}
            >
              {counting
                ? `Play in ${Math.max(1, Math.ceil(leftMs / 1000))}s`
                : 'Play now'}
            </Button>
            <Button
              intent="gray-outline"
              className="rounded-full"
              onClick={() => setDismissed(true)}
            >
              Hide
            </Button>
          </div>
        </div>
        {autoplay && (
          <div className="h-1 bg-white/10">
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
    next,
    previous,
    autoplay,
    playNext,
    playPrevious,
    loading,
  };
}
