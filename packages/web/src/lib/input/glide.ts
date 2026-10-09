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
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    glides.delete(box);
    box.scrollTo(...to);
    return;
  }
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
