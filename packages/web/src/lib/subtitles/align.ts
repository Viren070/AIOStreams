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

const longest = (spans: Span[]) =>
  spans.reduce((most, s) => Math.max(most, s.endMs - s.startMs), 0);

/** The curve over delays from -limit to +limit, summed from its changes of slope. */
function curveOf(kinks: Float64Array, fromMs: number, limitMs: number) {
  const start = Math.round((-limitMs - fromMs) / STEP_MS);
  const curve = new Float64Array(Math.round((2 * limitMs) / STEP_MS) + 1);
  let slope = 0;
  let value = 0;
  for (let i = 0; i < start + curve.length; i++) {
    if (i >= start) curve[i - start] = value;
    slope += kinks[i];
    value += slope * STEP_MS;
  }
  return curve;
}

/**
 * How long `target`, moved by each delay from -limit to +limit, overlaps
 * `fixed`. A pair of spans overlaps over a trapezoid of delays, added through
 * its four changes of slope, so the whole curve costs one pass.
 */
function overlaps(fixed: Span[], target: Span[], limitMs: number) {
  const margin = longest(fixed) + longest(target);
  const from = -limitMs - Math.ceil(margin / STEP_MS) * STEP_MS;
  const at = (delayMs: number) => Math.round((delayMs - from) / STEP_MS);
  const kinks = new Float64Array(at(-from) + 2);
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
      kinks[at(first)] += 1;
      kinks[at(first + full)] -= 1;
      kinks[at(last - full)] -= 1;
      kinks[at(last)] += 1;
    }
  }
  return curveOf(kinks, from, limitMs);
}

/** How many of `target`'s times each delay brings near one of `fixed`'s, nearer counting more. */
function meetings(fixed: number[], target: number[], limitMs: number) {
  const from = -limitMs - 2 * EDGE_MS;
  const at = (delayMs: number) => Math.round((delayMs - from) / STEP_MS);
  const kinks = new Float64Array(at(limitMs + 2 * EDGE_MS) + 2);
  let lo = 0;
  let hi = 0;
  for (const t of target) {
    while (lo < fixed.length && fixed[lo] - t < -limitMs - EDGE_MS) lo++;
    while (hi < fixed.length && fixed[hi] - t <= limitMs + EDGE_MS) hi++;
    for (let i = lo; i < hi; i++) {
      const delay = fixed[i] - t;
      kinks[at(delay - EDGE_MS)] += 1 / EDGE_MS;
      kinks[at(delay)] -= 2 / EDGE_MS;
      kinks[at(delay + EDGE_MS)] += 1 / EDGE_MS;
    }
  }
  return curveOf(kinks, from, limitMs);
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

function match(heard: Span[], read: Span[], target: Span[], limitMs: number) {
  const both = overlaps(heard, target, limitMs);
  const shown = overlaps(read, target, limitMs);
  const spoken = heard.reduce((sum, s) => sum + s.endMs - s.startMs, 0);
  const best = peak(
    both.map((b, i) => b / (spoken + shown[i] - b || 1)),
    limitMs
  );
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
  limitMs: number
): boolean {
  const fixed = edges(reference);
  const moved = edges(target, found.ratio);
  const inside = (times: number[]) =>
    times.filter((t) => t > fromMs && t < toMs);
  const starts = meetings(fixed.starts, inside(moved.starts), limitMs);
  const ends = meetings(fixed.ends, inside(moved.ends), limitMs);
  const best = peak(
    starts.map((s, i) => s + ends[i]),
    limitMs
  );
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
  let found: Match | null = null;
  for (const ratio of RATIOS) {
    const lines = speech(target, ratio).filter(
      (s) => s.endMs > range[0] && s.startMs < range[1]
    );
    if (!lines.length) continue;
    const m = { ...match(heard, read, lines, limitMs), ratio };
    if (!found || m.match > found.match) found = m;
  }
  if (!found) return null;
  const confident =
    found.match >= MIN_MATCH &&
    (found.lead >= MIN_LEAD ||
      edgesAgree(reference, target, found, range, limitMs));
  return {
    delayMs: Math.round(found.delayMs),
    ratio: found.ratio,
    confident,
  };
}
