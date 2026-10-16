/*
 * Every input is named as a string: a key with its modifiers (`Shift+N`,
 * `ArrowLeft`, `?`), a remote's button (`Back`, `MediaPlay`), a gamepad's
 * (`GamepadA`) or the mouse wheel (`WheelUp`). Shortcuts bind these names.
 */

import { t } from '@lingui/core/macro';

/** TV remotes and the Xbox web view report these by code only. */
const KEY_CODES: Record<number, string> = {
  19: 'MediaPause',
  138: 'ArrowUp',
  139: 'ArrowDown',
  140: 'ArrowLeft',
  141: 'ArrowRight',
  195: 'GamepadA',
  196: 'GamepadB',
  197: 'GamepadX',
  198: 'GamepadY',
  199: 'GamepadRB',
  200: 'GamepadLB',
  201: 'GamepadLT',
  202: 'GamepadRT',
  203: 'ArrowUp',
  204: 'ArrowDown',
  205: 'ArrowLeft',
  206: 'ArrowRight',
  207: 'GamepadMenu',
  208: 'GamepadView',
  211: 'ArrowUp',
  212: 'ArrowDown',
  213: 'ArrowRight',
  214: 'ArrowLeft',
  412: 'MediaRewind',
  413: 'MediaStop',
  415: 'MediaPlay',
  417: 'MediaFastForward',
  461: 'Back',
  10009: 'Back',
  10232: 'MediaTrackPrevious',
  10233: 'MediaTrackNext',
  10252: 'MediaPlayPause',
};

/* eslint-disable lingui/no-unlocalized-strings -- key names, not text */
const ALIASES: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  '+': 'Plus',
  Esc: 'Escape',
  GoBack: 'Back',
  Left: 'ArrowLeft',
  Up: 'ArrowUp',
  Right: 'ArrowRight',
  Down: 'ArrowDown',
  Pause: 'MediaPause',
};

/** Modifiers on their own, keys the browser handles, and keys with no name. */
const IGNORED = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Fn',
  'Hyper',
  'Super',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Tab',
  'BrowserBack',
  'BrowserForward',
  'Dead',
  'Process',
  'Unidentified',
]);

function keyName(e: KeyboardEvent): string | null {
  const coded = KEY_CODES[e.keyCode];
  if (coded) return coded;
  const key = ALIASES[e.key] ?? e.key;
  if (!key || IGNORED.has(key)) return null;
  if (key.length > 1) return key;
  if (/[a-z]/i.test(key)) return key.toUpperCase();
  // Another alphabet's letter goes by where its key sits on a US layout.
  const latin = /^Key([A-Z])$/.exec(e.code);
  return latin && /\p{L}/u.test(key) ? latin[1] : key;
}

/** A typed symbol already says whether Shift was held. */
const isSymbol = (key: string) =>
  key === 'Plus' || (key.length === 1 && !/[A-Z]/.test(key));

export function keyInput(e: KeyboardEvent): string | null {
  const key = keyName(e);
  if (!key) return null;
  const altGraph = e.getModifierState?.('AltGraph');
  const modifiers = [
    e.ctrlKey && !altGraph && 'Ctrl',
    e.altKey && !altGraph && 'Alt',
    e.metaKey && 'Meta',
    e.shiftKey && !isSymbol(key) && 'Shift',
  ];
  return [...modifiers.filter(Boolean), key].join('+');
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
/* eslint-enable lingui/no-unlocalized-strings */

const labels = (): Record<string, string> => ({
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: t`Esc`,
  Enter: t`Enter`,
  Space: t`Space`,
  Backspace: t`Backspace`,
  Tab: t`Tab`,
  Shift: t`Shift`,
  Ctrl: t`Ctrl`,
  ContextMenu: t`Menu key`,
  Plus: '+',
  Hold: t({
    comment: 'Holding the next key down, as in Hold + Enter',
    message: 'Hold',
  }),
  PageUp: t`Page Up`,
  PageDown: t`Page Down`,
  Meta: MAC ? '⌘' : t`Win`,
  Alt: MAC ? '⌥' : t`Alt`,
  WheelUp: t`Wheel up`,
  WheelDown: t`Wheel down`,
  Back: t`Back button`,
  BrowserHome: t`Browser Home`,
  BrowserSearch: t`Browser Search`,
  MediaPlayPause: t`Play/Pause`,
  MediaPlay: t`Play`,
  MediaPause: t`Pause`,
  MediaStop: t`Stop`,
  MediaRewind: t`Rewind`,
  MediaFastForward: t`Fast forward`,
  MediaTrackPrevious: t`Previous track`,
  MediaTrackNext: t`Next track`,
  AudioVolumeMute: t`Mute key`,
  AudioVolumeUp: t`Volume up key`,
  AudioVolumeDown: t`Volume down key`,
});

/** The parts of an input as a person reads them: `Shift+ArrowLeft` is Shift, ←. */
export function inputLabels(input: string): string[] {
  const names = labels();
  return input.split('+').map((part) => {
    if (names[part]) return names[part];
    const button = part.match(/^Gamepad(.+)/)?.[1];
    if (!button) return part;
    return t({
      comment: 'A button on a gamepad, as in Pad A',
      message: `Pad ${button}`,
    });
  });
}
