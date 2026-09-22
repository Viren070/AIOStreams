import React from 'react';
import { toast } from 'sonner';
import { BiArrowBack, BiCopy, BiLinkExternal } from 'react-icons/bi';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { copyToClipboard } from '@/utils/clipboard';
import { cn } from '@/components/ui/core/styling';
import { useSession } from '../lib/session';
import { useItem, usePlaybackInfo, useSegments } from '../lib/queries';
import { playableSources } from '../lib/use-play';
import {
  directUrl,
  externalPlayerTemplate,
  externalPlayerUrl,
  PlaybackReporter,
  streamUrl,
  subtitleUrl,
  textSubtitles,
} from '../lib/playback';
import { playbackHost } from '../lib/hosts';
import {
  useBrowserPlayer,
  useDesktopPlayer,
  type PlayerController,
} from '../lib/player';
import { backdropUrl } from '../lib/images';
import { goBack, to } from '../lib/paths';
import { PlayerControls } from '../components/player-controls';
import type { BaseItemDto, SourceInfo } from '../lib/types';

interface PlayerProps {
  item: BaseItemDto;
  source: SourceInfo;
  playSessionId: string | null;
  startMs: number;
}

/** The page keeps no scrollbar, or the space reserved for one, over the video. */
function useNoScrollbar() {
  React.useLayoutEffect(() => {
    const { style } = document.documentElement;
    const previous = [style.overflowY, style.scrollbarGutter];
    style.overflowY = 'hidden';
    style.scrollbarGutter = 'auto';
    return () => {
      [style.overflowY, style.scrollbarGutter] = previous;
    };
  }, []);
}

export function PlayerPage({
  itemId,
  sourceId,
  startMs,
}: {
  itemId: string;
  sourceId: string;
  startMs: number;
}) {
  const item = useItem(itemId);
  const info = usePlaybackInfo(itemId);
  useNoScrollbar();

  // Pinned once found: a refreshed version list must not restart playback.
  const [playing, setPlaying] = React.useState<Omit<
    PlayerProps,
    'startMs'
  > | null>(null);
  const sources = playableSources(info.data);
  const source = sources.find((s) => s.Id === sourceId) ?? sources[0];
  if (!playing && item.data && source) {
    setPlaying({
      item: item.data,
      source,
      playSessionId: info.data?.PlaySessionId ?? null,
    });
  }

  if (!playing) {
    if (item.isLoading || info.isLoading) {
      return (
        <Cover item={item.data}>
          <LoadingSpinner />
        </Cover>
      );
    }
    return (
      <Failure itemId={itemId} message="This version is no longer available." />
    );
  }
  return playbackHost() === 'desktop' ? (
    <DesktopPlayer {...playing} startMs={startMs} />
  ) : (
    <BrowserPlayer {...playing} startMs={startMs} />
  );
}

/** Reports the playback the way a Jellyfin client does once it starts. */
function useReporting(
  player: PlayerController,
  { item, source, playSessionId }: Omit<PlayerProps, 'startMs'>
) {
  const { client } = useSession();
  const state = React.useRef(player.state);
  state.current = player.state;
  const reporter = React.useRef<PlaybackReporter | null>(null);
  const { started, paused } = player.state;

  React.useEffect(() => {
    if (!started) return;
    const current = new PlaybackReporter(
      client,
      { itemId: item.Id!, mediaSourceId: source.Id!, playSessionId },
      () => ({ ms: state.current.positionMs, paused: state.current.paused })
    );
    current.start();
    reporter.current = current;
    const onHide = () => current.stop();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      current.stop();
      reporter.current = null;
    };
  }, [started, client, item.Id, source.Id, playSessionId]);

  React.useEffect(() => {
    reporter.current?.progress(paused ? 'Pause' : 'Unpause');
  }, [paused]);
}

function Cover({
  item,
  hidden,
  children,
}: {
  item?: BaseItemDto;
  hidden?: boolean;
  children?: React.ReactNode;
}) {
  const { client } = useSession();
  const backdrop = item ? backdropUrl(client, item, { maxWidth: 1920 }) : null;
  return (
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center bg-black transition-opacity duration-500',
        hidden && 'pointer-events-none opacity-0'
      )}
    >
      {backdrop && (
        <img
          src={backdrop}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-25"
        />
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

function Failure({
  itemId,
  message,
  item,
  source,
}: {
  itemId: string;
  message: string;
  item?: BaseItemDto;
  source?: SourceInfo;
}) {
  const { client } = useSession();
  const template = externalPlayerTemplate();
  const link = item && source ? directUrl(client, item.Id!, source) : null;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/90 p-6">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-lg font-semibold [overflow-wrap:anywhere]">
          {message}
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            intent="gray-outline"
            className="rounded-full"
            leftIcon={<BiArrowBack />}
            onClick={() => goBack(to.item(itemId))}
          >
            Back
          </Button>
          {link && template && (
            <Button
              intent="white"
              className="rounded-full"
              leftIcon={<BiLinkExternal />}
              onClick={() => {
                window.location.href = externalPlayerUrl(template, link);
              }}
            >
              Open in player
            </Button>
          )}
          {link && (
            <Button
              intent="gray-outline"
              className="rounded-full"
              leftIcon={<BiCopy />}
              onClick={() =>
                copyToClipboard(link, {
                  onSuccess: () => toast.success('Stream link copied'),
                  onError: () => toast.error('Could not copy the link'),
                })
              }
            >
              Copy link
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function BrowserPlayer({ item, source, playSessionId, startMs }: PlayerProps) {
  const { client } = useSession();
  const video = React.useRef<HTMLVideoElement>(null);
  const back = React.useCallback(() => goBack(to.item(item.Id!)), [item.Id]);
  const player = useBrowserPlayer(video, { source, startMs, onEnded: back });
  const segments = useSegments(item.Id!);
  useReporting(player, { item, source, playSessionId });

  return (
    <div className="fixed inset-0 bg-black">
      <video
        ref={video}
        src={streamUrl(client, item.Id!, source, playSessionId)}
        className="h-full w-full"
        autoPlay
        playsInline
      >
        {textSubtitles(source).map((s) => {
          const url = subtitleUrl(client, s);
          return url ? (
            <track
              key={s.Index}
              kind="subtitles"
              src={url}
              srcLang={s.Language ?? undefined}
              label={s.DisplayTitle ?? s.Title ?? s.Language ?? 'Subtitles'}
            />
          ) : null;
        })}
      </video>
      <PlayerControls
        item={item}
        player={player}
        segments={segments.data?.Items}
        onBack={back}
      />
      {player.state.error && (
        <Failure
          itemId={item.Id!}
          item={item}
          source={source}
          message={player.state.error}
        />
      )}
    </div>
  );
}

/**
 * mpv draws beneath the page, which stays transparent from the first paint;
 * a cover hides the wait for the first frame.
 */
function DesktopPlayer({ item, source, playSessionId, startMs }: PlayerProps) {
  const { client } = useSession();
  const back = React.useCallback(() => goBack(to.item(item.Id!)), [item.Id]);
  // Titles only: the app fetches artwork from the server's root, not ours.
  const metadata = React.useMemo(
    () => ({
      Name: item.Name,
      Type: item.Type,
      SeriesName: item.SeriesName,
      IndexNumber: item.IndexNumber,
      ParentIndexNumber: item.ParentIndexNumber,
      ProductionYear: item.ProductionYear,
      RunTimeTicks: item.RunTimeTicks,
    }),
    [item]
  );
  const player = useDesktopPlayer({
    client,
    url: streamUrl(client, item.Id!, source, playSessionId),
    source,
    startMs,
    metadata,
    onEnded: back,
  });
  const segments = useSegments(item.Id!);
  useReporting(player, { item, source, playSessionId });

  return (
    <div className="fixed inset-0">
      <Cover item={item} hidden={player.state.started} />
      <PlayerControls
        item={item}
        player={player}
        segments={segments.data?.Items}
        onBack={back}
      />
      {player.state.error && (
        <Failure
          itemId={item.Id!}
          item={item}
          source={source}
          message={`Playback failed: ${player.state.error}`}
        />
      )}
    </div>
  );
}
