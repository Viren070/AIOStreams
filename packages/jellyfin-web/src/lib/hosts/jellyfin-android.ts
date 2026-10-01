import { TICKS_PER_MS } from '../format';
import {
  onSettingsChange,
  SEGMENT_TYPES,
  settings,
  type SegmentAction,
} from '../settings';
import type { BaseItemDto, SourceInfo } from '../types';

interface AndroidPlayer {
  isEnabled(): boolean;
  loadPlayer(options: string, preferences: string): void;
}

interface AndroidInterface {
  exitApp?(): void;
  openClientSettings?(): void;
  openServerSelection?(): void;
  enableFullscreen?(): void;
  disableFullscreen?(): void;
  updateMediaSession?(options: string): void;
  hideMediaSession?(): void;
  getDeviceInformation?(): string | null;
}

/** What the app's media controls call on the page. */
export interface AndroidPlaybackManager {
  unpause(): void;
  pause(): void;
  playPause(): void;
  stop(): void;
  nextTrack(): void;
  previousTrack(): void;
  fastForward(): void;
  rewind(): void;
  seekMs(ms: number): void;
  volumeUp(): void;
  volumeDown(): void;
  sendCommand(): void;
}

declare global {
  interface Window {
    NativeInterface?: AndroidInterface;
    NativePlayer?: AndroidPlayer;
    ExternalPlayer?: {
      isEnabled(): boolean;
      initPlayer(options: string): void;
    };
    NavigationHelper?: {
      goBack(): void;
      playbackManager?: AndroidPlaybackManager;
    };
    MediaSegments?: {
      setSegmentTypeAction(type: string, action: string): void;
    };
  }
}

/** The app keeps its player's options, such as starting in landscape, in its own settings. */
export const hasAndroidSettings = () =>
  !!window.NativeInterface?.openClientSettings;

export const openAndroidSettings = () =>
  window.NativeInterface?.openClientSettings?.();

/** The phone's own name and id, so this page and the app's player are one device. */
export function androidDevice(): { id: string; name: string } | null {
  try {
    const info = JSON.parse(
      window.NativeInterface?.getDeviceInformation?.() ?? 'null'
    ) as { deviceId?: string; deviceName?: string } | null;
    if (!info?.deviceId) return null;
    // The app sends the name already URL-encoded.
    return {
      id: info.deviceId,
      name: decodeURIComponent(info.deviceName ?? ''),
    };
  } catch {
    return null;
  }
}

export function androidServerSelection(): (() => void) | undefined {
  const app = window.NativeInterface;
  return app?.openServerSelection
    ? () => app.openServerSelection?.()
    : undefined;
}

let appFullscreen = false;

/** The app's web view has no fullscreen API, so the app hides its bars and turns landscape itself. */
export const hasAppFullscreen = () =>
  !!window.NativeInterface?.enableFullscreen;

export const isAppFullscreen = () => appFullscreen;

export function setAppFullscreen(on: boolean): void {
  if (on) window.NativeInterface?.enableFullscreen?.();
  else window.NativeInterface?.disableFullscreen?.();
  appFullscreen = on;
  document.dispatchEvent(new Event('fullscreenchange'));
}

export const hasAndroidMediaSession = () =>
  !!window.NativeInterface?.updateMediaSession;

export function updateAndroidMediaSession(state: {
  itemId: string;
  title: string;
  artist: string;
  imageUrl: string;
  position: number;
  duration: number;
  isPaused: boolean;
}): void {
  window.NativeInterface?.updateMediaSession?.(
    JSON.stringify({
      action: 'timeupdate',
      album: '',
      canSeek: true,
      isLocalPlayer: true,
      ...state,
    })
  );
}

export function clearAndroidMediaSession(): void {
  window.NativeInterface?.hideMediaSession?.();
  if (window.NavigationHelper) delete window.NavigationHelper.playbackManager;
}

export function setAndroidPlaybackManager(
  manager: AndroidPlaybackManager
): void {
  if (window.NavigationHelper)
    window.NavigationHelper.playbackManager = manager;
}

const ANDROID_SEGMENT_ACTIONS: Record<SegmentAction, string> = {
  ask: 'AskToSkip',
  skip: 'Skip',
  none: 'None',
};

/** The Android player keeps its own skip action per segment type. */
export function syncAndroidSegments(): () => void {
  const bridge = window.MediaSegments;
  if (!bridge) return () => undefined;
  let sent: ReturnType<typeof settings.segmentActions.read> | undefined;
  const apply = () => {
    const actions = settings.segmentActions.read();
    if (actions === sent) return;
    sent = actions;
    for (const type of SEGMENT_TYPES)
      bridge.setSegmentTypeAction(type, ANDROID_SEGMENT_ACTIONS[actions[type]]);
  };
  apply();
  return onSettingsChange(apply);
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

export function playOnAndroid(
  item: BaseItemDto,
  source: SourceInfo,
  startMs: number
): void {
  const options = JSON.stringify({
    ids: [item.Id],
    mediaSourceId: source.Id,
    startIndex: 0,
    startPositionTicks: Math.round(startMs) * TICKS_PER_MS,
  });
  if (window.ExternalPlayer?.isEnabled()) {
    window.ExternalPlayer.initPlayer(options);
    return;
  }
  window.NativePlayer!.loadPlayer(
    options,
    JSON.stringify({
      maxStreamingBitrateLocal: 120_000_000,
      maxStreamingBitrateRemote: 120_000_000,
    })
  );
}

/**
 * The Android app sends its back button to `NavigationHelper.goBack()`, which
 * jellyfin-web defines. An open overlay closes first; at the root it exits.
 */
export function handleAndroidBack(history: {
  canGoBack(): boolean;
  back(): void;
}): void {
  if (!window.NativeInterface) return;
  window.NavigationHelper = {
    goBack() {
      if (document.querySelector('[role="dialog"], [role="menu"]')) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      } else if (history.canGoBack()) {
        history.back();
      } else {
        window.NativeInterface?.exitApp?.();
      }
    },
  };
}
