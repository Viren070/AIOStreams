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

/** `pace` in ms between jumps and `speed` in px/ms, both 0 for a lone jump. */
interface Chase {
  animation: Animation;
  at: number;
  pace: number;
  speed: number;
}

const chases = new WeakMap<HTMLElement, Chase>();

/** The share of a jump that a chase eases out over; it covers the rest at an even speed. */
const SETTLE = 0.25;

function drawnOffset(layer: HTMLElement, axis: 'X' | 'Y'): number {
  if (chases.get(layer)?.animation.playState !== 'running') return 0;
  const at = new DOMMatrixReadOnly(getComputedStyle(layer).transform);
  return axis === 'X' ? at.m41 : at.m42;
}

/**
 * Draws `layer` back over a jump of `moved` px along `axis`, then eases it home
 * on the compositor. A jump while one is under way carries on from where the
 * layer is drawn at an even speed, timed to the jumps' pace, so a held key
 * glides rather than surging and slowing per jump.
 */
export function easeLayer(
  layer: HTMLElement,
  axis: 'X' | 'Y',
  moved: number
): void {
  // Read and restarted on the same clock, so the compositor carries on unbroken.
  const now = document.timeline.currentTime as number;
  const chase = chases.get(layer);
  const drawn = drawnOffset(layer, axis);
  chase?.animation.cancel();
  const total = drawn + moved;
  let pace = 0;
  let speed = 0;
  let animation: Animation;
  if (chase && drawn * moved > 0) {
    // Smoothed, as repeats land a frame early or late.
    const gap = Math.min(Math.max(now - chase.at, 40), GLIDE_MS);
    pace = chase.pace ? chase.pace + (gap - chase.pace) * 0.3 : gap;
    const tail = moved * SETTLE;
    speed = (total - tail) / pace;
    if (chase.speed) speed = (speed + chase.speed) / 2;
    const even = (total - tail) / speed;
    // No sooner than a lone jump ends, so a late repeat finds it still moving.
    const settle = Math.max((2 * tail) / speed, GLIDE_MS - even);
    // The curve's slope at its start, y1 / x1, meets the even part's speed.
    const slope = (speed * settle) / tail;
    const x1 = Math.min(0.25, 1 / slope);
    animation = layer.animate(
      [
        { transform: `translate${axis}(${total}px)`, easing: 'linear' },
        {
          transform: `translate${axis}(${tail}px)`,
          offset: even / (even + settle),
          easing: `cubic-bezier(${x1}, ${x1 * slope}, 0.5, 1)`,
        },
        { transform: 'none' },
      ],
      even + settle
    );
  } else
    animation = layer.animate(
      [{ transform: `translate${axis}(${total}px)` }, { transform: 'none' }],
      { duration: GLIDE_MS, easing: 'ease-out' }
    );
  animation.startTime = now;
  chases.set(layer, { animation, at: now, pace, speed });
}

const layerOf = (box: Element) =>
  box === document.documentElement
    ? document.querySelector<HTMLElement>('[data-glide-layer=page]')
    : box.querySelector<HTMLElement>(':scope > [data-glide-layer]');

/** How far a scroller's content is still drawn from its scroll position by a jump under way. */
export function glideOffset(box: Element): number {
  const layer = layerOf(box);
  return layer ? drawnOffset(layer, 'Y') : 0;
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
  if (box.scrollTop !== from) easeLayer(layer, 'Y', box.scrollTop - from);
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
