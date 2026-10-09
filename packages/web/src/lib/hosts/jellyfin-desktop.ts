import React from 'react';
import { storage } from '../storage';
import { subtitleUrl } from '../subtitles/tracks';
import type { BaseItemDto } from '../types';
import type { Host } from '.';
import { nativeShellParts } from './native-shell';
import {
  initialState,
  ofType,
  storedVolume,
  trackLabel,
  VOLUME_KEY,
  type NativePlayerOptions,
  type PlayerController,
  type PlayerState,
} from '../playback/controller';
import { useLatest } from '../use-latest';
import { usePlayheadWriter } from '../playback/playhead';

/** Signals the desktop client's player exposes over its web channel. */
interface JmpSignal<T extends unknown[] = []> {
  connect(fn: (...args: T) => void): void;
  disconnect(fn: (...args: T) => void): void;
}

interface JmpPlayer {
  load(
    url: string,
    options: { startMilliseconds: number; autoplay: boolean },
    streamdata: Record<string, unknown>,
    audioStream: number | string,
    subtitleStream: number | string,
    callback: () => void
  ): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(ms: number): void;
  /** 0 to 100. */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** mpv's 1-based track id within its type, or `#,<url>` for a file. */
  setAudioStream(stream: number | string): void;
  setSubtitleStream(stream: number | string): void;
  /** The speed times 1000. */
  setPlaybackRate(rate: number): void;
  setVideoRectangle(x: number, y: number, w: number, h: number): void;
  playing: JmpSignal;
  paused: JmpSignal;
  buffering: JmpSignal<[number]>;
  finished: JmpSignal;
  stopped: JmpSignal;
  error: JmpSignal<[string]>;
  positionUpdate: JmpSignal<[number]>;
  updateDuration: JmpSignal<[number]>;
}

interface JmpApi {
  player: JmpPlayer;
  input: { executeActions(actions: string[]): void };
  window: { setCursorVisibility(visible: boolean): void };
}

declare global {
  interface Window {
    jmpInfo?: {
      userAgent?: string;
      settings?: { main?: { fullscreen?: boolean } };
      settingsUpdate?: ((section: string) => void)[];
    };
    apiPromise?: Promise<JmpApi>;
  }
}

async function desktopApi(): Promise<JmpApi | null> {
  return window.apiPromise ? window.apiPromise.catch(() => null) : null;
}

function desktopFullscreen(): boolean {
  return window.jmpInfo?.settings?.main?.fullscreen === true;
}

/** Calls `listener` whenever the desktop app's settings change. */
function onDesktopSettings(listener: () => void): () => void {
  const listeners = window.jmpInfo?.settingsUpdate;
  if (!listeners) return () => {};
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}

/** Titles only: the app fetches artwork from the server's root, not ours. */
function loadMetadata(item: BaseItemDto): Record<string, unknown> {
  return {
    Name: item.Name,
    Type: item.Type,
    SeriesName: item.SeriesName,
    IndexNumber: item.IndexNumber,
    ParentIndexNumber: item.ParentIndexNumber,
    ProductionYear: item.ProductionYear,
    RunTimeTicks: item.RunTimeTicks,
  };
}

/**
 * The desktop app's mpv, drawn beneath the page. It picks tracks by their
 * position within each type.
 */
export function useDesktopPlayer(opts: NativePlayerOptions): PlayerController {
  const { source, startMs, url } = opts;
  const [state, setState] = React.useState(() => ({
    ...initialState(source),
    fullscreen: desktopFullscreen(),
  }));
  const playhead = usePlayheadWriter(startMs);
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
  const startSubtitle = subtitles.find(
    (s) => s.Index === source.DefaultSubtitleStreamIndex
  );
  const startSubtitleId = !startSubtitle
    ? null
    : embedded.includes(startSubtitle)
      ? `embedded:${embedded.indexOf(startSubtitle) + 1}`
      : `external:${startSubtitle.Index}`;
  /** The player's subtitle stream: a position among the embedded ones, or `#,` and a link. */
  const desktopSubtitle = (id: string): number | string | null => {
    if (id.startsWith('embedded:')) return Number(id.slice('embedded:'.length));
    const stream = external.find((s) => `external:${s.Index}` === id);
    const link = stream && subtitleUrl(opts.client, stream);
    return link ? `#,${link}` : null;
  };

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
        positionUpdate: (ms: number) => playhead.set({ positionMs: ms }),
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
          metadata: loadMetadata(latest.current.item),
          media: {},
        },
        defaultAudio,
        (startSubtitleId && desktopSubtitle(startSubtitleId)) ?? -1,
        () => {}
      );
      patch({
        audio: audio.length ? String(defaultAudio) : null,
        subtitle: startSubtitleId,
      });
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
    playhead,
    audioTracks: audio.map((s, i) => ({
      id: String(i + 1),
      label: trackLabel(s, i + 1),
      lang: s.Language ?? undefined,
    })),
    subtitleTracks: [
      ...embedded.map((s, i) => ({
        id: `embedded:${i + 1}`,
        label: trackLabel(s, i + 1),
        lang: s.Language ?? undefined,
      })),
      ...external.map((s, i) => ({
        id: `external:${s.Index}`,
        label: trackLabel(s, embedded.length + i + 1),
        lang: s.Language ?? undefined,
      })),
    ],
    togglePlay: () =>
      latest.current.state.paused ? player?.play() : player?.pause(),
    seek: (ms) => {
      player?.seekTo(ms);
      playhead.set({ positionMs: ms });
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
      const stream = id ? desktopSubtitle(id) : 0;
      if (stream !== null) player?.setSubtitleStream(stream);
      patch({ subtitle: id });
    },
    toggleFullscreen: () =>
      void desktopApi().then((api) =>
        api?.input.executeActions(['host:fullscreen'])
      ),
  };
}

let host: Host | undefined;

/** Jellyfin's desktop app, which brings jellyfin-web's shell too. */
export function jellyfinDesktopHost(): Host | null {
  if (!window.jmpInfo || !window.apiPromise) return null;
  host ??= {
    ...(window.NativeShell && nativeShellParts(window.NativeShell)),
    name: 'jellyfin-desktop',
    usePlayer: useDesktopPlayer,
    playerFeatures: ['audio'],
  };
  return host;
}
