import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { toast } from 'sonner';
import { BiArrowBack, BiCopy, BiLayer, BiRefresh } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import {
  useItem,
  usePlaybackInfo,
  useRefreshAll,
  useSegments,
} from '../lib/queries';
import { lastVersions, playableSources } from '../lib/playback/play';
import { chosenPlayer } from '../lib/playback/player-choice';
import {
  directUrl,
  requiredHeaders,
  useYouTubeStream,
} from '../lib/playback/stream';
import { PlaybackReporter } from '../lib/playback/reporter';
import { currentHost } from '../lib/hosts';
import { useFeature } from '../lib/server-info';
import { usePlayerFullscreen } from '../lib/playback/fullscreen';
import { usePlayer } from '../lib/playback/use-player';
import { videoEngine } from '../lib/playback/video';
import { useNowPlaying } from '../lib/playback/now-playing';
import {
  useShowPicks,
  useShowTrackPicks,
  withShowPick,
} from '../lib/playback/show-tracks';
import type {
  PlayerOptions,
  PlayerController,
} from '../lib/playback/controller';
import {
  settings,
  useSetting,
  type SubtitleStyle,
  type VideoFit,
} from '../lib/settings';
import {
  subtitleCss,
  subtitleLine,
  subtitleScale,
} from '../lib/subtitles/style';
import { usePlaybackPrefs, type PlaybackPrefs } from '../lib/user-config';
import { fullTitle } from '../lib/format';
import { goBack, navigate, to, versionsPath } from '../lib/paths';
import { noteLastPlayed } from '../lib/last-played';
import { PlayerControls } from '../components/player/controls';
import {
  countPlayedOn,
  useNextEpisodePrompt,
} from '../components/player/next-episode';
import {
  useVersionPicker,
  VersionPickerProvider,
} from '../components/version-picker';
import { chapterSegments, guessedSegments } from '../lib/playback/chapters';
import type {
  BaseItemDto,
  MediaSegmentDto,
  MediaStream,
  SourceInfo,
} from '../lib/types';
import { useDownloadOf, type Download } from '../lib/downloads';
import { Cover } from '../components/player/cover';
import { party, useParty } from '../lib/party/party';
import { leavePartyPlayback, usePartyBinding } from '../lib/party/follow';
import { usePlayForParty } from '../lib/party/actions';
import { usePartyPlayer } from '../lib/party/playback';
import { PartyLayer } from '../components/party/party-layer';
import { openPartySheet } from '../components/party/party-sheet';

interface PlayerProps {
  item: BaseItemDto;
  source: SourceInfo;
  playSessionId: string | null;
  startMs: number;
  prefs: PlaybackPrefs;
  launched?: PlayerOptions['launched'];
  local?: Download;
  /** A YouTube version's stream. */
  youTube?: string;
  /** Whether the cover still hides the player, until its first frame. */
  onCovered(covered: boolean): void;
}

/**
 * The page keeps no scrollbar, or the space reserved for one, over the video,
 * and no backdrop (see PageBackground).
 */
export function usePlayerPage() {
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

export const OBJECT_FIT: Record<VideoFit, string> = {
  fit: 'object-contain',
  crop: 'object-cover',
  stretch: 'object-fill',
};

export function PlayerPage({
  itemId,
  sourceId,
  startMs,
}: {
  itemId: string;
  sourceId: string;
  startMs: number;
}) {
  const download = useDownloadOf(itemId);
  // A finished download plays its own file, with or without the server.
  const local =
    download?.state === 'done' &&
    download.local &&
    download.source &&
    (!sourceId || sourceId === download.source.Id)
      ? download
      : undefined;
  const fetched = useItem(itemId);
  const item = { ...fetched, data: fetched.data ?? local?.item };
  const info = usePlaybackInfo(itemId, {
    sourceId: sourceId || undefined,
    enabled: !local,
  });
  const playback = usePlaybackPrefs();
  const picks = useShowPicks();
  usePlayerPage();
  const host = currentHost();
  usePlayerFullscreen(!host.player || !!host.fullscreen);

  // Pinned once found: a refreshed version list must not restart playback.
  const [playing, setPlaying] = React.useState<Omit<
    PlayerProps,
    'startMs' | 'onCovered'
  > | null>(null);
  const [covered, setCovered] = React.useState(true);
  const sources = local ? [local.source!] : playableSources(info.data);
  const source = sourceId ? sources.find((s) => s.Id === sourceId) : sources[0];
  const missing = !playing && !!item.data && !!info.data && !source;
  const youTubeId = playing ? undefined : source?.aiostreams?.ytId;
  const youTube = useYouTubeStream(youTubeId);
  React.useEffect(() => {
    if (!missing || !item.data) return;
    lastVersions.set(itemId, undefined);
    navigate(versionsPath(item.data), { replace: true });
  }, [missing, item.data, itemId]);
  React.useEffect(() => {
    if (playing) noteLastPlayed(playing.item, playing.source);
  }, [playing]);
  if (
    !playing &&
    item.data &&
    source &&
    (!youTubeId || youTube.data) &&
    !playback.isLoading &&
    !picks.isLoading
  ) {
    const player = chosenPlayer();
    setPlaying({
      item: item.data,
      source,
      playSessionId: info.data?.PlaySessionId ?? null,
      prefs: withShowPick(playback.prefs, picks.data, item.data),
      launched: player.kind === 'launched' ? player : undefined,
      local,
      youTube: youTube.data ?? undefined,
    });
  }

  const loading =
    (!item.data && item.isLoading) ||
    info.isLoading ||
    playback.isLoading ||
    picks.isLoading ||
    youTube.isLoading ||
    missing;
  return (
    <>
      <Cover item={item.data} hidden={!!playing && !covered} />
      {playing ? (
        <VersionPickerProvider>
          <Player {...playing} startMs={startMs} onCovered={setCovered} />
        </VersionPickerProvider>
      ) : loading ? null : (
        <Failure
          itemId={itemId}
          message={
            youTubeId && !youTube.data
              ? t`This video didn't load.`
              : t`This version is no longer available.`
          }
        />
      )}
    </>
  );
}

/**
 * The end of the file plays on or goes back; a ref, since the player needs the
 * handler before the prompt that decides it exists. Going back closes a player
 * in its own window, which playing on keeps.
 */
function useEnded(item: BaseItemDto, close?: () => void) {
  const latestClose = React.useRef(close);
  latestClose.current = close;
  const back = React.useCallback(() => {
    latestClose.current?.();
    goBack(to.item(item.Id!));
  }, [item.Id]);
  const ended = React.useRef(back);
  const onEnded = React.useCallback(() => ended.current(), []);
  const connect = (next: ReturnType<typeof useNextEpisodePrompt>) => {
    ended.current = () => {
      if (!next.autoplay || !next.next) return back();
      void next.playOn().then((ok) => {
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
      startMs: player.playhead.positionMs,
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
  const { client, user } = useSession();
  const state = React.useRef(player.state);
  state.current = player.state;
  const reporter = React.useRef<PlaybackReporter | null>(null);
  const refreshAll = useRefreshAll();
  const refresh = React.useRef(refreshAll);
  refresh.current = refreshAll;
  const { started, paused } = player.state;
  // A server that sends the object without the feature numbers versions by position.
  const lasting = useFeature('versions') || !source.aiostreams;

  React.useEffect(() => {
    if (started && lasting) lastVersions.set(item.Id!, source.Id!);
  }, [started, lasting, item.Id, source.Id]);

  React.useEffect(() => {
    if (!started) return;
    const current = new PlaybackReporter(
      client,
      {
        itemId: item.Id!,
        mediaSourceId: source.Id!,
        playSessionId,
        userId: user.Id,
      },
      () => ({ ms: player.playhead.positionMs, paused: state.current.paused })
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
  }, [started, client, user.Id, item.Id, source.Id, playSessionId]);

  React.useEffect(() => {
    reporter.current?.progress(paused ? 'Pause' : 'Unpause');
  }, [paused]);
}

function Failure({
  itemId,
  message,
  item,
  source,
  onVersions,
  retry,
}: {
  itemId: string;
  message: string;
  item?: BaseItemDto;
  source?: SourceInfo;
  onVersions?: () => void;
  retry?: { label: string; run(): void };
}) {
  const { client } = useSession();
  const link =
    item && source && !currentHost().tv
      ? directUrl(client, item.Id!, source)
      : null;
  return (
    <div
      data-ui="player-error"
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/90 p-6"
    >
      <div className="max-w-md space-y-4 text-center">
        <p className="text-lg font-semibold [overflow-wrap:anywhere]">
          {message}
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            intent="gray-outline"
            className="rounded-full"
            leftIcon={<BiArrowBack className="rtl:-scale-x-100" />}
            autoFocus={!onVersions && !retry}
            onClick={() => goBack(to.item(itemId))}
          >
            <Trans>Back</Trans>
          </Button>
          {retry && (
            <Button
              intent="white"
              className="rounded-full"
              leftIcon={<BiRefresh />}
              autoFocus
              onClick={retry.run}
            >
              {retry.label}
            </Button>
          )}
          {onVersions && (
            <Button
              intent={retry ? 'gray-outline' : 'white'}
              className="rounded-full"
              leftIcon={<BiLayer />}
              autoFocus={!retry}
              onClick={onVersions}
            >
              <Trans>Other versions</Trans>
            </Button>
          )}
          {link && (
            <Button
              intent="gray-outline"
              className="rounded-full"
              leftIcon={<BiCopy />}
              onClick={() =>
                copyToClipboard(link, {
                  onSuccess: () => toast.success(t`Stream link copied`),
                  onError: () => toast.error(t`Could not copy the link`),
                })
              }
            >
              <Trans>Copy link</Trans>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Sized from the video's height, as a cue is by default; Firefox reads a percentage against the page font. */
function cueCss(style: SubtitleStyle): string {
  const css = subtitleCss(style);
  return `video::cue {
    font-size: calc(${subtitleScale(style)} * 5vh);
    font-weight: ${css.fontWeight};
    color: ${css.color};
    background-color: ${css.backgroundColor};
    text-shadow: ${css.textShadow};
    ${css.fontFamily ? `font-family: ${css.fontFamily};` : ''}
  }`;
}

/** For a player that draws no subtitles, placed and sized as the page's own video draws cues. */
function SubtitleText({ text, style }: { text: string; style: SubtitleStyle }) {
  const { fontWeight, fontFamily, color, backgroundColor, textShadow } =
    subtitleCss(style);
  return (
    <div
      data-ui="player-subtitle"
      className="pointer-events-none fixed inset-x-0 flex justify-center px-[5%] text-center"
      style={{ bottom: `${100 - subtitleLine(style)}%` }}
    >
      <span
        className="whitespace-pre-line px-2"
        style={{
          fontSize: `calc(${subtitleScale(style)} * 5vh)`,
          fontWeight,
          fontFamily,
          color,
          backgroundColor,
          textShadow,
        }}
      >
        {text}
      </span>
    </div>
  );
}

function useKeepAwake(player: PlayerController, own: boolean) {
  const awake = own && player.state.started && !player.state.paused;
  React.useEffect(() => {
    const { keepAwake } = currentHost();
    if (!awake || !keepAwake) return;
    keepAwake(true);
    return () => keepAwake(false);
  }, [awake]);
}

/**
 * The server's segments and the ones the file's chapters name: where both have
 * a kind, the chapters' when preferred, else the server's. Guesses from
 * chapter lengths fill the kinds neither has.
 */
function useShownSegments(
  item: BaseItemDto,
  segments: MediaSegmentDto[] | null | undefined,
  player: PlayerController
) {
  const { chapters } = player;
  const { durationMs } = player.state;
  const [preferChapters] = useSetting(settings.playback.chapterSkips);
  const episode = item.Type === 'Episode';
  return React.useMemo(() => {
    const named = chapterSegments(chapters ?? [], durationMs);
    const server = segments ?? [];
    const guessed = episode ? guessedSegments(chapters ?? [], durationMs) : [];
    const kinds = new Set<string>();
    return (
      preferChapters ? [named, server, guessed] : [server, named, guessed]
    ).flatMap((source) => {
      const added = source.filter((s) => !kinds.has(String(s.Type)));
      added.forEach((s) => kinds.add(String(s.Type)));
      return added;
    });
  }, [segments, chapters, durationMs, preferChapters, episode]);
}

/**
 * The host's player beneath the page, which stays transparent from the first
 * paint, or the page's own video. The page's cover hides the wait for the
 * first frame; a player in its own window keeps it behind the controls that
 * drive it.
 */
function Player({
  item,
  source,
  playSessionId,
  startMs,
  prefs,
  launched,
  local,
  youTube,
  onCovered,
}: PlayerProps) {
  const { client } = useSession();
  const video = React.useRef<HTMLVideoElement>(null);
  const [hostPlayer] = React.useState(() => currentHost().player);
  const close = React.useRef<() => void>(undefined);
  const ended = useEnded(item, () => close.current?.());
  const { connect } = ended;
  const playlistItemId = usePartyBinding(item.Id!);
  // What the party plays opens paused, until the party starts it.
  const [startPaused] = React.useState(() => !!playlistItemId);
  const inParty = !!useParty();
  const playForParty = usePlayForParty();
  const back = React.useCallback(() => {
    if (playlistItemId) leavePartyPlayback();
    ended.back();
  }, [playlistItemId, ended]);
  const onEnded = React.useCallback(() => {
    if (!playlistItemId) return ended.onEnded();
    const state = party.state();
    const more = !!state && state.queue.length > state.playingIndex + 1;
    party.request(
      more ? { type: 'NextItem', playlistItemId } : { type: 'Stop' }
    );
  }, [playlistItemId, ended]);
  const [subtitleStyle] = useSetting(settings.subtitle.style);
  const [fit] = useSetting(settings.video.fit);
  const localSubtitle = React.useCallback(
    (stream: MediaStream) => {
      const at = local?.subtitleStreams?.indexOf(stream.Index!) ?? -1;
      return at >= 0 ? (local?.local?.subtitles[at] ?? null) : null;
    },
    [local]
  );
  const own = usePlayer(hostPlayer ?? videoEngine(video), {
    client,
    item,
    url: local?.local
      ? local.local.video
      : (youTube ?? directUrl(client, item.Id!, source)),
    headers: local?.local ? undefined : requiredHeaders(source),
    subtitleUrl: local ? localSubtitle : undefined,
    source,
    startMs,
    onEnded,
    onClosed: back,
    onAdvance: (episode) => {
      countPlayedOn();
      navigate(to.play(episode.itemId, episode.source.Id!, episode.startMs), {
        replace: true,
      });
    },
    prefs,
    subtitleStyle,
    launched,
    startPaused,
  });
  const player = usePartyPlayer(own, playlistItemId);
  close.current = player.close;
  const segments = useShownSegments(
    item,
    useSegments(item.Id!).data?.Items,
    player
  );
  const group = React.useMemo(
    () =>
      playlistItemId
        ? {
            step: (direction: 'next' | 'previous', episode: BaseItemDto) => {
              const state = party.state();
              const at =
                (state?.playingIndex ?? 0) + (direction === 'next' ? 1 : -1);
              if (state?.queue[at])
                party.request({
                  type: direction === 'next' ? 'NextItem' : 'PreviousItem',
                  playlistItemId,
                });
              else void playForParty(episode, null);
            },
            play: (episode: BaseItemDto) => void playForParty(episode, null),
          }
        : undefined,
    [playlistItemId, playForParty]
  );
  const next = useNextEpisodePrompt({
    item,
    source,
    player,
    segments,
    onBack: back,
    group,
  });
  connect(next);
  const switchVersion = useSwitchVersion(item, source, player);
  const together = () =>
    openPartySheet(
      inParty
        ? {}
        : {
            play: {
              title: fullTitle(item),
              run: () => {
                own.setPaused(true);
                return playForParty(item, source, own.playhead.positionMs);
              },
            },
          }
    );
  const controls = useShowTrackPicks(player, item, source);
  useReporting(player, { item, source, playSessionId });
  useNowPlaying(item, player, {
    onStop: back,
    onNext: next.next ? next.playNext : undefined,
    onPrevious: next.previous ? next.playPrevious : undefined,
  });
  useKeepAwake(player, !hostPlayer);
  const launchedName = launched?.name ?? '';
  const failure = player.state.error ?? '';
  const covered =
    !player.state.pictureInPicture && (!player.state.started || !!launched);
  React.useLayoutEffect(() => onCovered(covered), [covered, onCovered]);

  if (player.state.pictureInPicture)
    return <div data-page="player" className="fixed inset-0" />;
  return (
    <div data-page="player" className="fixed inset-0">
      {!hostPlayer && (
        <>
          <style>{cueCss(subtitleStyle)}</style>
          <video
            ref={video}
            data-ui="video"
            className={cn(
              'h-full w-full bg-black transition-opacity duration-700 ease-out',
              OBJECT_FIT[fit],
              !player.state.started && 'opacity-0'
            )}
            autoPlay
            playsInline
          />
        </>
      )}
      {player.subtitleText && (
        <SubtitleText text={player.subtitleText} style={subtitleStyle} />
      )}
      {player.stats?.text && (
        <pre
          data-ui="player-stats"
          className="pointer-events-none fixed start-[calc(1rem+env(safe-area-inset-left))] top-[calc(4.5rem+env(safe-area-inset-top))] rounded-lg bg-black/60 px-3 py-2 font-mono text-xs leading-relaxed text-white/90"
        >
          {player.stats.text}
        </pre>
      )}
      {launched && (
        <p
          data-ui="player-external"
          className="pointer-events-none fixed inset-x-0 top-1/4 text-center text-lg font-medium text-white/80"
        >
          <Trans>Playing in {launchedName}</Trans>
        </p>
      )}
      {player.state.error ? (
        <Failure
          itemId={item.Id!}
          item={item}
          source={source}
          message={t`Playback failed: ${failure}`}
          onVersions={switchVersion}
          retry={player.retry}
        />
      ) : (
        <>
          {!next.asking && (
            <PlayerControls
              item={item}
              player={controls}
              segments={segments}
              onBack={back}
              offeringNext={!!next.element}
              onVersions={switchVersion}
              onPrevious={next.previous ? next.playPrevious : undefined}
              onNext={next.next ? next.playNext : undefined}
              onEpisode={next.playEpisode}
              loadingEpisode={next.loading}
              onParty={together}
            />
          )}
          {inParty && <PartyLayer />}
          {next.element}
        </>
      )}
    </div>
  );
}
