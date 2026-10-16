/**
 * How tightly a keyed scroll follows where it's headed, per second: one press
 * settles in about a quarter of a second. Presses that come while it moves
 * pull harder, so a held key's scroll trails focus by under half a row.
 */
const PULL = 28;
const CATCH_UP_PULL = 40;

/** How far behind a scroll may fall, as a share of its box; the rest is skipped. */
const MAX_LAG = 1;

interface Glide {
  to: [number, number];
  at: [number, number];
  /** In pixels per second. */
  speed: [number, number];
  pull: number;
  time: number;
  /** Where the last frame put it, to tell when something else scrolls it. */
  was?: [number, number];
}

const glides = new Map<Element, Glide>();
let frame = 0;

/**
 * How long a keyed glide takes. Focus transitions on cards take as long, as
 * composited animations that end apart run main-thread frames in between.
 */
export const GLIDE_MS = 250;

/** Jumps a scroller's layers carry at once, as a held key's repeats overlap. */
export const GLIDE_LAYERS = 3;

/** Each jump takes the next layer, as nested transforms add up and one under way carries on. */
interface Eased {
  jumps: ({ animation: Animation; moved: [number, number] } | undefined)[];
  next: number;
  at: number;
  /** The time between a held key's repeats, smoothed; 0 after a press. */
  pace: number;
}

const eased = new WeakMap<HTMLElement, Eased>();

let repeating = false;

export function setRepeating(on: boolean): void {
  repeating = on;
}

/**
 * Draws `outer`'s layers back over a jump of `moved` px along `axis`, then eases
 * them home on the compositor. A press eases out. A held key's repeat eases in
 * and out over two of the repeats' gaps, which overlapping add up to an even
 * speed.
 */
export function easeLayers(
  outer: HTMLElement,
  axis: 'X' | 'Y',
  moved: number
): void {
  const layers: HTMLElement[] = [];
  for (
    let el: Element | null = outer;
    el instanceof HTMLElement && el.hasAttribute('data-glide-layer');
    el = el.firstElementChild
  )
    layers.push(el);
  let state = eased.get(outer);
  if (!state)
    eased.set(outer, (state = { jumps: [], next: 0, at: 0, pace: 0 }));
  const now = performance.now();
  const gap = Math.min(Math.max(now - state.at, 80), GLIDE_MS);
  state.at = now;
  // The first repeat's gap is the key's delay before repeating, not its pace.
  state.pace = repeating
    ? state.pace
      ? (state.pace + gap) / 2
      : GLIDE_MS / 2
    : 0;
  const at = state.next % layers.length;
  const busy = state.jumps[at];
  // A jump still under way hands what it has left to the one taking its layer.
  const left = busy ? toGo(busy)[axis === 'X' ? 0 : 1] : 0;
  busy?.animation.cancel();
  const total = moved + left;
  state.jumps[at] = {
    animation: layers[at].animate(
      [{ transform: `translate${axis}(${total}px)` }, { transform: 'none' }],
      state.pace
        ? { duration: 2 * state.pace, easing: 'cubic-bezier(0.5, 0, 0.5, 1)' }
        : { duration: GLIDE_MS, easing: 'ease-out' }
    ),
    moved: axis === 'X' ? [total, 0] : [0, total],
  };
  state.next = at + 1;
}

type Jump = NonNullable<Eased['jumps'][number]>;

function toGo(jump: Jump): [number, number] {
  const progress = jump.animation.effect?.getComputedTiming().progress;
  return progress == null
    ? [0, 0]
    : [jump.moved[0] * (1 - progress), jump.moved[1] * (1 - progress)];
}

function drawnShift(outer: HTMLElement): [number, number] {
  const shift: [number, number] = [0, 0];
  for (const jump of eased.get(outer)?.jumps ?? []) {
    if (!jump) continue;
    const [x, y] = toGo(jump);
    shift[0] += x;
    shift[1] += y;
  }
  return shift;
}

const layerOf = (box: Element) =>
  box === document.documentElement
    ? document.querySelector<HTMLElement>('[data-glide-layer=page]')
    : box.querySelector<HTMLElement>(':scope > [data-glide-layer]');

/** How far a scroller's content is still drawn from its scroll position by jumps under way. */
export function glideOffset(box: Element): number {
  const layer = layerOf(box);
  return layer ? drawnShift(layer)[1] : 0;
}

/** The layers a scroller's content glides in, and how far jumps under way draw them. */
export function glideShift(
  box: Element
): { layer: HTMLElement; shift: [number, number] } | null {
  const layer = layerOf(box);
  return layer && { layer, shift: drawnShift(layer) };
}

/**
 * A sticky bar, marked `data-sticky`, stuck now or by the end of a `dy` scroll,
 * which eased layers would carry off with the page.
 */
function pinned(box: Element, layer: HTMLElement, dy: number): boolean {
  const bars = layer.querySelectorAll<HTMLElement>('[data-sticky]');
  if (!bars.length) return false;
  const view =
    box === document.documentElement ? 0 : box.getBoundingClientRect().top;
  const offset = glideOffset(box);
  for (const el of bars) {
    const style = getComputedStyle(el);
    if (style.position !== 'sticky') continue;
    const top = view + (parseFloat(style.top) || 0);
    const at = el.getBoundingClientRect().top - offset;
    if (at <= top + 1 || at - dy <= top + 1) return true;
  }
  return false;
}

function easeJump(box: Element, layer: HTMLElement, top: number): void {
  glides.delete(box);
  const from = box.scrollTop;
  box.scrollTo(box.scrollLeft, top);
  if (box.scrollTop !== from) easeLayers(layer, 'Y', box.scrollTop - from);
}

/** A critically damped spring's exact place after `time`, however long. */
function advance(glide: Glide, time: number): void {
  const t = (time - glide.time) / 1000;
  if (t <= 0) return;
  const { pull } = glide;
  const decay = Math.exp(-pull * t);
  for (const i of [0, 1]) {
    const off = glide.at[i] - glide.to[i];
    const push = glide.speed[i] + pull * off;
    glide.at[i] = glide.to[i] + (off + push * t) * decay;
    glide.speed[i] = (glide.speed[i] - pull * push * t) * decay;
  }
  glide.time = time;
}

/** Right to left, a scroller runs from 0 down to minus its span. */
function clampX(box: Element, left: number): number {
  const span = box.scrollWidth - box.clientWidth;
  return getComputedStyle(box).direction === 'rtl'
    ? Math.min(0, Math.max(-span, left))
    : Math.max(0, Math.min(span, left));
}

/**
 * Scrolls `box` to a place, carrying on at the speed a scroll under way has:
 * the browser's own smooth scroll starts again from a standstill, so quick
 * presses stutter.
 */
export function glideTo(box: Element, left: number, top: number): void {
  const to: [number, number] = [
    left === box.scrollLeft ? left : clampX(box, left),
    Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight)),
  ];
  if (!glides.has(box) && to[0] === box.scrollLeft && to[1] === box.scrollTop)
    return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    glides.delete(box);
    box.scrollTo(...to);
    return;
  }
  const layer = to[0] === box.scrollLeft ? layerOf(box) : null;
  if (layer && !pinned(box, layer, to[1] - box.scrollTop))
    return easeJump(box, layer, to[1]);
  const now = performance.now();
  let glide = glides.get(box);
  if (glide) {
    advance(glide, now);
    glide.pull = CATCH_UP_PULL;
  } else {
    glide = {
      to,
      at: [box.scrollLeft, box.scrollTop],
      speed: [0, 0],
      pull: PULL,
      time: now,
    };
    glides.set(box, glide);
  }
  glide.to = to;
  const lag = [box.clientWidth * MAX_LAG, box.clientHeight * MAX_LAG];
  for (const i of [0, 1])
    glide.at[i] = Math.min(
      to[i] + lag[i],
      Math.max(to[i] - lag[i], glide.at[i])
    );
  frame ||= requestAnimationFrame(step);
}

/** Where `box` ends up once a scroll under way finishes. */
export const headedTo = (box: Element): [number, number] =>
  glides.get(box)?.to ?? [box.scrollLeft, box.scrollTop];

/** How far `box`'s content still moves on screen before scrolls and jumps under way end. */
export function drift(box: Element): [number, number] {
  const glide = glides.get(box);
  const offset = glideOffset(box);
  if (!glide) return [0, -offset];
  return [box.scrollLeft - glide.to[0], box.scrollTop - glide.to[1] - offset];
}

/** Scrolls `box` on from wherever a scroll under way ends. */
export function glideBy(box: Element, dx: number, dy: number): void {
  const [left, top] = headedTo(box);
  glideTo(box, left + dx, top + dy);
}

function step(now: number): void {
  frame = 0;
  for (const [box, glide] of glides) {
    advance(glide, now);
    const moving = [0, 1].filter(
      (i) => glide.at[i] !== glide.to[i] || glide.speed[i] !== 0
    );
    // A wheel, a finger or a new page scrolled it.
    const { was } = glide;
    if (
      was &&
      moving.some(
        (i) => Math.abs((i ? box.scrollTop : box.scrollLeft) - was[i]) > 2
      )
    ) {
      glides.delete(box);
      continue;
    }
    const settled = moving.every(
      (i) =>
        Math.abs(glide.at[i] - glide.to[i]) < 1 && Math.abs(glide.speed[i]) < 60
    );
    if (settled) {
      box.scrollTo(...glide.to);
      glides.delete(box);
    } else {
      box.scrollTo(...glide.at);
      glide.was = [...glide.at];
    }
  }
  if (glides.size) frame = requestAnimationFrame(step);
}
