import { t } from '@lingui/core/macro';
import { toast } from 'sonner';
import type { Host } from '..';
import { runAction } from '../../input';
import { onSettingsChange, settings, type PlayerEngine } from '../../settings';
import { appBridge, ask } from './bridge';
import { shellDownloads } from './downloads';
import { appEngine, setEngine } from './player';
import { resolveYouTube } from './youtube';

let fullscreen = false;
let leaveAsked = 0;
const LEAVE_MS = 2000;

const androidDownloads = {
  ...shellDownloads,
  folder: { choose: () => appBridge()?.send({ type: 'download-folder' }) },
};

/**
 * Follows the app's full screen, which hides the system bars and turns to
 * landscape, takes its Back, and tells it which player to play with.
 */
export function setupAndroid(): () => void {
  const bridge = appBridge();
  let engine: PlayerEngine | null = null;
  const sendEngine = () => {
    if (settings.player.engine.read() === engine) return;
    engine = settings.player.engine.read();
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
const mpvConfig = (message: { type: string; text?: string }) =>
  ask(message, 'mpv-config', { timeoutMs: 5000, errors: true }).then(
    (m) => m.text
  );

export const readMpvConfig = () => mpvConfig({ type: 'mpv-config' });

const voiceErrors = () => ({
  'no-speech': t`Nothing was heard`,
  failed: t`Voice search failed`,
});

const listen: NonNullable<Host['listen']> = ({ hearing, signal }) =>
  new Promise((resolve, reject) => {
    const bridge = appBridge();
    let level = 0;
    const cancel = () => bridge?.send({ type: 'voice-cancel' });
    const stop = bridge?.subscribe((m) => {
      if (m.type === 'voice-hearing') {
        level = m.level ?? level;
        hearing({ level, text: m.text });
        return;
      }
      if (m.type !== 'voice-result') return;
      stop?.();
      signal.removeEventListener('abort', cancel);
      if (m.error) reject(new Error(voiceErrors()[m.error]));
      else resolve(m.text);
    });
    signal.addEventListener('abort', cancel, { once: true });
    bridge?.send({ type: 'voice-search' });
  });

const watchNext: NonNullable<Host['watchNext']> = (items) =>
  appBridge()?.send({ type: 'watch-next', items });

/** Saves it and applies it to what plays next. */
export const saveMpvConfig = (text: string) =>
  mpvConfig({ type: 'mpv-config-save', text });

export const androidHost: Host = {
  name: 'android-app',
  resolveYouTube,
  get tv() {
    return appBridge()?.tv === true;
  },
  device: () => ({ id: appBridge()?.deviceId, name: appBridge()?.device }),
  player: appEngine,
  playerFeatures: ['audio', 'chapters', 'stats', 'headers'],
  // A TV has little storage and is always online.
  get downloads() {
    return appBridge()?.tv ? undefined : androidDownloads;
  },
  // A phone's keyboard has a microphone of its own.
  get listen() {
    return appBridge()?.tv && appBridge()?.voice ? listen : undefined;
  },
  saveFile: (name, type, text) =>
    appBridge()?.send({ type: 'save-file', name, mime: type, text }),
  // Only a TV's home screen has the row.
  get watchNext() {
    return appBridge()?.tv ? watchNext : undefined;
  },
  keyboardCompletions: (names) =>
    appBridge()?.send({ type: 'keyboard-completions', items: names }),
  fullscreen: {
    active: () => fullscreen,
    set: (on) => appBridge()?.send({ type: 'fullscreen', value: on }),
  },
  // Back ends at Home, as in other Android apps, rather than walking the history before it; a second press leaves.
  back: () => {
    if ((location.hash.slice(1).split('?')[0] || '/') !== '/') return false;
    if (Date.now() - leaveAsked < LEAVE_MS) {
      leaveAsked = 0;
      appBridge()?.send({ type: 'exit' });
    } else {
      leaveAsked = Date.now();
      toast(t`Press Back again to leave`, { duration: LEAVE_MS });
    }
    return true;
  },
  exit: () => appBridge()?.send({ type: 'exit' }),
  levels: {
    read: () => ask({ type: 'levels' }, 'levels'),
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
