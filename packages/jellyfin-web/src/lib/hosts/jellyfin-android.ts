import { TICKS_PER_MS } from '../format';
import { runAction } from '../input';
import {
  onSettingsChange,
  SEGMENT_TYPES,
  settings,
  type SegmentAction,
} from '../settings';
import type { BaseItemDto, SourceInfo } from '../types';
import type { Host } from '.';
import { mediaInfo } from './native-shell';
import type { MediaKey } from './shell';

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
interface AndroidPlaybackManager {
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
      goBack?(): void;
      playbackManager?: AndroidPlaybackManager;
    };
    MediaSegments?: {
      setSegmentTypeAction(type: string, action: string): void;
    };
  }
}

/** The app's skip buttons carry no amount. */
const SKIP_MS = 10_000;

/** The phone's own name and id, so this page and the app's player are one device. */
function device(): { id: string; name: string } | null {
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

let fullscreen = false;

/** The app's web view has no fullscreen API, so the app hides its bars and turns landscape itself. */
function setFullscreen(on: boolean): void {
  if (on) window.NativeInterface?.enableFullscreen?.();
  else window.NativeInterface?.disableFullscreen?.();
  fullscreen = on;
  document.dispatchEvent(new Event('fullscreenchange'));
}

/** The app calls jellyfin-web's playback manager, which this stands in for. */
function listen(press: (key: MediaKey) => void): () => void {
  const helper = (window.NavigationHelper ??= {});
  const skip = (offset: number) => () => press({ action: 'skip', offset });
  helper.playbackManager = {
    unpause: () => press({ action: 'play' }),
    pause: () => press({ action: 'pause' }),
    playPause: () => press({ action: 'toggle' }),
    stop: () => press({ action: 'stop' }),
    nextTrack: () => press({ action: 'next' }),
    previousTrack: () => press({ action: 'previous' }),
    fastForward: skip(SKIP_MS),
    rewind: skip(-SKIP_MS),
    seekMs: (ms) => press({ action: 'seek', position: ms }),
    volumeUp() {},
    volumeDown() {},
    sendCommand() {},
  };
  return () => {
    delete helper.playbackManager;
  };
}

const ANDROID_SEGMENT_ACTIONS: Record<SegmentAction, string> = {
  ask: 'AskToSkip',
  skip: 'Skip',
  none: 'None',
};

/** The Android player keeps its own skip action per segment type. */
function syncSegments(): () => void {
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
 * The app keeps its web view only once a request for jellyfin-web's main
 * bundle goes out, which it answers with its bridge.
 */
function announce(base: string): void {
  const script = document.createElement('script');
  script.src = `${new URL(base).pathname}/web/main.aiostreams.bundle.js`;
  document.body.appendChild(script);
}

/** The app sends its back button to `NavigationHelper.goBack()`, which jellyfin-web defines. */
function handleBack(): void {
  const helper = (window.NavigationHelper ??= {});
  helper.goBack = () => void runAction('back');
}

function play(item: BaseItemDto, source: SourceInfo, startMs: number): void {
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

function build(app: AndroidInterface): { page: Host; player: Host } {
  const page: Host = {
    name: 'android',
    device,
    selectServer:
      app.openServerSelection && (() => app.openServerSelection?.()),
    settings: app.openClientSettings && {
      label: 'Android app',
      description: "The app's player",
      help: "The app's player and its options, such as starting videos in landscape.",
      open: () => app.openClientSettings?.(),
    },
    fullscreen: app.enableFullscreen && {
      active: () => fullscreen,
      set: setFullscreen,
    },
    mediaSession: app.updateMediaSession && {
      update: (now) => app.updateMediaSession?.(JSON.stringify(mediaInfo(now))),
      clear: () => app.hideMediaSession?.(),
      listen,
    },
    exit: app.exitApp && (() => app.exitApp?.()),
    start: ({ base }) => {
      announce(base);
      handleBack();
      return syncSegments();
    },
    // The app reads the stored sign-in when this is requested.
    signedIn: (client) =>
      void client.post('/Sessions/Capabilities/Full', {}).catch(() => {}),
  };
  return { page, player: { ...page, play } };
}

let hosts: ReturnType<typeof build> | undefined;

/** Jellyfin's Android app, whose player takes over unless it is turned off there. */
export function androidHost(): Host | null {
  const app = window.NativeInterface;
  if (!app) return null;
  hosts ??= build(app);
  return window.NativePlayer?.isEnabled() || window.ExternalPlayer?.isEnabled()
    ? hosts.player
    : hosts.page;
}
