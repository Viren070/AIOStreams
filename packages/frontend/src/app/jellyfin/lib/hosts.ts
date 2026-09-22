/** Signals the desktop client's player exposes over its web channel. */
interface JmpSignal<T extends unknown[] = []> {
  connect(fn: (...args: T) => void): void;
  disconnect(fn: (...args: T) => void): void;
}

export interface JmpPlayer {
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

export interface AndroidPlayer {
  isEnabled(): boolean;
  loadPlayer(options: string, preferences: string): void;
}

declare global {
  interface Window {
    jmpInfo?: {
      userAgent?: string;
      settings?: { main?: { fullscreen?: boolean } };
      settingsUpdate?: ((section: string) => void)[];
    };
    apiPromise?: Promise<JmpApi>;
    NativeInterface?: { exitApp?(): void };
    NativePlayer?: AndroidPlayer;
    NavigationHelper?: { goBack(): void };
  }
}

export type PlaybackHost = 'desktop' | 'android' | 'browser';

/**
 * The official desktop and Android apps load the server's web client and
 * inject a bridge to their native player, which plays anything.
 */
export function playbackHost(): PlaybackHost {
  if (window.jmpInfo && window.apiPromise) return 'desktop';
  if (window.NativeInterface && window.NativePlayer?.isEnabled()) {
    return 'android';
  }
  return 'browser';
}

export async function desktopApi(): Promise<JmpApi | null> {
  return window.apiPromise ? window.apiPromise.catch(() => null) : null;
}

export function desktopFullscreen(): boolean {
  return window.jmpInfo?.settings?.main?.fullscreen === true;
}

/** Calls `listener` whenever the desktop app's settings change. */
export function onDesktopSettings(listener: () => void): () => void {
  const listeners = window.jmpInfo?.settingsUpdate;
  if (!listeners) return () => {};
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}

/**
 * The Android app keeps its web view only once a request for jellyfin-web's
 * main bundle goes out, which it answers with its bridge.
 */
export function announceToAndroid(base: string): void {
  if (!window.NativeInterface) return;
  const script = document.createElement('script');
  script.src = `${new URL(base).pathname}/web/main.aiostreams.bundle.js`;
  document.body.appendChild(script);
}
