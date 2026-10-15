import type { BaseItemDto } from '../types';
import type { Host } from '.';
import { nativeShellParts } from './native-shell';
import { ofType, trackLabel } from '../playback/controller';
import type {
  EngineFactory,
  EngineFile,
  EngineState,
  EngineTrack,
} from '../playback/engine';

const EMBEDDED = 'embedded:';

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
 * position within each type, starting on the server's defaults.
 */
const jmpEngine: EngineFactory = (emit) => {
  const report = (state: EngineState) => emit({ type: 'state', state });
  let player: JmpPlayer | null = null;
  let file: EngineFile | null = null;
  let teardown = () => {};

  /** The player's subtitle stream: a position among the embedded ones, or `#,` and a link. */
  const subtitleStream = (id: string): number | string | null => {
    if (id.startsWith(EMBEDDED)) return Number(id.slice(EMBEDDED.length));
    const server = file?.subtitles.find((s) => s.id === id);
    return server ? `#,${server.url}` : null;
  };

  return {
    load(next) {
      teardown();
      file = next;
      const { source } = next;
      const audio = ofType(source, 'Audio');
      const subtitles = ofType(source, 'Subtitle');
      const embedded = subtitles.filter((s) => s.DeliveryMethod !== 'External');
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
          ? `${EMBEDDED}${embedded.indexOf(startSubtitle) + 1}`
          : `server:${startSubtitle.Index}`;
      const tracks: EngineTrack[] = [
        ...audio.map((s, i) => ({
          id: String(i + 1),
          type: 'audio' as const,
          label: trackLabel(s, i + 1),
          lang: s.Language ?? undefined,
          title: s.Title ?? undefined,
          default: s.IsDefault,
        })),
        ...embedded.map((s, i) => ({
          id: `${EMBEDDED}${i + 1}`,
          type: 'subtitle' as const,
          label: trackLabel(s, i + 1),
          lang: s.Language ?? undefined,
          title: s.Title ?? undefined,
          forced: s.IsForced,
          hearingImpaired: s.IsHearingImpaired,
        })),
      ];
      report({ fullscreen: desktopFullscreen() });
      const stopSettings = onDesktopSettings(() =>
        report({ fullscreen: desktopFullscreen() })
      );
      let cancelled = false;
      let cleanup = () => {};
      void desktopApi().then((api) => {
        if (!api || cancelled) return;
        const mpv = api.player;
        player = mpv;
        let started = false;
        const handlers = {
          playing: () => {
            if (!started) {
              started = true;
              // Its player only opens a file by playing it.
              if (next.paused) mpv.pause();
              if (next.volume) {
                mpv.setVolume(
                  Math.round(Math.min(1, next.volume.volume) * 100)
                );
                mpv.setMuted(next.volume.muted);
              }
              mpv.setVideoRectangle(0, 0, 0, 0);
              emit({ type: 'tracks', tracks });
              emit({ type: 'loaded' });
            }
            report({ started: true, paused: false, waiting: false });
          },
          paused: () => report({ paused: true, waiting: false }),
          buffering: () => report({ waiting: true }),
          positionUpdate: (ms: number) =>
            emit({ type: 'position', positionMs: ms }),
          updateDuration: (ms: number) => report({ durationMs: ms }),
          finished: () => emit({ type: 'ended' }),
          error: (message: string) => emit({ type: 'failed', error: message }),
        };
        mpv.playing.connect(handlers.playing);
        mpv.paused.connect(handlers.paused);
        mpv.buffering.connect(handlers.buffering);
        mpv.positionUpdate.connect(handlers.positionUpdate);
        mpv.updateDuration.connect(handlers.updateDuration);
        mpv.finished.connect(handlers.finished);
        mpv.error.connect(handlers.error);
        mpv.load(
          next.url,
          { startMilliseconds: next.startMs, autoplay: true },
          {
            type: 'video',
            headers: { 'User-Agent': window.jmpInfo?.userAgent ?? '' },
            metadata: loadMetadata(next.item),
            media: {},
          },
          defaultAudio,
          (startSubtitleId && subtitleStream(startSubtitleId)) ?? -1,
          () => {}
        );
        report({
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
      teardown = () => {
        cancelled = true;
        stopSettings();
        cleanup();
      };
    },
    close() {
      teardown();
      teardown = () => {};
    },
    setPaused: (paused) => (paused ? player?.pause() : player?.play()),
    seek: (ms) => player?.seekTo(ms),
    setVolume(volume, muted) {
      player?.setVolume(Math.round(Math.min(1, volume) * 100));
      player?.setMuted(muted);
    },
    setRate(rate) {
      player?.setPlaybackRate(rate * 1000);
      report({ rate });
    },
    setAudio: (id) => player?.setAudioStream(Number(id)),
    setSubtitle(id) {
      const stream = id ? subtitleStream(id) : 0;
      if (stream !== null) player?.setSubtitleStream(stream);
    },
    toggleFullscreen: () =>
      void desktopApi().then((api) =>
        api?.input.executeActions(['host:fullscreen'])
      ),
    picksTracks: true,
  };
};

let host: Host | undefined;

/** Jellyfin's desktop app, which brings jellyfin-web's shell too. */
export function jellyfinDesktopHost(): Host | null {
  if (!window.jmpInfo || !window.apiPromise) return null;
  host ??= {
    ...(window.NativeShell && nativeShellParts(window.NativeShell)),
    name: 'jellyfin-desktop',
    player: jmpEngine,
    playerFeatures: ['audio'],
  };
  return host;
}
