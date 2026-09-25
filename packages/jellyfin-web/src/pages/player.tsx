import React from 'react';
import { toast } from 'sonner';
import { BiArrowBack, BiCopy, BiLayer, BiLinkExternal } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import {
  useItem,
  usePlaybackInfo,
  useRefreshAll,
  useSegments,
} from '../lib/queries';
import { hasLastingId, lastVersions, playableSources } from '../lib/use-play';
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
import { useBrowserPlayer } from '../lib/hosts/browser';
import { useDesktopPlayer } from '../lib/hosts/jellyfin-desktop';
import { useShellPlayer } from '../lib/hosts/shell';
import type { PlayerController } from '../lib/player';
import { useSubtitleStyle, type SubtitleStyle } from '../lib/settings';
import { subtitleCss } from '../lib/subtitle-style';
import { usePlaybackPrefs, type PlaybackPrefs } from '../lib/user-config';
import { backdropUrl } from '../lib/images';
import { goBack, navigate, to, versionsPath } from '../lib/paths';
import { PlayerControls } from '../components/player-controls';
import { useNextEpisodePrompt } from '../components/next-episode';
import {
  useVersionPicker,
  VersionPickerProvider,
} from '../components/version-picker';
import type { BaseItemDto, SourceInfo } from '../lib/types';

interface PlayerProps {
  item: BaseItemDto;
  source: SourceInfo;
  playSessionId: string | null;
  startMs: number;
  prefs: PlaybackPrefs;
}

/**
 * The page keeps no scrollbar, or the space reserved for one, over the video,
 * and no backdrop (see PageBackground).
 */
function usePlayerPage() {
  React.useLayoutEffect(() => {
    const html = document.documentElement;
    const previous = [html.style.overflowY, html.style.scrollbarGutter];
    html.style.overflowY = 'hidden';
    html.style.scrollbarGutter = 'auto';
    html.classList.add('playing');
    return () => {
      [html.style.overflowY, html.style.scrollbarGutter] = previous;
      html.classList.remove('playing');
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
  const info = usePlaybackInfo(itemId, { sourceId: sourceId || undefined });
  const playback = usePlaybackPrefs();
  usePlayerPage();

  // Pinned once found: a refreshed version list must not restart playback.
  const [playing, setPlaying] = React.useState<Omit<
    PlayerProps,
    'startMs'
  > | null>(null);
  const sources = playableSources(info.data);
  const source = sourceId ? sources.find((s) => s.Id === sourceId) : sources[0];
  const missing = !playing && !!item.data && !!info.data && !source;
  React.useEffect(() => {
    if (!missing || !item.data) return;
    lastVersions.set(itemId, undefined);
    navigate(versionsPath(item.data), { replace: true });
  }, [missing, item.data, itemId]);
  if (!playing && item.data && source && !playback.isLoading) {
    setPlaying({
      item: item.data,
      source,
      playSessionId: info.data?.PlaySessionId ?? null,
      prefs: playback.prefs,
    });
  }

  if (!playing) {
    if (item.isLoading || info.isLoading || playback.isLoading || missing) {
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
  const host = playbackHost();
  return (
    <VersionPickerProvider>
      {host === 'shell' || host === 'desktop' ? (
        <NativePlayer {...playing} startMs={startMs} />
      ) : (
        <BrowserPlayer {...playing} startMs={startMs} />
      )}
    </VersionPickerProvider>
  );
}

/**
 * The end of the file plays on or goes back; a ref, since the player needs the
 * handler before the prompt that decides it exists.
 */
function useEnded(item: BaseItemDto) {
  const back = React.useCallback(() => goBack(to.item(item.Id!)), [item.Id]);
  const ended = React.useRef(back);
  const onEnded = React.useCallback(() => ended.current(), []);
  const connect = (next: ReturnType<typeof useNextEpisodePrompt>) => {
    ended.current = () => {
      if (!next.autoplay || !next.next) return back();
      void next.playNext().then((ok) => {
        if (!ok) back();
      });
    };
  };
  return { back, onEnded, connect };
}

function useSwitchVersion(
  item: BaseItemDto,
  source: SourceInfo,
  player: PlayerController
) {
  const picker = useVersionPicker();
  return () =>
    picker.open(item, {
      startMs: player.state.positionMs,
      playing: source.Id ?? undefined,
    });
}

/** Reports the playback the way a Jellyfin client does once it starts. */
function useReporting(
  player: PlayerController,
  {
    item,
    source,
    playSessionId,
  }: Pick<PlayerProps, 'item' | 'source' | 'playSessionId'>
) {
  const { client } = useSession();
  const state = React.useRef(player.state);
  state.current = player.state;
  const reporter = React.useRef<PlaybackReporter | null>(null);
  const refreshAll = useRefreshAll();
  const refresh = React.useRef(refreshAll);
  refresh.current = refreshAll;
  const { started, paused } = player.state;

  React.useEffect(() => {
    if (started && hasLastingId(source)) lastVersions.set(item.Id!, source.Id!);
  }, [started, item.Id, source]);

  React.useEffect(() => {
    if (!started) return;
    const current = new PlaybackReporter(
      client,
      { itemId: item.Id!, mediaSourceId: source.Id!, playSessionId },
      () => ({ ms: state.current.positionMs, paused: state.current.paused })
    );
    current.start();
    reporter.current = current;
    const onHide = () => void current.stop();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      // The position it leaves is what the pages behind offer to resume.
      void current.stop().then(() => refresh.current());
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
  onVersions,
}: {
  itemId: string;
  message: string;
  item?: BaseItemDto;
  source?: SourceInfo;
  onVersions?: () => void;
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
          {onVersions && (
            <Button
              intent="white"
              className="rounded-full"
              leftIcon={<BiLayer />}
              onClick={onVersions}
            >
              Other versions
            </Button>
          )}
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

function cueCss(style: SubtitleStyle): string {
  const css = subtitleCss(style);
  return `video::cue {
    font-size: ${css.fontSize};
    font-weight: ${css.fontWeight};
    color: ${css.color};
    background-color: ${css.backgroundColor};
    text-shadow: ${css.textShadow};
  }`;
}

function BrowserPlayer({
  item,
  source,
  playSessionId,
  startMs,
  prefs,
}: PlayerProps) {
  const { client } = useSession();
  const video = React.useRef<HTMLVideoElement>(null);
  const { back, onEnded, connect } = useEnded(item);
  const subtitleStyle = useSubtitleStyle();
  const player = useBrowserPlayer(video, {
    source,
    startMs,
    onEnded,
    prefs,
  });
  const segments = useSegments(item.Id!);
  const next = useNextEpisodePrompt({
    item,
    source,
    player,
    segments: segments.data?.Items,
  });
  connect(next);
  const switchVersion = useSwitchVersion(item, source, player);
  useReporting(player, { item, source, playSessionId });

  return (
    <div className="fixed inset-0 bg-black">
      <style>{cueCss(subtitleStyle)}</style>
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
        offeringNext={!!next.element}
        onVersions={switchVersion}
      />
      {next.element}
      {player.state.error && (
        <Failure
          itemId={item.Id!}
          item={item}
          source={source}
          message={player.state.error}
          onVersions={switchVersion}
        />
      )}
    </div>
  );
}

/**
 * mpv draws beneath the page, which stays transparent from the first paint;
 * a cover hides the wait for the first frame.
 */
function NativePlayer({
  item,
  source,
  playSessionId,
  startMs,
  prefs,
}: PlayerProps) {
  const { client } = useSession();
  const { back, onEnded, connect } = useEnded(item);
  const subtitleStyle = useSubtitleStyle();
  const useNativePlayer =
    playbackHost() === 'shell' ? useShellPlayer : useDesktopPlayer;
  const player = useNativePlayer({
    client,
    item,
    url: streamUrl(client, item.Id!, source, playSessionId),
    source,
    startMs,
    onEnded,
    prefs,
    subtitleStyle,
  });
  const segments = useSegments(item.Id!);
  const next = useNextEpisodePrompt({
    item,
    source,
    player,
    segments: segments.data?.Items,
  });
  connect(next);
  const switchVersion = useSwitchVersion(item, source, player);
  useReporting(player, { item, source, playSessionId });

  return (
    <div className="fixed inset-0">
      <Cover item={item} hidden={player.state.started} />
      <PlayerControls
        item={item}
        player={player}
        segments={segments.data?.Items}
        onBack={back}
        offeringNext={!!next.element}
        onVersions={switchVersion}
      />
      {next.element}
      {player.state.error && (
        <Failure
          itemId={item.Id!}
          item={item}
          source={source}
          message={`Playback failed: ${player.state.error}`}
          onVersions={switchVersion}
        />
      )}
    </div>
  );
}
