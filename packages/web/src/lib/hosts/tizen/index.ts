import type { Host } from '..';
import { useAvPlayer } from './player';

export interface AvPlayTrack {
  index: number;
  type: string;
  extra_info: string;
}

export interface AvPlay {
  open(url: string): void;
  close(): void;
  prepareAsync(onSuccess: () => void, onError: (error: unknown) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(
    ms: number,
    onSuccess: () => void,
    onError: (error: unknown) => void
  ): void;
  getState(): string;
  getDuration(): number;
  getCurrentTime(): number;
  setListener(listener: object): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(method: string): void;
  getTotalTrackInfo(): AvPlayTrack[];
  getCurrentStreamInfo(): AvPlayTrack[];
  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void;
  setSilentSubtitle(silent: boolean): void;
  suspend(): void;
  restore(): void;
}

interface Tizen {
  application: { getCurrentApplication(): { exit(): void } };
  tvinputdevice?: {
    getSupportedKeys(): { name: string }[];
    registerKey(name: string): void;
    unregisterKey(name: string): void;
  };
  tvaudiocontrol?: {
    getVolume(): number;
    setVolume(volume: number): void;
    isMute(): boolean;
    setMute(mute: boolean): void;
    setVolumeChangeListener(listener: (volume: number) => void): void;
    unsetVolumeChangeListener(): void;
  };
}

declare global {
  interface Window {
    tizen?: Tizen;
    /** From `$WEBAPIS/webapis/webapis.js`, which the TV package loads. */
    webapis?: { avplay?: AvPlay };
  }
}

/** The remote sends these to the page only once they are registered. */
const MEDIA_KEYS = [
  'MediaPlayPause',
  'MediaPlay',
  'MediaPause',
  'MediaStop',
  'MediaRewind',
  'MediaFastForward',
  'MediaTrackPrevious',
  'MediaTrackNext',
];

function registerMediaKeys(): () => void {
  const input = window.tizen?.tvinputdevice;
  if (!input) return () => undefined;
  try {
    const supported = new Set(input.getSupportedKeys().map((k) => k.name));
    const keys = MEDIA_KEYS.filter((key) => supported.has(key));
    for (const key of keys) input.registerKey(key);
    return () => keys.forEach((key) => input.unregisterKey(key));
  } catch {
    return () => undefined;
  }
}

let host: Host | undefined;

/** Samsung's TVs, running the packaged app. */
export function tizenHost(): Host | null {
  if (!window.tizen) return null;
  host ??= {
    name: 'tizen',
    tv: true,
    device: () => ({ name: 'Samsung TV' }),
    exit: () => window.tizen?.application.getCurrentApplication().exit(),
    start: registerMediaKeys,
    ...(window.webapis?.avplay && {
      usePlayer: useAvPlayer,
      playerFeatures: ['audio'],
    }),
  };
  return host;
}
