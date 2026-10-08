import React from 'react';
import { useLatest } from '../use-latest';
import { action, actionsFor, type ActionId } from './actions';
import {
  activate,
  dialogOpen,
  inKeyedList,
  isQuiet,
  isTextField,
  markPointerFocus,
  remember,
  overlayOpen,
  ownsKey,
  sendKey,
} from './focus';
import { keyInput } from './keys';

/** False passes the input on to the next handler. */
export type ActionHandler = (input: string) => boolean | void;

interface Entry {
  id: ActionId;
  run: ActionHandler;
  order: number;
  fallback: boolean;
}

const entries = new Set<Entry>();
let order = 0;

/** The newest handler runs first; fallbacks run after all others. */
export function onAction(
  id: ActionId,
  run: ActionHandler,
  { fallback = false } = {}
): () => void {
  const entry = { id, run, order: order++, fallback };
  entries.add(entry);
  return () => void entries.delete(entry);
}

export function useAction(
  id: ActionId,
  run: ActionHandler,
  enabled = true
): void {
  const latest = useLatest(run);
  React.useEffect(() => {
    if (!enabled) return;
    return onAction(id, (input) => latest.current(input));
  }, [id, enabled, latest]);
}

function runHandlers(ids: readonly ActionId[], input: string): boolean {
  // Back closes an open dialog or menu first, as Esc does.
  if (ids.includes('back') && overlayOpen()) {
    sendKey('Escape', { quiet: true });
    return true;
  }
  return [...entries]
    .filter((e) => ids.includes(e.id))
    .sort(
      (a, b) => Number(a.fallback) - Number(b.fallback) || b.order - a.order
    )
    .some((e) => e.run(input) !== false);
}

export const runAction = (id: ActionId, input = ''): boolean =>
  runHandlers([id], input);

let keys = false;

/** Whether keys, a remote or a gamepad came last, rather than a pointer. */
export const usingKeys = () => keys;

let inputs = 0;

/** Grows with every press, click or turn of the wheel: someone is there. */
export const inputCount = () => inputs;

export function noteInput(): void {
  inputs++;
}

const onPointer = () => {
  inputs++;
  keys = false;
  markPointerFocus(true);
};

const onFocus = (e: FocusEvent) => {
  markPointerFocus(!keys);
  if (e.target instanceof Element) remember(e.target);
};

let recorder: ((input: string) => void) | null = null;

/** Hands every input to `listener` instead of its actions until stopped. */
export function record(listener: (input: string) => void): () => void {
  recorder = listener;
  return () => {
    if (recorder === listener) recorder = null;
  };
}

const worksInDialogs = (id: ActionId) => id === 'back' || id.startsWith('nav.');

export function dispatch(input: string, repeat = false): boolean {
  inputs++;
  // The wheel is a pointer's.
  if (!input.startsWith('Wheel')) keys = true;
  if (recorder) {
    recorder(input);
    return true;
  }
  const inDialog = dialogOpen();
  return runHandlers(
    actionsFor(input).filter(
      (id) =>
        (!repeat || action(id).repeat) && (!inDialog || worksInDialogs(id))
    ),
    input
  );
}

const HOLD_MS = 500;

/** A key with a `Hold+` binding, or any key while recording, waits for its release. */
export const holdable = (input: string) =>
  !!recorder || actionsFor(`Hold+${input}`).length > 0;

/**
 * Runs the `Hold+` form of `input` once it has been down long enough. The
 * returned release runs `press` when the hold did nothing, or drops the press.
 */
export function pressAndHold(
  input: string,
  press: () => void
): (drop?: boolean) => void {
  let took = false;
  const timer = setTimeout(() => {
    took = dispatch(`Hold+${input}`);
  }, HOLD_MS);
  return (drop) => {
    clearTimeout(timer);
    if (!took && !drop) press();
  };
}

let holding: {
  key: string;
  at: number;
  release: (drop?: boolean) => void;
} | null = null;

/** A held key's next press within this long is a repeat. */
const REPEAT_GAP_MS = 1000;

const swallow = (e: Event) => {
  e.preventDefault();
  e.stopPropagation();
};

/** The press a hold held back: its shortcut, else what the key does to the focused element. */
function replay(input: string, key: string): void {
  if (dispatch(input)) return;
  if (key === 'Enter' || key === ' ') activate(key);
}

function takesHold(e: KeyboardEvent, input: string): boolean {
  if (holding?.key === e.key) {
    // Android's web view sends a held key's repeats without `repeat`.
    if (e.repeat || e.timeStamp - holding.at < REPEAT_GAP_MS) {
      holding.at = e.timeStamp;
      swallow(e);
      return true;
    }
    // Its release never came.
    holding.release();
    holding = null;
  }
  const target = e.target instanceof Element ? e.target : null;
  if (!holdable(input) || isTextField(target) || inKeyedList(target))
    return false;
  swallow(e);
  holding = {
    key: e.key,
    at: e.timeStamp,
    release: pressAndHold(input, () => replay(input, e.key)),
  };
  return true;
}

function onKeyUp(e: KeyboardEvent): void {
  if (holding?.key !== e.key) return;
  swallow(e);
  const { release } = holding;
  holding = null;
  release();
}

function onBlur(): void {
  holding?.release(true);
  holding = null;
}

let mediaKeyAt = -Infinity;

/**
 * A keyboard's media key also reaches the system's media controls, which hand
 * it back as a press; that press is a repeat once a shortcut took the key.
 */
export const mediaKeyJustTaken = () => performance.now() - mediaKeyAt < 500;

/** Held keys repeat at most this often, keeping the last outcome in between. */
const REPEAT_MS = 100;
const held = new Map<string, { at: number; handled: boolean }>();

function throttled(e: KeyboardEvent, input: string, run: () => boolean) {
  const last = held.get(input);
  if (e.repeat && last && e.timeStamp - last.at < REPEAT_MS)
    return last.handled;
  const handled = run();
  held.set(input, { at: e.timeStamp, handled });
  return handled;
}

const MOVES: readonly ActionId[] = [
  'nav.up',
  'nav.down',
  'nav.left',
  'nav.right',
];

export const movesFocus = (input: string) =>
  actionsFor(input).some((id) => MOVES.includes(id));

/*
 * Keys that move focus are taken before the page sees them, since widgets that
 * roam with the arrows, or open on them, would keep focus from leaving. Other
 * keys wait, so a widget that handles one itself goes first.
 */
function onKey(e: KeyboardEvent, early: boolean): void {
  if (isQuiet(e)) return;
  const input = keyInput(e);
  if (!input) return;
  keys = true;
  if (early) inputs++;
  if (early && takesHold(e, input)) return;
  if (recorder) {
    if (!early) return;
    e.preventDefault();
    e.stopPropagation();
    recorder(input);
    return;
  }
  const target = e.target instanceof Element ? e.target : null;
  if (movesFocus(input) !== early) return;
  const ids = actionsFor(input);
  // A list closes on Esc itself, but not on a remote's Back.
  const listKey =
    inKeyedList(target) && !(ids.includes('back') && input !== 'Escape');
  if (listKey || (early ? ownsKey(target, input) : e.defaultPrevented)) return;
  // A field keeps the keys typed into it, except Back.
  const typing = !early && (isTextField(target) || !!target?.matches('select'));
  const handled = throttled(e, input, () =>
    typing
      ? ids.includes('back') && runAction('back', input)
      : dispatch(input, e.repeat)
  );
  if (!handled) return;
  if (input.split('+').pop()!.startsWith('Media'))
    mediaKeyAt = performance.now();
  e.preventDefault();
  if (early) e.stopPropagation();
}

const WHEEL_STEP = 100;
let wheel = { total: 0, at: 0 };

function scrollsUnder(target: EventTarget | null, dy: number): boolean {
  for (
    let el = target instanceof Element ? target : null;
    el;
    el = el.parentElement
  ) {
    const { overflowY } = getComputedStyle(el);
    const scrolls =
      el === document.documentElement
        ? overflowY !== 'hidden'
        : /auto|scroll/.test(overflowY);
    if (!scrolls) continue;
    if (
      dy < 0
        ? el.scrollTop > 0
        : el.scrollTop + el.clientHeight < el.scrollHeight - 1
    )
      return true;
  }
  return false;
}

/** A notch of a mouse wheel is a step; a trackpad gathers its small ones. */
function onWheel(e: WheelEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !e.deltaY) return;
  const input = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  if (recorder) return recorder(input);
  const target = e.target instanceof Element ? e.target : null;
  if (scrollsUnder(target, e.deltaY) || inKeyedList(target)) return;
  if (
    e.timeStamp - wheel.at > 300 ||
    Math.sign(wheel.total) === -Math.sign(e.deltaY)
  )
    wheel = { total: 0, at: 0 };
  const scale =
    e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 40
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 800
        : 1;
  wheel = { total: wheel.total + e.deltaY * scale, at: e.timeStamp };
  while (Math.abs(wheel.total) >= WHEEL_STEP) {
    dispatch(input);
    wheel.total -= Math.sign(wheel.total) * WHEEL_STEP;
  }
}

export function startInput(): () => void {
  const early = (e: KeyboardEvent) => onKey(e, true);
  const late = (e: KeyboardEvent) => onKey(e, false);
  window.addEventListener('keydown', early, true);
  window.addEventListener('keydown', late);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('focusin', onFocus, true);
  return () => {
    window.removeEventListener('focusin', onFocus, true);
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('keydown', early, true);
    window.removeEventListener('keydown', late);
    window.removeEventListener('wheel', onWheel);
  };
}
