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

/** Each jump takes the next layer, as nested transforms add up and one under way carries on. */
interface Eased {
  layers: HTMLElement[];
  jumps: { animation: Animation; dy: number }[];
  next: number;
}

const eased = new WeakMap<Element, Eased>();

function layersOf(box: Element): HTMLElement[] | null {
  const outer =
    box === document.documentElement
      ? document.querySelector<HTMLElement>('[data-glide-layers=page]')
      : box.querySelector<HTMLElement>(':scope > [data-glide-layers]');
  if (!outer) return null;
  const layers: HTMLElement[] = [];
  let el: Element | null = outer;
  while (el instanceof HTMLElement && el.hasAttribute('data-glide-layer')) {
    layers.push(el);
    el = el.firstElementChild;
  }
  return layers.length ? layers : null;
}

/** How far a scroller's content is still drawn from its scroll position by jumps under way. */
export function glideOffset(box: Element): number {
  let dy = 0;
  for (const jump of eased.get(box)?.jumps ?? []) {
    const progress = jump.animation.effect?.getComputedTiming().progress;
    if (progress != null) dy += jump.dy * (1 - progress);
  }
  return dy;
}

/**
 * A sticky bar, marked `data-sticky`, stuck now or by the end of a `dy` scroll,
 * which eased layers would carry off with the page.
 */
function pinned(box: Element, layers: HTMLElement[], dy: number): boolean {
  const bars = layers[0].querySelectorAll<HTMLElement>('[data-sticky]');
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

function easeJump(box: Element, layers: HTMLElement[], top: number): void {
  glides.delete(box);
  const from = box.scrollTop;
  box.scrollTo(box.scrollLeft, top);
  const dy = box.scrollTop - from;
  if (!dy) return;
  let state = eased.get(box);
  if (!state || state.layers[0] !== layers[0])
    eased.set(box, (state = { layers, jumps: [], next: 0 }));
  const layer = state.layers[state.next];
  state.jumps[state.next]?.animation.finish();
  state.jumps[state.next] = {
    animation: layer.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
      { duration: GLIDE_MS, easing: 'ease-out' }
    ),
    dy,
  };
  state.next = (state.next + 1) % state.layers.length;
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

/**
 * Scrolls `box` to a place, carrying on at the speed a scroll under way has:
 * the browser's own smooth scroll starts again from a standstill, so quick
 * presses stutter.
 */
export function glideTo(box: Element, left: number, top: number): void {
  const to: [number, number] = [
    Math.max(0, Math.min(left, box.scrollWidth - box.clientWidth)),
    Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight)),
  ];
  if (!glides.has(box) && to[0] === box.scrollLeft && to[1] === box.scrollTop)
    return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    glides.delete(box);
    box.scrollTo(...to);
    return;
  }
  const layers = to[0] === box.scrollLeft ? layersOf(box) : null;
  if (layers && !pinned(box, layers, to[1] - box.scrollTop))
    return easeJump(box, layers, to[1]);
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
