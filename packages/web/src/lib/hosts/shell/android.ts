import type { Host } from '..';
import { appBridge } from './bridge';
import { shellDownloads } from './downloads';
import { useShellPlayer } from './player';

let fullscreen = false;

/** Follows the app's full screen, which hides the system bars and turns to landscape. */
export function setupAndroid(): () => void {
  return (
    appBridge()?.subscribe((m) => {
      if (m.type === 'fullscreen') fullscreen = m.value;
    }) ?? (() => {})
  );
}

export const androidHost: Host = {
  name: 'android-app',
  device: () => ({ name: appBridge()?.device }),
  usePlayer: useShellPlayer,
  playerFeatures: ['audio', 'chapters', 'stats'],
  downloads: shellDownloads,
  fullscreen: {
    active: () => fullscreen,
    set: (on) => appBridge()?.send({ type: 'fullscreen', value: on }),
  },
  levels: {
    read: () =>
      new Promise((resolve) => {
        const bridge = appBridge();
        const stop = bridge?.subscribe((m) => {
          if (m.type !== 'levels') return;
          stop?.();
          resolve(m);
        });
        bridge?.send({ type: 'levels' });
      }),
    set: (level, value) =>
      appBridge()?.send({ type: 'set-level', level, value }),
    release: () =>
      appBridge()?.send({
        type: 'set-level',
        level: 'brightness',
        value: null,
      }),
  },
};
