/** One line's time on screen, which is when someone speaks. */
export interface Span {
  startMs: number;
  endMs: number;
}

export interface Alignment {
  /** Shows the target's lines in time with the reference's. */
  delayMs: number;
  /** The target runs at this rate of the reference, as one timed for another frame rate does. */
  ratio: number;
  /** Clear of every other delay. */
  confident: boolean;
}

/** Longer lines are signs or songs, not speech. */
const LONGEST_MS = 12_000;
/** A longer gap between the reference's lines is a stretch it wasn't read over. */
const UNREAD_GAP_MS = 60_000;
const STEP_MS = 10;
/** Delays this close to the best match are its own edges. */
const NEAR_MS = 3000;
const MIN_MATCH = 0.5;
const MIN_LEAD = 1.6;
/** Lines starting or ending this close together start or end together. */
const EDGE_MS = 150;
const MIN_EDGE_LEAD = 2;
const AGREE_MS = 300;

const FILM = 24000 / 1001;
/** Film played at the PAL rate and back. */
const RATIOS = [1, 25 / FILM, FILM / 25];

/** The speech in `lines`, in order, with overlapping lines joined. */
function speech(lines: Span[], ratio = 1): Span[] {
  const sorted = lines
    .filter((l) => l.endMs > l.startMs && l.endMs - l.startMs <= LONGEST_MS)
    .map((l) => ({ startMs: l.startMs * ratio, endMs: l.endMs * ratio }))
    .sort((a, b) => a.startMs - b.startMs);
  return join(sorted, 0);
}

/** Sorted spans with those less than `gapMs` apart joined. */
function join(spans: Span[], gapMs: number): Span[] {
  const joined: Span[] = [];
  for (const span of spans) {
    const last = joined.at(-1);
    if (last && span.startMs - last.endMs <= gapMs)
      last.endMs = Math.max(last.endMs, span.endMs);
    else joined.push({ ...span });
  }
  return joined;
}

/** The times the lines start and end at. */
function edges(lines: Span[], ratio = 1) {
  const kept = lines.filter(
    (l) => l.endMs > l.startMs && l.endMs - l.startMs <= LONGEST_MS
  );
  const times = (of: (l: Span) => number) =>
    kept.map((l) => of(l) * ratio).sort((a, b) => a - b);
  return { starts: times((l) => l.startMs), ends: times((l) => l.endMs) };
}

/**
 * A curve over the delays from -limit to +limit, summed from its changes of
 * slope. Changes before it only set where it starts, so it keeps no more than
 * its own delays. Cleared and reused, as one over ±10 min is a megabyte.
 */
class Curve {
  readonly values: Float64Array;
  private slope = 0;
  private value = 0;

  constructor(readonly limitMs: number) {
    this.values = new Float64Array(Math.round((2 * limitMs) / STEP_MS) + 1);
  }

  clear() {
    this.values.fill(0);
    this.slope = 0;
    this.value = 0;
  }

  add(delayMs: number, change: number) {
    const i = Math.round((delayMs + this.limitMs) / STEP_MS);
    if (i >= this.values.length) return;
    if (i >= 0) this.values[i] += change;
    else {
      this.slope += change;
      this.value -= change * i * STEP_MS;
    }
  }

  sum(): Float64Array {
    const values = this.values;
    let slope = this.slope;
    let value = this.value;
    for (let i = 0; i < values.length; i++) {
      const change = values[i];
      values[i] = value;
      slope += change;
      value += slope * STEP_MS;
    }
    return values;
  }
}

/**
 * How long `target`, moved by each delay from -limit to +limit, overlaps
 * `fixed`. A pair of spans overlaps over a trapezoid of delays, added through
 * its four changes of slope, so the whole curve costs one pass.
 */
function overlaps(fixed: Span[], target: Span[], curve: Curve) {
  curve.clear();
  const { limitMs } = curve;
  let lo = 0;
  let hi = 0;
  for (const t of target) {
    while (lo < fixed.length && fixed[lo].endMs - t.startMs <= -limitMs) lo++;
    while (hi < fixed.length && fixed[hi].startMs - t.endMs < limitMs) hi++;
    for (let i = lo; i < hi; i++) {
      const f = fixed[i];
      const first = f.startMs - t.endMs;
      const last = f.endMs - t.startMs;
      const full = Math.min(f.endMs - f.startMs, t.endMs - t.startMs);
      curve.add(first, 1);
      curve.add(first + full, -1);
      curve.add(last - full, -1);
      curve.add(last, 1);
    }
  }
  return curve.sum();
}

/** How many of `target`'s times each delay brings near one of `fixed`'s, nearer counting more. */
function meetings(fixed: number[], target: number[], curve: Curve) {
  curve.clear();
  const { limitMs } = curve;
  let lo = 0;
  let hi = 0;
  for (const t of target) {
    while (lo < fixed.length && fixed[lo] - t < -limitMs - EDGE_MS) lo++;
    while (hi < fixed.length && fixed[hi] - t <= limitMs + EDGE_MS) hi++;
    for (let i = lo; i < hi; i++) {
      const delay = fixed[i] - t;
      curve.add(delay - EDGE_MS, 1 / EDGE_MS);
      curve.add(delay, -2 / EDGE_MS);
      curve.add(delay + EDGE_MS, 1 / EDGE_MS);
    }
  }
  return curve.sum();
}

/** A curve's best delay and value, and its lead over the best delay clear of it. */
function peak(curve: Float64Array, limitMs: number) {
  let best = 0;
  let sum = 0;
  for (let i = 0; i < curve.length; i++) {
    sum += curve[i];
    if (curve[i] > curve[best]) best = i;
  }
  const top = curve[best];
  // The middle of the delays that match about as well as the best.
  let left = best;
  let right = best;
  while (left > 0 && curve[left - 1] >= top * 0.99) left--;
  while (right < curve.length - 1 && curve[right + 1] >= top * 0.99) right++;
  let next = 0;
  for (let i = 0; i < curve.length; i++)
    if (Math.abs(i - best) * STEP_MS > NEAR_MS) next = Math.max(next, curve[i]);
  const chance = sum / curve.length;
  return {
    delayMs: ((left + right) / 2) * STEP_MS - limitMs,
    value: top,
    lead: next > chance ? (top - chance) / (next - chance) : Infinity,
  };
}

interface Match {
  delayMs: number;
  ratio: number;
  /** The share of the speech both have, out of the speech either has. */
  match: number;
  /** How far the best delay rises above chance, against the next best clear of it. */
  lead: number;
}

function match(heard: Span[], read: Span[], target: Span[], [a, b]: Curve[]) {
  const both = overlaps(heard, target, a);
  const shown = overlaps(read, target, b);
  const spoken = heard.reduce((sum, s) => sum + s.endMs - s.startMs, 0);
  for (let i = 0; i < both.length; i++)
    both[i] /= spoken + shown[i] - both[i] || 1;
  const best = peak(both, a.limitMs);
  return { delayMs: best.delayMs, match: best.value, lead: best.lead };
}

/**
 * Dense dialogue fills so much of the time that delays seconds apart overlap
 * almost as well; the moments lines start and end at still tell them apart.
 */
function edgesAgree(
  reference: Span[],
  target: Span[],
  found: Match,
  [fromMs, toMs]: [number, number],
  [a, b]: Curve[]
): boolean {
  const fixed = edges(reference);
  const moved = edges(target, found.ratio);
  const inside = (times: number[]) =>
    times.filter((t) => t > fromMs && t < toMs);
  const starts = meetings(fixed.starts, inside(moved.starts), a);
  const ends = meetings(fixed.ends, inside(moved.ends), b);
  for (let i = 0; i < starts.length; i++) starts[i] += ends[i];
  const best = peak(starts, a.limitMs);
  return (
    best.lead >= MIN_EDGE_LEAD &&
    Math.abs(best.delayMs - found.delayMs) <= AGREE_MS
  );
}

/**
 * The delay within `limitMs` that lines `target` up with `reference`,
 * matching on timing alone, so the two can be in different languages.
 * `reference` may cover only parts of the video.
 */
export function alignSubtitles(
  reference: Span[],
  target: Span[],
  limitMs: number
): Alignment | null {
  const heard = speech(reference);
  if (!heard.length) return null;
  const read = join(heard, UNREAD_GAP_MS);
  // Only the target's lines that could land among the reference's.
  const range: [number, number] = [
    heard[0].startMs - limitMs,
    heard[heard.length - 1].endMs + limitMs,
  ];
  const curves = [new Curve(limitMs), new Curve(limitMs)];
  let found: Match | null = null;
  for (const ratio of RATIOS) {
    const lines = speech(target, ratio).filter(
      (s) => s.endMs > range[0] && s.startMs < range[1]
    );
    if (!lines.length) continue;
    const m = { ...match(heard, read, lines, curves), ratio };
    if (!found || m.match > found.match) found = m;
  }
  if (!found) return null;
  const confident =
    found.match >= MIN_MATCH &&
    (found.lead >= MIN_LEAD ||
      edgesAgree(reference, target, found, range, curves));
  return {
    delayMs: Math.round(found.delayMs),
    ratio: found.ratio,
    confident,
  };
}
