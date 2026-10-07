import type { HostEvent } from '../../downloads/types';

/** `external` marks what the player in its own window sends. */
export type ShellMessage =
  | { type: 'mpv-prop'; name: string; data: unknown; external?: boolean }
  | { type: 'mpv-event'; name: string; external?: boolean }
  | {
      type: 'mpv-ended';
      reason: string;
      error: string | null;
      cause?: string;
      external?: boolean;
    }
  | {
      type: 'external-players';
      players: { id: string; path: string | null }[];
    }
  | { type: 'external-ended'; error: string | null }
  | { type: 'fullscreen'; value: boolean }
  | { type: 'pip'; value: boolean }
  | { type: 'back' }
  /** The engine the Android app plays with now. */
  | { type: 'player-engine'; name: string }
  | { type: 'mpv-config'; text: string }
  | { type: 'levels'; volume: number; brightness: number }
  | { type: 'window-state'; maximized: boolean }
  | {
      type: 'app-info';
      app: string;
      platform: string;
      mpv: string | null;
      ffmpeg: string | null;
      /** The Android app's player and its version. */
      player?: string;
    }
  | { type: 'diagnostics'; text: string }
  | {
      type: 'update-state';
      state: 'checking' | 'downloading' | 'ready' | 'current' | 'error' | 'off';
      channel: 'stable' | 'nightly' | null;
      version: string | null;
      error: string | null;
    }
  | {
      type: 'discord-status';
      state: 'connected' | 'not-found' | 'failed' | 'refused';
      message: string | null;
    }
  | { type: 'link'; url: string }
  | { type: 'media-key'; key: MediaKey }
  | { type: 'error'; message: string }
  | {
      type: 'download-state';
      folder: string;
      jobs: Extract<HostEvent, { type: 'state' }>['jobs'];
    }
  | {
      type: 'download-progress';
      id: string;
      bytes: number;
      total: number | null;
      speed: number;
    };

/** A press on the system's media controls; positions and offsets are milliseconds. */
export type MediaKey =
  | { action: 'play' | 'pause' | 'toggle' | 'stop' | 'next' | 'previous' }
  | { action: 'seek'; position: number }
  | { action: 'skip'; offset: number };

/** The AIOStreams apps' bridge to their player and system, on the desktop and Android. */
interface ShellBridge {
  protocol: number;
  version: string;
  /** `windows`, `macos`, `linux` or `android`. */
  platform: string;
  /** The device's name. */
  device: string;
  /** The app's own id for this device, where it keeps one. */
  deviceId?: string;
  send(message: { type: string; [key: string]: unknown }): void;
  subscribe(listener: (message: ShellMessage) => void): () => void;
}

declare global {
  interface Window {
    aiostreamsApp?: ShellBridge;
  }
}

export function appBridge(): ShellBridge | undefined {
  return window.aiostreamsApp;
}
