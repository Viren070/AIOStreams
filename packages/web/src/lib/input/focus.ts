import { glideBy, glideTo, headedTo } from './glide';

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

/** Out of reach by its markup alone, before anything is measured. */
const ruledOut = (el: HTMLElement) =>
  el.matches(
    ':disabled, input[type=hidden], [contenteditable=false], [role=tabpanel], [data-nav=skip], [tabindex="-1"]:not([role=tab]):not([role=radio])'
  ) ||
  !!el.closest('[inert], [aria-hidden=true], [data-tv] [data-nav-tv=skip]');

/** A focusable standing for its whole card (`data-nav-card`) is measured as its `data-nav-box`. */
const rectOf = (el: HTMLElement) =>
  (el.hasAttribute('data-nav-card')
    ? (el.closest('[data-nav-box]') ?? el)
    : el
  ).getBoundingClientRect();

function canFocus(el: HTMLElement, rect = el.getBoundingClientRect()): boolean {
  if (ruledOut(el) || !rect.width || !rect.height) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.pointerEvents !== 'none';
}

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

interface Way {
  score: number;
  gap: number;
  /** How far it lies beside `from`, across the way. */
  off: number;
  /** It overlaps `from` across the way. */
  inLine: boolean;
}

/** How far `to` lies from `from` going `dir`, or null when it lies another way. */
function distance(from: DOMRect, to: DOMRect, dir: Direction): Way | null {
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
  // Only partly that way, it is beside this one unless in line with it.
  if (gap < 0 && off > 0) return null;
  return {
    // Of those in line, the one whose edge lines up with this one's.
    score: Math.max(0, gap) + off * 2 + Math.abs(b1 - a1) / 100,
    gap,
    off,
    inLine: off === 0,
  };
}

type Candidate = Way & { el: HTMLElement; rect: DOMRect };

/** Neighbours in focus's own group that a sideways move may reach out of sight. */
const NEIGHBOURS = 3;

/**
 * What a move weighs, as measuring each costs a slow TV dearly: not slides
 * scrolled out of sight (`data-nav-out`) save focus's neighbours, nor groups a
 * screen or more away, wholly the other way, or sideways, beside focus's own
 * band.
 */
function candidates(
  root: Element,
  from: HTMLElement,
  rect: DOMRect,
  dir: Direction
): HTMLElement[] {
  const sideways = dir === 'left' || dir === 'right';
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const group = from.closest(GROUP);
  const near = new Set<HTMLElement>();
  const at = all.indexOf(from);
  if (sideways && group && at >= 0)
    for (let i = at - NEIGHBOURS; i <= at + NEIGHBOURS; i++)
      if (all[i] && group.contains(all[i])) near.add(all[i]);
  const far = new Map<Element, boolean>();
  return all.filter((el) => {
    if (ruledOut(el)) return false;
    if (near.has(el)) return true;
    if (el.closest('[data-nav-out]')) return false;
    const box = el.closest(GROUP);
    if (!box) return true;
    let away = far.get(box);
    if (away === undefined) {
      const r = box.getBoundingClientRect();
      away = sideways
        ? r.bottom < rect.top - rect.height || r.top > rect.bottom + rect.height
        : r.bottom < -innerHeight ||
          r.top > 2 * innerHeight ||
          (dir === 'down' ? r.bottom <= rect.bottom : r.top >= rect.top);
      far.set(box, away);
    }
    return !away;
  });
}

function nearest(
  root: Element,
  from: HTMLElement,
  dir: Direction,
  everything = false
): HTMLElement | null {
  // Sideways keeps to its own line, so focus stops at a row's end.
  const sideways = dir === 'left' || dir === 'right';
  const rect = rectOf(from);
  const scored: Candidate[] = [];
  const els = everything
    ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.closest('[data-nav-out]')
      )
    : candidates(root, from, rect, dir);
  for (const el of els) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const to = rectOf(el);
    const way = distance(rect, to, dir);
    if (way) scored.push({ ...way, el, rect: to });
  }
  scored.sort((a, b) => a.score - b.score);
  const found = pick(scored, from, rect, dir, sideways);
  // Something only out of sight or far off that way.
  return found || everything || sideways
    ? found
    : nearest(root, from, dir, true);
}

function pick(
  scored: Candidate[],
  from: HTMLElement,
  rect: DOMRect,
  dir: Direction,
  sideways: boolean
): HTMLElement | null {
  // A fixed or sticky bar, such as the sidebar, stays put as the page scrolls
  // past it, so focus keeps to its own side over a nearer bar for what's in line.
  const home = barOf(from);
  let other: HTMLElement | null = null;
  let beside = false;
  for (const way of scored) {
    if (sideways && !way.inLine && !inView(way.rect)) continue;
    if (!canFocus(way.el, way.rect)) continue;
    const bar = barOf(way.el);
    if (bar === home) {
      if (way.inLine) return way.el;
      if (sideways) beside ||= way.off <= rect.height;
      else if (!other) return inNearestRow(scored, way, home);
    } else if (!other && crosses(home ?? from, bar ?? way.el, way.el, dir)) {
      other = way.el;
    }
  }
  // Sideways, a bar is entered only when nothing on this side sits just beside focus.
  return beside ? null : other;
}

/**
 * Up or down with nothing in line, the best of the nearest row, or of its
 * whole `data-nav-group`, so focus never jumps a row.
 */
function inNearestRow(
  ways: Candidate[],
  pick: Candidate,
  home: Element | null
): HTMLElement {
  const valid = (way: Candidate) =>
    canFocus(way.el, way.rect) && barOf(way.el) === home;
  const nearer = ways
    .filter((way) => way.gap < pick.gap)
    .sort((a, b) => a.gap - b.gap)
    .find(valid);
  if (!nearer) return pick.el;
  const group = nearer.el.closest(GROUP);
  const row = nearer.rect;
  return ways.find(
    (way) =>
      (group
        ? group.contains(way.el)
        : way.rect.top < row.bottom && way.rect.bottom > row.top) && valid(way)
  )!.el;
}

/** Focus crosses only to what's in view, into a bar or part of the page wholly that way from the one it leaves. */
function crosses(
  left: Element,
  entered: Element,
  to: HTMLElement,
  dir: Direction
): boolean {
  if (!inView(to)) return false;
  const a = left.getBoundingClientRect();
  const b = entered.getBoundingClientRect();
  switch (dir) {
    case 'right':
      return b.left >= a.right - 1;
    case 'left':
      return b.right <= a.left + 1;
    case 'down':
      return b.top >= a.bottom - 1;
    case 'up':
      return b.bottom <= a.top + 1;
  }
}

/**
 * Focus coming into a box from outside lands on what its `data-nav-enter`
 * selector names, or in a `data-nav-group` where it last was there. From
 * outside any group, a group is entered at the start of the row it lands in.
 */
function entry(to: HTMLElement, from: HTMLElement): HTMLElement {
  const box = to.closest<HTMLElement>('[data-nav-enter]');
  if (box && !box.contains(from)) {
    const named = box.querySelector<HTMLElement>(box.dataset.navEnter!);
    if (named && canFocus(named)) return named;
  }
  const group = to.closest(GROUP);
  if (!group || group.contains(from)) return to;
  const last = lastIn.get(group);
  if (last && group.contains(last) && canFocus(last)) return last;
  if (from.closest(GROUP)) return to;
  const row = rectOf(to);
  const edge = group.getBoundingClientRect();
  for (const el of group.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (ruledOut(el) || el.closest('[data-nav-out]')) continue;
    const r = rectOf(el);
    if (r.bottom <= row.top || r.top >= row.bottom) continue;
    if (
      r.left >= Math.max(edge.left, 0) - 1 &&
      r.right <= Math.min(edge.right, innerWidth) + 1 &&
      canFocus(el, r)
    )
      return el;
  }
  return to;
}

/** Off a row's end in a `data-nav-wrap` grid, the next item along, as text wraps. */
function wrapped(from: HTMLElement, dir: Direction): HTMLElement | null {
  const grid = from.closest('[data-nav-wrap]');
  if (!grid || (dir !== 'left' && dir !== 'right')) return null;
  let cell: Element | null = from;
  while (cell && cell.parentElement !== grid) cell = cell.parentElement;
  const step = (el: Element) =>
    dir === 'right' ? el.nextElementSibling : el.previousElementSibling;
  for (let next = cell && step(cell); next; next = step(next)) {
    const el = next.matches(FOCUSABLE)
      ? (next as HTMLElement)
      : next.querySelector<HTMLElement>(FOCUSABLE);
    if (el && canFocus(el)) return el;
  }
  return null;
}

const GROUP = '[data-nav-group]';
const lastIn = new WeakMap<Element, HTMLElement>();

export function remember(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  for (let group = el.closest(GROUP); group; ) {
    lastIn.set(group, el);
    group = group.parentElement?.closest(GROUP) ?? null;
  }
}

/** Each ancestor's bar during one search, as candidates share most of theirs. */
let bars: Map<Element, Element | null> | null = null;

function barOf(el: Element): Element | null {
  const path: Element[] = [];
  let bar: Element | null = null;
  for (let box: Element | null = el; box; box = box.parentElement) {
    const known = bars?.get(box);
    if (known !== undefined) {
      bar = known;
      break;
    }
    path.push(box);
    const { position } = getComputedStyle(box);
    if (position === 'fixed' || position === 'sticky') {
      bar = box;
      break;
    }
  }
  for (const box of path) bars?.set(box, bar);
  return bar;
}

const inView = (el: HTMLElement | DOMRect) => {
  const r = el instanceof DOMRect ? el : el.getBoundingClientRect();
  return (
    r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  );
};

/** What `data-nav-start` marks, or the first focusable inside it. */
export function startOf(root: ParentNode = document): HTMLElement | null {
  const mark = root.querySelector<HTMLElement>('[data-nav-start]');
  const el = mark?.matches(FOCUSABLE)
    ? mark
    : mark?.querySelector<HTMLElement>(FOCUSABLE);
  return el && canFocus(el) ? el : null;
}

/** The page's start, else the first thing on screen, in its main content where it has one. */
function first(root: Element): HTMLElement | null {
  const start = startOf(root);
  if (start) return start;
  const area = root.querySelector('main') ?? root;
  const all = (el: Element) => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
  return (
    all(area).find((el) => inView(el) && canFocus(el)) ??
    all(root).find((el) => canFocus(el)) ??
    null
  );
}

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

function shownBox(el: HTMLElement): Element {
  let box: Element = el;
  for (
    let up = el.closest('[data-nav-box]');
    up;
    up = up.parentElement?.closest('[data-nav-box]') ?? null
  )
    box = up;
  return box;
}

/**
 * Scrolls each box holding `el`, innermost first; carousels and boxes marked
 * `data-nav-self-scroll` move themselves. Inside `data-nav-box`es, the
 * outermost comes into view; inside `data-nav-top`, the page goes to its top.
 */
function reveal(el: HTMLElement): void {
  let rect = shownBox(el).getBoundingClientRect();
  // A dialog or bar stays put as the page behind it scrolls.
  let onBar = false;
  for (let box: HTMLElement | null = el; box; box = box.parentElement) {
    if (box === document.body || box === document.documentElement) break;
    // Style first, as few boxes scroll and each size read is a layout check.
    const style = getComputedStyle(box);
    if (style.position === 'fixed' || style.position === 'sticky') onBar = true;
    if (box === el || box.hasAttribute('data-nav-self-scroll')) continue;
    const scrollsY =
      /auto|scroll/.test(style.overflowY) &&
      box.scrollHeight > box.clientHeight;
    const scrollsX =
      /auto|scroll/.test(style.overflowX) && box.scrollWidth > box.clientWidth;
    if (!scrollsY && !scrollsX) continue;
    const view = box.getBoundingClientRect();
    // Measured from where a scroll under way ends.
    const [left, top] = headedTo(box);
    rect = new DOMRect(
      rect.x - (left - box.scrollLeft),
      rect.y - (top - box.scrollTop),
      rect.width,
      rect.height
    );
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
    glideTo(box, left + dx, top + dy);
    rect = new DOMRect(rect.x - dx, rect.y - dy, rect.width, rect.height);
  }
  if (onBar) return;
  // A TV keeps focus off the screen's edges, where it's hard to follow from across a room.
  const room = document.documentElement.hasAttribute('data-tv')
    ? innerHeight / 4
    : Math.min(96, innerHeight * 0.15);
  const page = document.documentElement;
  const [left, top] = headedTo(page);
  const dy = el.closest('[data-nav-top]')
    ? -top
    : shortfall(
        { start: 0, end: innerHeight },
        rect.top - (top - scrollY),
        rect.bottom - (top - scrollY),
        room
      );
  if (dy) glideTo(page, left, top + dy);
}

/** Scrolls the box holding focus, or else the page, a step up or down. */
export function scrollStep(dir: 'up' | 'down'): void {
  const dy = (dir === 'up' ? -1 : 1) * Math.round(innerHeight / 4);
  for (
    let box = document.activeElement?.parentElement;
    box && box !== document.body && box !== document.documentElement;
    box = box.parentElement
  ) {
    if (!/auto|scroll/.test(getComputedStyle(box).overflowY)) continue;
    if (
      dy < 0
        ? box.scrollTop > 0
        : box.scrollTop + box.clientHeight < box.scrollHeight - 1
    )
      return glideBy(box, 0, dy);
  }
  glideBy(document.documentElement, 0, dy);
}

export function focusOn(el: HTMLElement): void {
  // Script focus after a click hides the ring, which a remote or gamepad needs.
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  reveal(el);
}

let lastMove: { from: HTMLElement; to: HTMLElement; dir: Direction } | null =
  null;

/**
 * Where focus came into a `data-nav-exit` box from, which a move out its exit
 * side returns to, whatever lies that way.
 */
const cameFrom = new WeakMap<Element, HTMLElement>();

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
  const exit = from.closest<HTMLElement>('[data-nav-exit]');
  const out = exit?.dataset.navExit === dir;
  const came = out ? cameFrom.get(exit!) : undefined;
  if (came?.isConnected && canFocus(came)) {
    moveTo(came, dir);
    return true;
  }
  // Going back the way it came returns to where it was.
  const back =
    lastMove?.to === from &&
    lastMove.dir === OPPOSITE[dir] &&
    root.contains(lastMove.from)
      ? lastMove.from
      : null;
  bars = new Map();
  // Any other way stays in such a box, as what it covers lies beside it.
  const near =
    back && canFocus(back)
      ? back
      : nearest(exit && !out ? exit : root, from, dir);
  bars = null;
  if (!near) {
    const next = wrapped(from, dir);
    if (next) moveTo(next, dir);
    return !!next;
  }
  moveTo(near === back ? near : entry(near, from), dir);
  return true;
}

/** Focuses `to` as a move `dir` would, so the other way comes back. */
export function moveTo(to: HTMLElement, dir: Direction): void {
  const from = document.activeElement;
  if (!(from instanceof HTMLElement) || from === document.body) {
    lastMove = null;
    return focusOn(to);
  }
  const box = to.closest<HTMLElement>('[data-nav-exit]');
  const exit = box && !box.contains(from) && box.dataset.navExit;
  if (exit) cameFrom.set(box, from);
  // Into such a box, only its exit leads back.
  lastMove = { from, to, dir: exit ? OPPOSITE[exit as Direction] : dir };
  focusOn(to);
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
export function activate(key?: string): boolean {
  const el = document.activeElement;
  // With nothing focused, a press shows where focus starts, as an arrow does.
  if (!(el instanceof HTMLElement) || el === document.body) return move('down');
  // A field types a space, and picks a list's highlighted option on Enter.
  key ??= isTextField(el) ? 'Enter' : ' ';
  if (!sendKey(key, { quiet: true }).defaultPrevented) el.click();
  return true;
}
