import React from 'react';
import { currentHost } from '@/lib/hosts';
import { leaveWindowFullscreen } from '@/lib/hosts/shell/desktop';

function isPhone(): boolean {
  return (
    matchMedia('(pointer: coarse)').matches &&
    Math.min(screen.width, screen.height) < 600
  );
}

// Safari before 16.4 has only the prefixed API
type WebKitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?(): void;
};
const webkitDocument = () => document as WebKitDocument;
const CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'];

export const isFullscreen = () =>
  !!(document.fullscreenElement ?? webkitDocument().webkitFullscreenElement) ||
  !!currentHost().fullscreen?.active();

/** Safari on iPhone lets only a video's own player fill the screen. */
export const canFullscreen = () =>
  !!currentHost().fullscreen ||
  !!(document.fullscreenEnabled || webkitDocument().webkitFullscreenEnabled);

export function onFullscreenChange(listener: () => void): () => void {
  for (const event of CHANGE_EVENTS) document.addEventListener(event, listener);
  return () => {
    for (const event of CHANGE_EVENTS)
      document.removeEventListener(event, listener);
  };
}

/** Phones also turn to landscape, which only a full screen page may lock. */
async function enterFullscreen(): Promise<void> {
  const app = currentHost().fullscreen;
  if (app) return app.set(true);
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?(): void;
  };
  if (root.requestFullscreen) await root.requestFullscreen();
  else root.webkitRequestFullscreen?.();
  const orientation = screen.orientation as ScreenOrientation & {
    lock?(orientation: string): Promise<void>;
  };
  if (isPhone()) await orientation.lock?.('landscape');
}

async function exitFullscreen(): Promise<void> {
  const app = currentHost().fullscreen;
  if (app?.active()) app.set(false);
  else if (document.exitFullscreen) await document.exitFullscreen();
  else webkitDocument().webkitExitFullscreen?.();
}

export function leaveFullscreen(): void {
  if (isFullscreen()) void exitFullscreen().catch(() => {});
  else leaveWindowFullscreen();
}

export function toggleDocumentFullscreen(): void {
  void (isFullscreen() ? exitFullscreen() : enterFullscreen()).catch(() => {});
}

/** Phones play full screen in landscape, as their own players do, and tablets in the app either way up. */
export function usePlayerFullscreen(enabled: boolean): void {
  React.useEffect(() => {
    const host = currentHost();
    const tablet =
      !!host.fullscreen && !host.tv && matchMedia('(pointer: coarse)').matches;
    if (!enabled || !(isPhone() || tablet)) return;
    if (!isFullscreen()) void enterFullscreen().catch(() => {});
    return () => {
      // The next episode's player keeps it, as it could not enter again without a tap.
      setTimeout(() => {
        const playing = document.documentElement.classList.contains('playing');
        if (!playing && isFullscreen()) void exitFullscreen().catch(() => {});
      });
    };
  }, [enabled]);
}
