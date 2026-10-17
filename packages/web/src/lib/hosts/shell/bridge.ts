import { t } from '@lingui/core/macro';
import React from 'react';
import type { HostEvent } from '../../downloads/types';

/** A track as the app's player lists it; `url` is where an added one came from. */
export interface AppTrack {
  id: string;
  type: 'audio' | 'subtitle';
  title?: string;
  language?: string;
  codec?: string;
  default: boolean;
  forced: boolean;
  hearingImpaired: boolean;
  visualImpaired: boolean;
  external: boolean;
  url?: string;
}

/** `external` marks what the player in its own window sends. */
export type ShellMessage =
  | { type: 'youtube-resolved'; request: string; url: string | null }
  | {
      type: 'player-state';
      positionMs?: number;
      durationMs?: number;
      bufferedMs?: number;
      paused?: boolean;
      buffering?: boolean;
      seeking?: boolean;
      idle?: boolean;
      volume?: number;
      maxVolume?: number;
      muted?: boolean;
      speed?: number;
      audio?: string | null;
      subtitle?: string | null;
      fullscreen?: boolean;
      external?: boolean;
    }
  | { type: 'player-tracks'; tracks: AppTrack[]; external?: boolean }
  | {
      type: 'player-chapters';
      chapters: { title?: string; startMs: number }[];
      external?: boolean;
    }
  | {
      type: 'player-event';
      name: 'start' | 'loaded' | 'restart';
      external?: boolean;
    }
  | {
      type: 'player-ended';
      reason: string;
      error: string | null;
      /** The HTTP status a failed load answered with. */
      status?: number;
      cause?: string;
      external?: boolean;
    }
  | {
      type: 'external-players';
      players: { id: string; path: string | null }[];
    }
  | { type: 'external-ended'; error: string | null }
  /** mpv's outputs on the desktop, as its `audio-device-list`. */
  | {
      type: 'audio-devices';
      devices: { name: string; description: string }[] | null;
    }
  | { type: 'fullscreen'; value: boolean }
  | { type: 'pip'; value: boolean }
  | { type: 'back' }
  /** The engine the Android app plays with now. */
  | { type: 'player-engine'; name: string }
  | { type: 'mpv-config'; text: string }
  | {
      type: 'player-stats';
      stats: Record<string, unknown>;
      /** The app's own process, which decoders and the page run outside. */
      cpuMs: number;
      atMs: number;
    }
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
      /** Whether the app can re-encode sound to Dolby Digital. */
      ac3Encoder?: boolean;
    }
  | { type: 'diagnostics'; text: string }
  /** Empty when the last run ended normally or was already shown. */
  | { type: 'crash-report'; at?: number; summary?: string; details?: string }
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
  | { type: 'voice-hearing'; level?: number; text: string | null }
  | {
      type: 'voice-result';
      text: string | null;
      error?: 'no-speech' | 'failed';
    }
  | { type: 'gamepads'; connected: boolean }
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
  /** The Android app on a TV. */
  tv?: boolean;
  /** The Android app on a device with a speech recogniser. */
  voice?: boolean;
  /** The Android app with a game controller attached. */
  gamepads?: boolean;
  /** The Android app on a device with picture-in-picture. */
  pip?: boolean;
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

export type ShellAnswer<T extends ShellMessage['type']> = Extract<
  ShellMessage,
  { type: T }
>;

/** Sends `message` and resolves with the first `answer` it gets. */
export function ask<T extends ShellMessage['type']>(
  message: { type: string; [key: string]: unknown },
  answer: T,
  opts: {
    timeoutMs?: number;
    matches?: (m: ShellAnswer<T>) => boolean;
    /** Fails on the next `error` the app sends, which only some requests answer with. */
    errors?: boolean;
  } = {}
): Promise<ShellAnswer<T>> {
  const bridge = appBridge();
  if (!bridge) return Promise.reject(new Error('Only the apps answer this'));
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      stop();
    };
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            done();
            reject(new Error(t`The app did not answer`));
          }, opts.timeoutMs);
    const stop = bridge.subscribe((m) => {
      if (m.type === 'error' && opts.errors) {
        done();
        reject(new Error(m.message));
      } else if (m.type === answer && (opts.matches?.(m as never) ?? true)) {
        done();
        resolve(m as ShellAnswer<T>);
      }
    });
    bridge.send(message);
  });
}

/** The last `type` message the app sent, for a page that opens after it came. */
export function bridgeStore<T extends ShellMessage['type']>(type: T) {
  let last: ShellAnswer<T> | null = null;
  const listeners = new Set<() => void>();
  appBridge()?.subscribe((m) => {
    if (m.type !== type) return;
    last = m as ShellAnswer<T>;
    for (const listener of listeners) listener();
  });
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return {
    get: () => last,
    use: () => React.useSyncExternalStore(subscribe, () => last),
  };
}
