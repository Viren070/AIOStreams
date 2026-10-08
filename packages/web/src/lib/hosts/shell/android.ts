import type { Host } from '..';
import { runAction } from '../../input';
import { onSettingsChange, settings, type PlayerEngine } from '../../settings';
import { appBridge } from './bridge';
import { shellDownloads } from './downloads';
import { playsWithExoPlayer, setEngine, useShellPlayer } from './player';

let fullscreen = false;

/**
 * Follows the app's full screen, which hides the system bars and turns to
 * landscape, takes its Back, and tells it which player to play with.
 */
export function setupAndroid(): () => void {
  const bridge = appBridge();
  let engine: PlayerEngine | null = null;
  const sendEngine = () => {
    if (settings.android.engine.read() === engine) return;
    engine = settings.android.engine.read();
    bridge?.send({ type: 'player-engine', name: engine });
  };
  sendEngine();
  const unsubscribeSettings = onSettingsChange(sendEngine);
  const unsubscribe = bridge?.subscribe((m) => {
    if (m.type === 'fullscreen') fullscreen = m.value;
    else if (m.type === 'back') runAction('back');
    else if (m.type === 'player-engine') setEngine(m.name);
  });
  // The keyboard opening over a field that already had focus doesn't bring it into view.
  const showField = () => {
    const field = document.activeElement;
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement
    )
      field.scrollIntoView({ block: 'nearest' });
  };
  window.addEventListener('resize', showField);
  window.visualViewport?.addEventListener('resize', showField);
  return () => {
    unsubscribeSettings();
    unsubscribe?.();
    window.removeEventListener('resize', showField);
    window.visualViewport?.removeEventListener('resize', showField);
  };
}

/** The app's mpv.conf, as it answers `mpv-config` and `mpv-config-save`. */
function mpvConfig(message: { type: string; text?: string }): Promise<string> {
  const bridge = appBridge();
  if (!bridge) return Promise.reject(new Error('Only the Android app has one'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error('The app did not answer'));
    }, 5000);
    const stop = bridge.subscribe((m) => {
      if (m.type === 'error') {
        clearTimeout(timer);
        stop();
        reject(new Error(m.message));
      } else if (m.type === 'mpv-config') {
        clearTimeout(timer);
        stop();
        resolve(m.text);
      }
    });
    bridge.send(message);
  });
}

export const readMpvConfig = () => mpvConfig({ type: 'mpv-config' });

/** Saves it and applies it to what plays next. */
export const saveMpvConfig = (text: string) =>
  mpvConfig({ type: 'mpv-config-save', text });

export const androidHost: Host = {
  name: 'android-app',
  get tv() {
    return appBridge()?.tv === true;
  },
  device: () => ({ id: appBridge()?.deviceId, name: appBridge()?.device }),
  usePlayer: useShellPlayer,
  get playerFeatures() {
    return playsWithExoPlayer()
      ? (['audio', 'chapters'] as const)
      : (['audio', 'chapters', 'stats'] as const);
  },
  // A TV has little storage and is always online.
  get downloads() {
    return appBridge()?.tv ? undefined : shellDownloads;
  },
  fullscreen: {
    active: () => fullscreen,
    set: (on) => appBridge()?.send({ type: 'fullscreen', value: on }),
  },
  // Back ends at Home, as in other Android apps, rather than walking the history before it.
  back: () => {
    if ((location.hash.slice(1).split('?')[0] || '/') !== '/') return false;
    appBridge()?.send({ type: 'exit' });
    return true;
  },
  exit: () => appBridge()?.send({ type: 'exit' }),
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
