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

declare global {
  interface Window {
    NativeInterface?: { exitApp?(): void };
    NativePlayer?: AndroidPlayer;
    NavigationHelper?: { goBack(): void };
    MediaSegments?: {
      setSegmentTypeAction(type: string, action: string): void;
    };
  }
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
  window.NativePlayer!.loadPlayer(
    JSON.stringify({
      ids: [item.Id],
      mediaSourceId: source.Id,
      startIndex: 0,
      startPositionTicks: Math.round(startMs) * TICKS_PER_MS,
    }),
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
