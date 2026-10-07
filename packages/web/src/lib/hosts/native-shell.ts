import type { Host, NowPlaying } from '.';

/** The bridge apps hosting jellyfin-web inject, any member of which may be missing. */
export interface NativeShell {
  AppHost?: {
    appName?(): string;
    deviceName?(): string;
    supports?(feature: string): boolean;
    exit?(): void;
  };
  selectServer?(): void;
  openClientSettings?(): void;
  updateMediaSession?(info: Record<string, unknown>): void;
  hideMediaSession?(): void;
}

declare global {
  interface Window {
    NativeShell?: NativeShell;
  }
}

/** The media session update jellyfin-web sends an app. */
export function mediaInfo(now: NowPlaying): Record<string, unknown> {
  return {
    action: 'timeupdate',
    isLocalPlayer: true,
    canSeek: true,
    album: '',
    itemId: now.itemId,
    title: now.title,
    artist: now.artist,
    imageUrl: now.imageUrl,
    position: Math.round(now.positionMs),
    duration: Math.round(now.durationMs),
    isPaused: now.paused,
  };
}

/** What an app's `NativeShell` offers, used as jellyfin-web uses it. */
export function nativeShellParts(shell: NativeShell): Omit<Host, 'name'> {
  const app = shell.AppHost;
  return {
    // Not its id, which would change once a late shell arrives.
    device: () => {
      const name = app?.deviceName?.();
      return name ? { name } : null;
    },
    selectServer: shell.selectServer && (() => shell.selectServer?.()),
    exit:
      app?.exit && app.supports?.('exit') !== false
        ? () => app.exit?.()
        : undefined,
    settings:
      shell.openClientSettings && app?.supports?.('clientsettings') !== false
        ? {
            label: app?.appName?.() || 'App',
            description: "The app's own settings",
            help: 'Options the app keeps for itself.',
            open: () => shell.openClientSettings?.(),
          }
        : undefined,
    // jellyfin-web tells the app only where the browser has no media session.
    mediaSession:
      shell.updateMediaSession && !('mediaSession' in navigator)
        ? {
            update: (now) => shell.updateMediaSession?.(mediaInfo(now)),
            clear: () => shell.hideMediaSession?.(),
          }
        : undefined,
  };
}

const hosts = new WeakMap<NativeShell, Host>();

/** Any other app that hosts jellyfin-web, playing in the page. */
export function nativeShellHost(): Host | null {
  const shell = window.NativeShell;
  if (!shell) return null;
  let host = hosts.get(shell);
  if (!host) {
    host = { name: 'jellyfin-app', ...nativeShellParts(shell) };
    hosts.set(shell, host);
  }
  return host;
}
