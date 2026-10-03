import { dispatch, holdable, pressAndHold } from './dispatch';
import { sendKey } from './focus';

/** The standard mapping's buttons in order; the d-pad sends the arrow keys. */
const BUTTONS = [
  'GamepadA',
  'GamepadB',
  'GamepadX',
  'GamepadY',
  'GamepadLB',
  'GamepadRB',
  'GamepadLT',
  'GamepadRT',
  'GamepadView',
  'GamepadMenu',
  'GamepadLS',
  'GamepadRS',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
];

const STICK = 0.6;
const REPEAT_AFTER_MS = 400;
const REPEAT_MS = 110;

function press(input: string, repeat: boolean): void {
  if (input.startsWith('Arrow')) sendKey(input, { repeat });
  else dispatch(input, repeat);
}

// Older engines return a GamepadList, which has no array methods.
const gamepads = () => Array.from(navigator.getGamepads());

function pressed(): Set<string> {
  const down = new Set<string>();
  for (const pad of gamepads()) {
    if (!pad) continue;
    pad.buttons.forEach((button, i) => {
      if (button.pressed && BUTTONS[i]) down.add(BUTTONS[i]);
    });
    const [x = 0, y = 0] = pad.axes;
    if (y < -STICK) down.add('ArrowUp');
    if (y > STICK) down.add('ArrowDown');
    if (x < -STICK) down.add('ArrowLeft');
    if (x > STICK) down.add('ArrowRight');
  }
  return down;
}

/** Polls connected gamepads while the window has focus. */
export function startGamepads(): () => void {
  // The Xbox web view turns its controller into keys itself.
  if (!navigator.getGamepads || /Xbox/.test(navigator.userAgent))
    return () => {};
  const held = new Map<
    string,
    { since: number; last: number; release?: (drop?: boolean) => void }
  >();
  const letGo = (drop: boolean) => {
    for (const state of held.values()) state.release?.(drop);
    held.clear();
  };
  let frame = 0;
  const poll = (now: number) => {
    frame = requestAnimationFrame(poll);
    if (!document.hasFocus()) return letGo(true);
    const down = pressed();
    for (const [input, state] of held)
      if (!down.has(input)) {
        held.delete(input);
        state.release?.();
      }
    for (const input of down) {
      const state = held.get(input);
      if (!state) {
        const release =
          !input.startsWith('Arrow') && holdable(input)
            ? pressAndHold(input, () => dispatch(input))
            : undefined;
        held.set(input, { since: now, last: now, release });
        if (!release) press(input, false);
      } else if (
        !state.release &&
        now - state.since > REPEAT_AFTER_MS &&
        now - state.last > REPEAT_MS
      ) {
        state.last = now;
        press(input, true);
      }
    }
  };
  const connected = () => gamepads().some(Boolean);
  const start = () => {
    if (!frame) frame = requestAnimationFrame(poll);
  };
  const stop = () => {
    if (connected()) return;
    cancelAnimationFrame(frame);
    frame = 0;
    letGo(true);
  };
  window.addEventListener('gamepadconnected', start);
  window.addEventListener('gamepaddisconnected', stop);
  if (connected()) start();
  return () => {
    window.removeEventListener('gamepadconnected', start);
    window.removeEventListener('gamepaddisconnected', stop);
    cancelAnimationFrame(frame);
    letGo(true);
  };
}
