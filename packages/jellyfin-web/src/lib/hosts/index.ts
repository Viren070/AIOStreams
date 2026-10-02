import type { JellyfinClient } from '../client';
import type {
  NativePlayerOptions,
  PlayerController,
  PlayerFeature,
} from '../player';
import type { BaseItemDto, SourceInfo } from '../types';
import { androidHost } from './jellyfin-android';
import { jellyfinDesktopHost } from './jellyfin-desktop';
import { nativeShellHost } from './native-shell';
import { shellHost, type MediaKey } from './shell';

export interface NowPlaying {
  itemId: string;
  title: string;
  artist: string;
  imageUrl: string;
  positionMs: number;
  durationMs: number;
  paused: boolean;
}

/**
 * The app the page runs in, from the bridge it injects. Anything left out
 * falls back to what a browser does.
 */
export interface Host {
  /** `data-host` on the page's root, which custom CSS matches, so it can't change. */
  name: string;
  /** The app's own name for this device, and its id where its player reports as it. */
  device?(): { id?: string; name?: string } | null;
  /** A player drawn beneath the page. */
  usePlayer?(opts: NativePlayerOptions): PlayerController;
  playerFeatures?: readonly PlayerFeature[];
  /** The app's own player takes over from the page. */
  play?(item: BaseItemDto, source: SourceInfo, startMs: number): void;
  selectServer?(): void;
  /** The app's own settings, which get a tab. */
  settings?: { label: string; description: string; help: string; open(): void };
  /** Full screen for a web view without the fullscreen API. */
  fullscreen?: { active(): boolean; set(on: boolean): void };
  /** Takes Back before the page does; true when it acted. */
  back?(): boolean;
  /** Back from the first page leaves the app. */
  exit?(): void;
  /** The app's media controls, in place of the browser's. */
  mediaSession?: {
    update(now: NowPlaying): void;
    clear(): void;
    listen?(press: (key: MediaKey) => void): () => void;
  };
  start?(ctx: { base: string }): () => void;
  signedIn?(client: JellyfinClient): void;
}

const browserHost: Host = { name: 'browser' };

/**
 * Checked on every call, since some apps inject their bridge late or switch
 * players. Each host is the same object while nothing changes.
 */
export function currentHost(): Host {
  return (
    shellHost() ??
    jellyfinDesktopHost() ??
    androidHost() ??
    nativeShellHost() ??
    browserHost
  );
}
