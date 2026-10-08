export type Direction = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex], [contenteditable]';

// Chained, since older TV browsers take no list inside one :not().
const NOT_TYPED = [
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]
  .map((type) => `:not([type=${type}])`)
  .join('');

const TEXT_FIELD = `input${NOT_TYPED}, textarea, [contenteditable=""], [contenteditable=true]`;

/** Popup lists whose own keys move through them and close them. */
const KEYED_LIST =
  '[role=menu], [role=menubar], [role=listbox], [role=tree], [role=grid]';

const OPEN_DIALOG =
  '[role=dialog][data-state=open], [role=alertdialog][data-state=open]';

const OPEN_OVERLAY = `${OPEN_DIALOG}, [role=menu][data-state=open], [role=listbox][data-state=open]`;

export function isTextField(el: Element | null): el is HTMLElement {
  return !!el?.matches(TEXT_FIELD);
}

export const inKeyedList = (el: Element | null) => !!el?.closest(KEYED_LIST);

export const dialogOpen = () => !!document.querySelector(OPEN_DIALOG);

const POINTER_FOCUS = 'data-pointer-focus';

/**
 * Marks focus that came from a pointer, so it shows no ring. Chromium rings it
 * once any key is pressed, and rings what a clicked menu focuses if a key came
 * before.
 */
export const markPointerFocus = (pointer: boolean) =>
  document.documentElement.toggleAttribute(POINTER_FOCUS, pointer);

/** What the keyboard, a remote or a gamepad is on, rather than a pointer. */
export function keyboardFocus(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement &&
    el !== document.body &&
    el.matches(':focus-visible') &&
    !document.documentElement.hasAttribute(POINTER_FOCUS)
    ? el
    : null;
}

export const overlayOpen = () => !!document.querySelector(OPEN_OVERLAY);

export const inOverlay = (el: Element) =>
  !!el.closest(
    '[role=dialog], [role=alertdialog], [role=menu], [role=listbox]'
  );

const VERTICAL = ['ArrowUp', 'ArrowDown'];
const HORIZONTAL = ['ArrowLeft', 'ArrowRight'];

export function ownsKey(el: Element | null, input: string): boolean {
  if (!el) return false;
  // Even read-only, as a TV keeps an open list's filter.
  if (el.matches('[role=combobox][aria-expanded=true]')) return true;
  // Nothing is typed into a read-only field, so the arrows leave it.
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    el.readOnly
  )
    return false;
  if (
    el.matches(
      'textarea, select, [contenteditable=""], [contenteditable=true], [role=spinbutton]'
    )
  )
    return true;
  // Up and down leave a one-line field.
  if (isTextField(el)) return !VERTICAL.includes(input);
  if (el.matches('[role=slider], input[type=range]'))
    return (
      el.getAttribute('aria-orientation') === 'vertical' ? VERTICAL : HORIZONTAL
    ).includes(input);
  return false;
}

/** The open dialog on top, or the page. */
function scope(): Element {
  const dialogs = document.querySelectorAll(OPEN_DIALOG);
  return dialogs[dialogs.length - 1] ?? document.body;
}

function canFocus(el: HTMLElement): boolean {
  if (
    el.matches(
      ':disabled, input[type=hidden], [contenteditable=false], [role=tabpanel], [data-nav=skip], [tabindex="-1"]:not([role=tab]):not([role=radio])'
    ) ||
    el.closest('[inert], [aria-hidden=true]')
  )
    return false;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.pointerEvents !== 'none';
}

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

/** How far `to` lies from `from` going `dir`, or null when it lies another way. */
function distance(from: DOMRect, to: DOMRect, dir: Direction): number | null {
  let gap: number;
  switch (dir) {
    case 'right':
      if (to.left <= from.left || to.right <= from.right) return null;
      gap = to.left - from.right;
      break;
    case 'left':
      if (to.right >= from.right || to.left >= from.left) return null;
      gap = from.left - to.right;
      break;
    case 'down':
      if (to.top <= from.top || to.bottom <= from.bottom) return null;
      gap = to.top - from.bottom;
      break;
    case 'up':
      if (to.bottom >= from.bottom || to.top >= from.top) return null;
      gap = from.top - to.bottom;
  }
  const across: [number, number, number, number] =
    dir === 'left' || dir === 'right'
      ? [from.top, from.bottom, to.top, to.bottom]
      : [from.left, from.right, to.left, to.right];
  const [a1, a2, b1, b2] = across;
  const off = Math.max(0, b1 - a2, a1 - b2);
  // Of those in line, the one whose edge lines up with this one's.
  return Math.max(0, gap) + off * 2 + Math.abs(b1 - a1) / 100;
}

function nearest(
  root: Element,
  from: HTMLElement,
  dir: Direction
): HTMLElement | null {
  const rect = from.getBoundingClientRect();
  const scored: { el: HTMLElement; score: number }[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const score = distance(rect, el.getBoundingClientRect(), dir);
    if (score !== null) scored.push({ el, score });
  }
  scored.sort((a, b) => a.score - b.score);
  // A fixed bar, such as the sidebar, stays put as the page scrolls past it, so
  // focus only crosses between it and the page when its own side has nothing.
  const home = fixedBox(from);
  let other: HTMLElement | null = null;
  for (const { el } of scored) {
    if (!canFocus(el)) continue;
    if (fixedBox(el) === home) return el;
    other ??= el;
  }
  return other;
}

/** A box marked `data-nav-enter` takes focus from outside on what that selector names. */
function entry(to: HTMLElement, from: HTMLElement): HTMLElement {
  const box = to.closest<HTMLElement>('[data-nav-enter]');
  if (!box || box.contains(from)) return to;
  const named = box.querySelector<HTMLElement>(box.dataset.navEnter!);
  return named && canFocus(named) ? named : to;
}

function fixedBox(el: Element): Element | null {
  for (let box: Element | null = el; box; box = box.parentElement)
    if (getComputedStyle(box).position === 'fixed') return box;
  return null;
}

const inView = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return (
    r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  );
};

/** The first thing on screen, in the page's main content where it has one. */
function first(root: Element): HTMLElement | null {
  const area = root.querySelector('main') ?? root;
  const all = (el: Element) => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
  return (
    all(area).find((el) => inView(el) && canFocus(el)) ??
    all(root).find(canFocus) ??
    null
  );
}

const smooth = (): ScrollBehavior =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** How far a box must scroll to show `rect` with some room around it. */
function shortfall(
  view: { start: number; end: number },
  start: number,
  end: number,
  room: number
): number {
  if (end - start > view.end - view.start - room * 2)
    return start - view.start - room;
  if (start < view.start + room) return start - view.start - room;
  if (end > view.end - room) return end - view.end + room;
  return 0;
}

/** Scrolls each box holding `el`, innermost first; carousels move themselves. */
function reveal(el: HTMLElement): void {
  let rect = el.getBoundingClientRect();
  const behavior = smooth();
  for (let box = el.parentElement; box; box = box.parentElement) {
    if (box === document.body || box === document.documentElement) break;
    const style = getComputedStyle(box);
    const scrollsY =
      /auto|scroll/.test(style.overflowY) &&
      box.scrollHeight > box.clientHeight;
    const scrollsX =
      /auto|scroll/.test(style.overflowX) && box.scrollWidth > box.clientWidth;
    if (!scrollsY && !scrollsX) continue;
    const view = box.getBoundingClientRect();
    const dy = scrollsY
      ? shortfall(
          { start: view.top, end: view.bottom },
          rect.top,
          rect.bottom,
          24
        )
      : 0;
    const dx = scrollsX
      ? shortfall(
          { start: view.left, end: view.right },
          rect.left,
          rect.right,
          16
        )
      : 0;
    if (!dx && !dy) continue;
    box.scrollTo({
      top: box.scrollTop + dy,
      left: box.scrollLeft + dx,
      behavior,
    });
    rect = new DOMRect(rect.x - dx, rect.y - dy, rect.width, rect.height);
  }
  const room = Math.min(96, innerHeight * 0.15);
  const dy = shortfall(
    { start: 0, end: innerHeight },
    rect.top,
    rect.bottom,
    room
  );
  if (dy) window.scrollTo({ top: scrollY + dy, behavior });
}

export function focusOn(el: HTMLElement): void {
  // Script focus after a click hides the ring, which a remote or gamepad needs.
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  reveal(el);
}

let lastMove: { from: HTMLElement; to: HTMLElement; dir: Direction } | null =
  null;

/** Moves focus to the nearest thing that way; nothing focused starts at the first. */
export function move(dir: Direction): boolean {
  const root = scope();
  const from = document.activeElement;
  if (
    !(from instanceof HTMLElement) ||
    from === document.body ||
    !root.contains(from)
  ) {
    const start = first(root);
    if (start) focusOn(start);
    return !!start;
  }
  // Going back the way it came returns to where it was.
  const back =
    lastMove?.to === from &&
    lastMove.dir === OPPOSITE[dir] &&
    root.contains(lastMove.from)
      ? lastMove.from
      : null;
  const near = back && canFocus(back) ? back : nearest(root, from, dir);
  if (!near) return false;
  const to = near === back ? near : entry(near, from);
  lastMove = { from, to, dir };
  focusOn(to);
  return true;
}

const quiet = new WeakSet<Event>();

/** Keys sent only for the focused widget, which shortcuts leave alone. */
export const isQuiet = (e: Event) => quiet.has(e);

export function sendKey(
  key: string,
  opts: { repeat?: boolean; quiet?: boolean } = {}
): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key,
    code: key === ' ' ? 'Space' : key,
    repeat: opts.repeat,
    bubbles: true,
    cancelable: true,
  });
  if (opts.quiet) quiet.add(e);
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
}

/** The focused element's right-click menu, opened beside it. */
export function openMenu(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  const rect = el.getBoundingClientRect();
  return !el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    })
  );
}

/** The key where a widget handles it, which menus and pickers open on; a click otherwise. */
export function activate(key = ' '): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  if (!sendKey(key, { quiet: true }).defaultPrevented) el.click();
  return true;
}
