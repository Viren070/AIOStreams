import React from 'react';
import { currentHost } from '../hosts';

function isPhone(): boolean {
  return (
    matchMedia('(pointer: coarse)').matches &&
    Math.min(screen.width, screen.height) < 600
  );
}

export const isFullscreen = () =>
  !!document.fullscreenElement || !!currentHost().fullscreen?.active();

/** Phones also turn to landscape, which only a full screen page may lock. */
async function enterFullscreen(): Promise<void> {
  const app = currentHost().fullscreen;
  if (app) return app.set(true);
  await document.documentElement.requestFullscreen?.();
  const orientation = screen.orientation as ScreenOrientation & {
    lock?(orientation: string): Promise<void>;
  };
  if (isPhone()) await orientation.lock?.('landscape');
}

async function exitFullscreen(): Promise<void> {
  const app = currentHost().fullscreen;
  if (app?.active()) app.set(false);
  else await document.exitFullscreen();
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
