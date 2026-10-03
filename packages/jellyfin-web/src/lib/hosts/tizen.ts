import type { Host } from '.';

interface Tizen {
  application: { getCurrentApplication(): { exit(): void } };
  tvinputdevice?: {
    getSupportedKeys(): { name: string }[];
    registerKey(name: string): void;
    unregisterKey(name: string): void;
  };
}

declare global {
  interface Window {
    tizen?: Tizen;
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

const host: Host = {
  name: 'tizen',
  device: () => ({ name: 'Samsung TV' }),
  exit: () => window.tizen?.application.getCurrentApplication().exit(),
  start: registerMediaKeys,
};

/** Samsung's TVs, running the packaged app. */
export function tizenHost(): Host | null {
  return window.tizen ? host : null;
}
