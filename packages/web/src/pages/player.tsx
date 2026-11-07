import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  BiArrowBack,
  BiChevronDown,
  BiChevronUp,
  BiCopy,
  BiLayer,
  BiRefresh,
} from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import {
  useItem,
  usePlaybackInfo,
  usePlaybackInfoOptions,
  useRefreshAll,
  useSegments,
} from '../lib/queries';
import { lastVersions, playableSources } from '../lib/playback/play';
import { type LiveText, useLiveText } from '../lib/playback/live-text';
import { chosenPlayer } from '../lib/playback/player-choice';
import {
  directUrl,
  requiredHeaders,
  useYouTubeStream,
} from '../lib/playback/stream';
import { PlaybackReporter } from '../lib/playback/reporter';
import { currentHost } from '../lib/hosts';
import { appLog } from '../lib/hosts/shell/bridge';
import { useFeature } from '../lib/server-info';
import {
  leaveFullscreen,
  usePlayerFullscreen,
} from '../lib/playback/fullscreen';
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
  SUBTITLE_LIFT_EASE,
  SUBTITLE_LIFT_MS,
  subtitleCss,
  subtitleHeight,
  subtitleLine,
  subtitleScale,
} from '../lib/subtitles/style';
import { usePlaybackPrefs, type PlaybackPrefs } from '../lib/user-config';
import { fullTitle } from '../lib/format';
import { navigate, to, versionsPath } from '../lib/paths';
import {
  canMinimise,
  closePlayback,
  minimisePlayback,
  playOn,
  setLaunched,
  stopPlayback,
  usePlayback,
} from '../lib/playback/session';
import { noteChannelPlayed } from '../lib/live-tv';
import { useZap, type Zap } from '../components/player/live';
import { useAction } from '../lib/input';
import {
  MiniPlayer,
  type MiniVideoPlace,
} from '../components/player/mini-player';
import { noteLastPlayed } from '../lib/last-played';
import { PlayerControls } from '../components/player/controls';
import {
  countPlayedOn,
  useUpNextPrompt,
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
import {
  leavePartyPlayback,
  usePartyBinding,
  usePartyNeighbours,
} from '../lib/party/follow';
import { usePlayForParty } from '../lib/party/actions';
import { usePartyPlayer } from '../lib/party/playback';
import { PartyLayer } from '../components/party/party-layer';
import { useRemotePlayer } from '../components/remote-target';
import { indexForTrack } from '../lib/remote/tracks';
import { useLatest } from '../lib/use-latest';
import { openPartySheet } from '../components/party/party-sheet';
import { usePlaylistEdits, usePlaylistName } from '../lib/playlists';

interface PlayerProps {
  mini: boolean;
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
  /** The playlist it was started from. */
  playlist?: string;
}

/**
 * The page keeps no scrollbar, or the space reserved for one, over the video,
 * and no backdrop (see PageBackground).
 */
export function usePlayerPage(enabled = true) {
  React.useLayoutEffect(() => {
    if (!enabled) return;
    const html = document.documentElement;
    const previous = [html.style.overflowY, html.style.scrollbarGutter];
    html.style.overflowY = 'hidden';
    html.style.scrollbarGutter = 'auto';
    html.classList.add('playing');
    return () => {
      [html.style.overflowY, html.style.scrollbarGutter] = previous;
      html.classList.remove('playing');
    };
  }, [enabled]);
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
  playlist,
  mini,
}: {
  itemId: string;
  sourceId: string;
  startMs: number;
  playlist?: string;
  mini: boolean;
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
  const listed = usePlaybackInfo(itemId, { enabled: !local && !sourceId });
  const named = sourceId || playableSources(listed.data)[0]?.Id || undefined;
  const info = usePlaybackInfo(itemId, {
    sourceId: named,
    enabled: !local && !!named,
  });
  const playback = usePlaybackPrefs();
  const picks = useShowPicks();
  usePlayerPage(!mini);
  const host = currentHost();
  usePlayerFullscreen((!host.player || !!host.fullscreen) && !mini);

  // Pinned once found: a refreshed version list must not restart playback.
  const [playing, setPlaying] = React.useState<Omit<
    PlayerProps,
    'startMs' | 'onCovered' | 'playlist' | 'mini'
  > | null>(null);
  const [covered, setCovered] = React.useState(true);
  const sources = local ? [local.source!] : playableSources(info.data);
  const source = named ? sources.find((s) => s.Id === named) : sources[0];
  const missing =
    !playing &&
    !!item.data &&
    (info.data ? !source : !sourceId && !!listed.error);
  const channel = item.data?.Type === 'TvChannel';
  const zap = useZap(itemId, channel);
  const youTubeId = playing ? undefined : source?.aiostreams?.ytId;
  const youTube = useYouTubeStream(youTubeId);
  const miniNow = React.useRef(mini);
  miniNow.current = mini;
  React.useEffect(() => {
    if (!missing || !item.data) return;
    lastVersions.set(itemId, undefined);
    // In the mini player, a title moved on to has no page to list its versions on.
    if (miniNow.current) {
      closePlayback();
      if (channel) toast.error(t`Nothing plays on this channel right now.`);
    }
    // A channel stays in the player, which zaps on from it.
    else if (!channel)
      navigate(versionsPath(item.data, playlist), { replace: true });
  }, [missing, item.data, itemId, playlist, channel]);
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
    listed.isLoading ||
    info.isLoading ||
    playback.isLoading ||
    picks.isLoading ||
    youTube.isLoading ||
    (missing && !channel);
  const failed = missing
    ? t`Nothing plays on this channel right now.`
    : youTubeId && !youTube.data
      ? t`This video didn't load.`
      : t`This version is no longer available.`;
  if (mini && !playing)
    return <MiniPlayer item={item.data} error={loading ? undefined : failed} />;
  return (
    <>
      {!mini && (
        <Cover
          item={item.data}
          hidden={!!playing && !covered}
          status={
            !sourceId && !playing && loading ? t`Finding a version…` : undefined
          }
        />
      )}
      {playing ? (
        <VersionPickerProvider>
          <Player
            {...playing}
            startMs={startMs}
            playlist={playlist}
            onCovered={setCovered}
            mini={mini}
          />
        </VersionPickerProvider>
      ) : loading ? null : (
        <Failure itemId={itemId} message={failed} zap={zap} />
      )}
    </>
  );
}

/**
 * The end of the file plays on or stops; a ref, since the player needs the
 * handler before the prompt that decides it exists. Stopping closes a player
 * in its own window, which playing on keeps.
 */
function useEnded(item: BaseItemDto, mini: boolean, close?: () => void) {
  const latestClose = React.useRef(close);
  latestClose.current = close;
  const small = React.useRef(mini);
  small.current = mini;
  const stop = React.useCallback(() => {
    latestClose.current?.();
    if (small.current) closePlayback();
    else stopPlayback(to.item(item.Id!));
  }, [item.Id]);
  const ended = React.useRef(stop);
  const onEnded = React.useCallback(() => ended.current(), []);
  const connect = (next: ReturnType<typeof useUpNextPrompt>) => {
    ended.current = () => {
      if (!next.autoplay || !next.next) return stop();
      void next.playOn().then((ok) => {
        if (!ok) stop();
      });
    };
  };
  return { stop, onEnded, connect };
}

function useSwitchVersion(
  item: BaseItemDto,
  source: SourceInfo,
  player: PlayerController,
  playlist?: string
) {
  const picker = useVersionPicker();
  return () =>
    picker.open(item, {
      startMs: player.playhead.positionMs,
      playing: source.Id ?? undefined,
      playlist,
    });
}

function useNextLiveVersion(
  item: BaseItemDto,
  source: SourceInfo,
  playlist?: string
) {
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  return async (): Promise<boolean> => {
    const info = await queryClient
      .fetchQuery(infoOptions(item.Id!))
      .catch(() => undefined);
    const versions = playableSources(info);
    const index = versions.findIndex((v) => v.Id === source.Id) + 1;
    const next = versions[index];
    if (!next) return false;
    appLog('info', `live: trying version ${index + 1} of ${versions.length}`);
    playOn({ itemId: item.Id!, sourceId: next.Id!, startMs: 0, playlist });
    return true;
  };
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
  const tracks = useLatest(() => {
    const streams = source.MediaStreams ?? [];
    return {
      audio: indexForTrack(
        streams,
        player.audioTracks,
        'audio',
        player.state.audio
      ),
      subtitle: indexForTrack(
        streams,
        player.subtitleTracks,
        'subtitle',
        player.state.subtitle
      ),
    };
  });
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
    if (started && item.Type === 'TvChannel')
      noteChannelPlayed(user.Id!, item.Id!);
  }, [started, user.Id, item.Type, item.Id]);

  const live = !!source.IsInfiniteStream;
  React.useEffect(() => {
    if (!started) return;
    const current = new PlaybackReporter(
      client,
      {
        itemId: item.Id!,
        mediaSourceId: source.Id!,
        playSessionId,
        userId: user.Id,
        live,
      },
      () => ({
        ms: player.playhead.positionMs,
        paused: state.current.paused,
        ...tracks.current(),
      })
    );
    current.start();
    reporter.current = current;
    const onHide = () => void current.stop();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      // The position it leaves is what the pages behind offer to resume; live keeps none.
      void current.stop().then(() => {
        if (!live) refresh.current();
      });
      reporter.current = null;
    };
  }, [started, client, user.Id, item.Id, source.Id, playSessionId, live]);

  React.useEffect(() => {
    reporter.current?.progress(paused ? 'Pause' : 'Unpause');
  }, [paused]);

  const { audio, subtitle } = player.state;
  React.useEffect(() => {
    reporter.current?.progress('AudioTrackChange');
  }, [audio]);
  React.useEffect(() => {
    reporter.current?.progress('SubtitleTrackChange');
  }, [subtitle]);
}

function Failure({
  itemId,
  message,
  item,
  source,
  onVersions,
  retry,
  zap,
}: {
  itemId: string;
  message: string;
  item?: BaseItemDto;
  source?: SourceInfo;
  onVersions?: () => void;
  retry?: { label: string; run(): void };
  zap?: Zap;
}) {
  const { client } = useSession();
  const step = zap?.step;
  const leave = () => stopPlayback(to.item(itemId));
  // A TV's Back would look for the navigation, which the player covers.
  useAction('back', leave);
  useAction('live.channelUp', () => step?.(1) ?? false, !!step);
  useAction('live.channelDown', () => step?.(-1) ?? false, !!step);
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
            autoFocus={!onVersions && !retry && !step}
            onClick={leave}
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
          {step && (
            <>
              <Button
                data-name="previous-channel"
                intent="gray-outline"
                className="rounded-full"
                leftIcon={<BiChevronUp />}
                onClick={() => step(-1)}
              >
                <Trans>Previous channel</Trans>
              </Button>
              <Button
                data-name="next-channel"
                intent={retry || onVersions ? 'gray-outline' : 'white'}
                className="rounded-full"
                leftIcon={<BiChevronDown />}
                autoFocus={!retry && !onVersions}
                onClick={() => step(1)}
              >
                <Trans>Next channel</Trans>
              </Button>
            </>
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
function SubtitleText({
  text,
  style,
  lift,
}: {
  text: string;
  style: SubtitleStyle;
  lift: number;
}) {
  const { fontWeight, fontFamily, color, backgroundColor, textShadow } =
    subtitleCss(style);
  const raise = subtitleHeight(style, lift) - subtitleHeight(style);
  return (
    <div
      data-ui="player-subtitle"
      className="pointer-events-none fixed inset-x-0 flex justify-center px-[5%] text-center transition-transform motion-reduce:transition-none"
      style={{
        bottom: `${100 - subtitleLine(style)}%`,
        transform: `translateY(${-raise}vh)`,
        transitionDuration: `${SUBTITLE_LIFT_MS}ms`,
        transitionTimingFunction: SUBTITLE_LIFT_EASE,
      }}
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

/** What another device queues goes into the playlist this plays from: after this title, or at the end. */
function useQueue(item: BaseItemDto, playlist?: string) {
  const edits = usePlaylistEdits();
  const name = usePlaylistName(playlist) ?? '';
  if (!playlist) return undefined;
  return (itemIds: string[], soon: boolean) =>
    void edits.add(playlist, itemIds, soon ? item.Id! : undefined).then(
      (added) => added && toast.success(t`Added to ${name}`),
      () => toast.error(t`Could not add to ${name}`)
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
  playlist,
  mini,
}: PlayerProps) {
  const { client } = useSession();
  const video = React.useRef<HTMLVideoElement>(null);
  const [hostPlayer] = React.useState(() => currentHost().player);
  const close = React.useRef<() => void>(undefined);
  const ended = useEnded(item, mini, () => close.current?.());
  const { connect } = ended;
  const playlistItemId = usePartyBinding(item.Id!);
  // What the party plays opens paused, until the party starts it.
  const [startPaused] = React.useState(() => !!playlistItemId);
  const inParty = !!useParty();
  const playForParty = usePlayForParty();
  const queued = usePartyNeighbours(playlistItemId);
  const stopEnded = ended.stop;
  const stop = React.useCallback(() => {
    if (playlistItemId) leavePartyPlayback();
    stopEnded();
  }, [playlistItemId, stopEnded]);
  const minimise =
    canMinimise() && !launched
      ? () => minimisePlayback(to.item(item.Id!))
      : undefined;
  React.useEffect(() => {
    setLaunched(!!launched);
    return () => setLaunched(false);
  }, [launched]);
  const docked = !!usePlayback()?.docked;
  // A party's player stops, whatever the setting; a preview's goes back to it.
  const back = () => {
    if (docked && !playlistItemId && !launched) minimisePlayback(to.live());
    else if (
      minimise &&
      !playlistItemId &&
      settings.player.back.read() === 'minimise'
    )
      minimise();
    else stop();
  };
  const onEnded = React.useCallback(() => {
    if (!playlistItemId) return ended.onEnded();
    const state = party.state();
    const more = !!state && state.queue.length > state.playingIndex + 1;
    party.request(
      more ? { type: 'NextItem', playlistItemId } : { type: 'Stop' }
    );
  }, [playlistItemId, ended]);
  const nextLiveVersion = useNextLiveVersion(item, source, playlist);
  const zap = useZap(item.Id!, item.Type === 'TvChannel');
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
    onClosed: stop,
    onAdvance: (next) => {
      countPlayedOn();
      playOn({
        itemId: next.itemId,
        sourceId: next.source.Id!,
        startMs: next.startMs,
        playlist: next.playlist,
      });
    },
    // A party plays one version for everyone.
    onLiveFailed: playlistItemId ? undefined : nextLiveVersion,
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
            queued,
            step: (direction: 'next' | 'previous') =>
              party.request({
                type: direction === 'next' ? 'NextItem' : 'PreviousItem',
                playlistItemId,
              }),
            play: (target: BaseItemDto, playlist?: string) =>
              void playForParty(target, null, 0, playlist),
          }
        : undefined,
    [playlistItemId, playForParty, queued]
  );
  const next = useUpNextPrompt({
    item,
    source,
    player,
    segments,
    onBack: stop,
    group,
    playlist,
  });
  connect(next);
  const switchVersion = useSwitchVersion(item, source, player, next.playlist);
  const together = () =>
    openPartySheet(
      inParty
        ? {}
        : {
            play: {
              title: fullTitle(item),
              run: () => {
                own.setPaused(true);
                return playForParty(
                  item,
                  source,
                  own.playhead.positionMs,
                  next.playlist
                );
              },
            },
          }
    );
  const queue = useQueue(item, next.playlist);
  const controls = useShowTrackPicks(player, item, source);
  useReporting(player, { item, source, playSessionId });
  const act = useNowPlaying(item, player, {
    onStop: stop,
    onNext: next.next ? next.playNext : undefined,
    onPrevious: next.previous ? next.playPrevious : undefined,
  });
  useRemotePlayer(controls, item, source, act, queue);
  useKeepAwake(player, !hostPlayer);
  const launchedName = launched?.name ?? '';
  const failure = player.state.error ?? '';
  const covered =
    !player.state.pictureInPicture && (!player.state.started || !!launched);
  React.useLayoutEffect(() => onCovered(covered), [covered, onCovered]);
  const [place, setPlace] = React.useState<MiniVideoPlace | null>(null);
  React.useEffect(() => {
    if (mini) leaveFullscreen();
  }, [mini]);

  if (player.state.pictureInPicture)
    return <div data-page="player" className="fixed inset-0" />;
  // The same element either way, as a new video would start the file again.
  return (
    <div data-page="player" className={mini ? 'contents' : 'fixed inset-0'}>
      {!hostPlayer && (
        <>
          <style>{cueCss(subtitleStyle)}</style>
          <video
            ref={video}
            data-ui="video"
            className={cn(
              'h-full w-full bg-black transition-opacity duration-700 ease-out',
              // Over the mini player's card, which comes after it.
              mini
                ? 'pointer-events-none fixed left-0 top-0 z-[41] object-contain'
                : OBJECT_FIT[fit],
              !player.state.started && 'opacity-0'
            )}
            style={mini && place ? place : undefined}
            autoPlay
            playsInline
          />
        </>
      )}
      {mini && (
        <MiniPlayer
          item={item}
          player={player}
          error={player.state.error ? failure : undefined}
          onVideoPlace={hostPlayer ? undefined : setPlace}
        />
      )}
      {!mini && (
        <>
          <PageSubtitle
            text={player.subtitleText}
            style={subtitleStyle}
            lift={player.subtitleLift}
          />
          {player.stats && <PlayerStats text={player.stats.text} />}
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
              zap={zap}
            />
          ) : (
            <>
              {!next.asking && (
                <PlayerControls
                  item={item}
                  player={controls}
                  segments={segments}
                  onBack={back}
                  onMinimise={minimise}
                  offeringNext={!!next.element}
                  onVersions={switchVersion}
                  onPrevious={next.previous ? next.playPrevious : undefined}
                  onNext={next.next ? next.playNext : undefined}
                  onEpisode={next.playEpisode}
                  loadingEpisode={next.loading}
                  steps={next.listed ? 'playlist' : undefined}
                  playlist={
                    next.playlist
                      ? { id: next.playlist, onPlay: next.playEntry }
                      : undefined
                  }
                  onParty={together}
                  live={!!source.IsInfiniteStream}
                />
              )}
              {inParty && <PartyLayer />}
              {next.element}
            </>
          )}
        </>
      )}
    </div>
  );
}

function PageSubtitle({
  text,
  ...props
}: { text: LiveText } & Omit<
  React.ComponentProps<typeof SubtitleText>,
  'text'
>) {
  const line = useLiveText(text);
  return line ? <SubtitleText text={line} {...props} /> : null;
}

function PlayerStats({ text }: { text: LiveText }) {
  const shown = useLiveText(text);
  if (!shown) return null;
  return (
    <pre
      data-ui="player-stats"
      className="pointer-events-none fixed start-[calc(1rem+env(safe-area-inset-left))] top-[calc(4.5rem+env(safe-area-inset-top))] rounded-lg bg-black/60 px-3 py-2 font-mono text-xs leading-relaxed text-white/90"
    >
      {shown}
    </pre>
  );
}
