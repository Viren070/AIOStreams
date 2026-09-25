import React from 'react';
import { storage } from './storage';
import { subtitleUrl, textSubtitles } from './playback';
import {
  desktopApi,
  desktopFullscreen,
  onDesktopSettings,
  type JmpPlayer,
} from './hosts';
import type { JellyfinClient } from './client';
import type { MediaStream, SourceInfo } from './types';

export interface Track {
  id: string;
  label: string;
}

export interface PlayerState {
  /** The first frame has played. */
  started: boolean;
  paused: boolean;
  waiting: boolean;
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  volume: number;
  muted: boolean;
  rate: number;
  fullscreen: boolean;
  audio: string | null;
  subtitle: string | null;
  error: string | null;
}

/** One set of controls over whichever player the page runs in. */
export interface PlayerController {
  state: PlayerState;
  audioTracks: Track[];
  subtitleTracks: Track[];
  togglePlay(): void;
  seek(ms: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  setRate(rate: number): void;
  setAudio(id: string): void;
  setSubtitle(id: string | null): void;
  toggleFullscreen(): void;
}

interface PlayerOptions {
  source: SourceInfo;
  startMs: number;
  onEnded(): void;
}

const VOLUME_KEY = 'aiostreams-web-volume';

function storedVolume(): { volume: number; muted: boolean } {
  const saved = storage.get<{ volume: number; muted: boolean }>(VOLUME_KEY);
  return {
    volume: Math.min(1, Math.max(0, saved?.volume ?? 1)),
    muted: saved?.muted ?? false,
  };
}

function initialState(source: SourceInfo, startMs: number): PlayerState {
  return {
    started: false,
    paused: false,
    waiting: true,
    positionMs: startMs,
    durationMs: source.RunTimeTicks ? source.RunTimeTicks / 10_000 : 0,
    bufferedMs: 0,
    rate: 1,
    fullscreen: false,
    audio: null,
    subtitle: null,
    error: null,
    ...storedVolume(),
  };
}

function useLatest<T>(value: T) {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

function trackLabel(stream: MediaStream, n: number): string {
  return stream.DisplayTitle || stream.Title || stream.Language || `Track ${n}`;
}

function ofType(source: SourceInfo, type: MediaStream['Type']) {
  return (source.MediaStreams ?? []).filter((s) => s.Type === type);
}

function toggleDocumentFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/** A `<video>` element; its external subtitles are `<track>`s in source order. */
export function useBrowserPlayer(
  video: React.RefObject<HTMLVideoElement | null>,
  opts: PlayerOptions
): PlayerController {
  const { source, startMs } = opts;
  const [state, setState] = React.useState(() => initialState(source, startMs));
  const onEnded = useLatest(opts.onEnded);
  const subtitles = React.useMemo(() => textSubtitles(source), [source]);
  const patch = (next: Partial<PlayerState>) =>
    setState((s) => ({ ...s, ...next }));

  React.useEffect(() => {
    const el = video.current;
    if (!el) return;
    const { volume, muted } = storedVolume();
    el.volume = volume;
    el.muted = muted;
    const bufferedEnd = () => {
      for (let i = el.buffered.length - 1; i >= 0; i--) {
        if (el.buffered.start(i) <= el.currentTime)
          return el.buffered.end(i) * 1000;
      }
      return 0;
    };
    const handlers: Record<string, () => void> = {
      loadedmetadata: () => {
        if (startMs) el.currentTime = startMs / 1000;
        patch({ durationMs: el.duration * 1000 || 0 });
      },
      durationchange: () => patch({ durationMs: el.duration * 1000 || 0 }),
      playing: () => patch({ started: true, paused: false, waiting: false }),
      pause: () => patch({ paused: true }),
      play: () => patch({ paused: false }),
      waiting: () => patch({ waiting: true }),
      canplay: () => patch({ waiting: false }),
      timeupdate: () =>
        patch({ positionMs: el.currentTime * 1000, bufferedMs: bufferedEnd() }),
      progress: () => patch({ bufferedMs: bufferedEnd() }),
      volumechange: () => {
        patch({ volume: el.volume, muted: el.muted });
        storage.set(VOLUME_KEY, { volume: el.volume, muted: el.muted });
      },
      ratechange: () => patch({ rate: el.playbackRate }),
      ended: () => onEnded.current(),
      error: () =>
        patch({
          error:
            'This browser cannot play this version. Nothing is converted on the server, so try another version or a player app.',
        }),
    };
    for (const [event, handler] of Object.entries(handlers))
      el.addEventListener(event, handler);
    const onFullscreen = () =>
      patch({ fullscreen: !!document.fullscreenElement });
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      for (const [event, handler] of Object.entries(handlers))
        el.removeEventListener(event, handler);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [video, startMs, onEnded]);

  const el = () => video.current;
  return {
    state,
    audioTracks: [],
    subtitleTracks: subtitles.map((s, i) => ({
      id: String(s.Index),
      label: trackLabel(s, i + 1),
    })),
    togglePlay: () => {
      const v = el();
      if (!v) return;
      if (v.paused) void v.play().catch(() => {});
      else v.pause();
    },
    seek: (ms) => {
      const v = el();
      if (!v) return;
      v.currentTime = ms / 1000;
      patch({ positionMs: ms });
    },
    setVolume: (volume) => {
      const v = el();
      if (!v) return;
      v.volume = volume;
      v.muted = volume === 0;
    },
    toggleMute: () => {
      const v = el();
      if (!v) return;
      if (v.muted && v.volume === 0) v.volume = 0.5;
      v.muted = !v.muted;
    },
    setRate: (rate) => {
      const v = el();
      if (v) v.playbackRate = rate;
    },
    setAudio: () => {},
    setSubtitle: (id) => {
      const tracks = el()?.textTracks;
      if (!tracks) return;
      subtitles.forEach((s, i) => {
        const track = tracks[i];
        if (track) track.mode = String(s.Index) === id ? 'showing' : 'disabled';
      });
      patch({ subtitle: id });
    },
    toggleFullscreen: toggleDocumentFullscreen,
  };
}

/**
 * The desktop app's mpv, drawn beneath the page. It picks tracks by their
 * position within each type.
 */
export function useDesktopPlayer(
  opts: PlayerOptions & {
    client: JellyfinClient;
    url: string;
    metadata: Record<string, unknown>;
  }
): PlayerController {
  const { source, startMs, url } = opts;
  const [state, setState] = React.useState(() => ({
    ...initialState(source, startMs),
    fullscreen: desktopFullscreen(),
  }));
  const [player, setPlayer] = React.useState<JmpPlayer | null>(null);
  const latest = useLatest({ ...opts, state });
  const patch = (next: Partial<PlayerState>) =>
    setState((s) => ({ ...s, ...next }));

  const audio = ofType(source, 'Audio');
  const subtitles = ofType(source, 'Subtitle');
  const embedded = subtitles.filter((s) => s.DeliveryMethod !== 'External');
  const external = subtitles.filter((s) => s.DeliveryMethod === 'External');
  const defaultAudio = Math.max(
    1,
    audio.findIndex((s) => s.Index === source.DefaultAudioStreamIndex) + 1
  );

  React.useEffect(
    () => onDesktopSettings(() => patch({ fullscreen: desktopFullscreen() })),
    []
  );

  React.useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    void desktopApi().then((api) => {
      if (!api || cancelled) return;
      const mpv = api.player;
      setPlayer(mpv);
      let started = false;
      const { volume, muted } = storedVolume();
      const handlers = {
        playing: () => {
          if (!started) {
            started = true;
            mpv.setVolume(Math.round(volume * 100));
            mpv.setMuted(muted);
            mpv.setVideoRectangle(0, 0, 0, 0);
          }
          patch({ started: true, paused: false, waiting: false });
        },
        paused: () => patch({ paused: true, waiting: false }),
        buffering: () => patch({ waiting: true }),
        positionUpdate: (ms: number) => patch({ positionMs: ms }),
        updateDuration: (ms: number) => patch({ durationMs: ms }),
        finished: () => latest.current.onEnded(),
        error: (message: string) => patch({ error: message }),
      };
      mpv.playing.connect(handlers.playing);
      mpv.paused.connect(handlers.paused);
      mpv.buffering.connect(handlers.buffering);
      mpv.positionUpdate.connect(handlers.positionUpdate);
      mpv.updateDuration.connect(handlers.updateDuration);
      mpv.finished.connect(handlers.finished);
      mpv.error.connect(handlers.error);
      mpv.load(
        url,
        { startMilliseconds: startMs, autoplay: true },
        {
          type: 'video',
          headers: { 'User-Agent': window.jmpInfo?.userAgent ?? '' },
          metadata: latest.current.metadata,
          media: {},
        },
        defaultAudio,
        -1,
        () => {}
      );
      patch({ audio: audio.length ? String(defaultAudio) : null });
      cleanup = () => {
        mpv.playing.disconnect(handlers.playing);
        mpv.paused.disconnect(handlers.paused);
        mpv.buffering.disconnect(handlers.buffering);
        mpv.positionUpdate.disconnect(handlers.positionUpdate);
        mpv.updateDuration.disconnect(handlers.updateDuration);
        mpv.finished.disconnect(handlers.finished);
        mpv.error.disconnect(handlers.error);
        mpv.stop();
        mpv.setVideoRectangle(-1, 0, 0, 0);
      };
    });
    return () => {
      cancelled = true;
      cleanup();
    };
    // Reloading restarts playback, so only a new url or start does it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, startMs]);

  const setVolume = (volume: number, muted = volume === 0) => {
    player?.setVolume(Math.round(volume * 100));
    player?.setMuted(muted);
    storage.set(VOLUME_KEY, { volume, muted });
    patch({ volume, muted });
  };

  return {
    state,
    audioTracks: audio.map((s, i) => ({
      id: String(i + 1),
      label: trackLabel(s, i + 1),
    })),
    subtitleTracks: [
      ...embedded.map((s, i) => ({
        id: `embedded:${i + 1}`,
        label: trackLabel(s, i + 1),
      })),
      ...external.map((s, i) => ({
        id: `external:${s.Index}`,
        label: trackLabel(s, embedded.length + i + 1),
      })),
    ],
    togglePlay: () =>
      latest.current.state.paused ? player?.play() : player?.pause(),
    seek: (ms) => {
      player?.seekTo(ms);
      patch({ positionMs: ms });
    },
    setVolume: (volume) => setVolume(volume),
    toggleMute: () => {
      const { volume, muted } = latest.current.state;
      setVolume(muted && volume === 0 ? 0.5 : volume, !muted);
    },
    setRate: (rate) => {
      player?.setPlaybackRate(rate * 1000);
      patch({ rate });
    },
    setAudio: (id) => {
      player?.setAudioStream(Number(id));
      patch({ audio: id });
    },
    setSubtitle: (id) => {
      if (!id) player?.setSubtitleStream(0);
      else if (id.startsWith('embedded:'))
        player?.setSubtitleStream(Number(id.slice('embedded:'.length)));
      else {
        const stream = external.find((s) => `external:${s.Index}` === id);
        const link = stream && subtitleUrl(opts.client, stream);
        if (link) player?.setSubtitleStream(`#,${link}`);
      }
      patch({ subtitle: id });
    },
    toggleFullscreen: () =>
      void desktopApi().then((api) =>
        api?.input.executeActions(['host:fullscreen'])
      ),
  };
}
