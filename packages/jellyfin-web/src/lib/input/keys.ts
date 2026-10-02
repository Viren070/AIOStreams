/*
 * Every input is named as a string: a key with its modifiers (`Shift+N`,
 * `ArrowLeft`, `?`), a remote's button (`Back`, `MediaPlay`), a gamepad's
 * (`GamepadA`) or the mouse wheel (`WheelUp`). Shortcuts bind these names.
 */

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

const LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  ContextMenu: 'Menu key',
  Plus: '+',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Meta: MAC ? '⌘' : 'Win',
  Alt: MAC ? '⌥' : 'Alt',
  WheelUp: 'Wheel up',
  WheelDown: 'Wheel down',
  Back: 'Back button',
  BrowserHome: 'Browser Home',
  BrowserSearch: 'Browser Search',
  MediaPlayPause: 'Play/Pause',
  MediaPlay: 'Play',
  MediaPause: 'Pause',
  MediaStop: 'Stop',
  MediaRewind: 'Rewind',
  MediaFastForward: 'Fast forward',
  MediaTrackPrevious: 'Previous track',
  MediaTrackNext: 'Next track',
  AudioVolumeMute: 'Mute key',
  AudioVolumeUp: 'Volume up key',
  AudioVolumeDown: 'Volume down key',
};

/** The parts of an input as a person reads them: `Shift+ArrowLeft` is Shift, ←. */
export function inputLabels(input: string): string[] {
  return input
    .split('+')
    .map((part) => LABELS[part] ?? part.replace(/^Gamepad/, 'Pad '));
}
