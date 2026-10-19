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

const longest = (spans: Span[]) =>
  spans.reduce((most, s) => Math.max(most, s.endMs - s.startMs), 0);

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
  const start = at(-limitMs);
  const curve = new Float64Array(at(limitMs) - start + 1);
  let slope = 0;
  let value = 0;
  for (let i = 0; i < start + curve.length; i++) {
    if (i >= start) curve[i - start] = value;
    slope += kinks[i];
    value += slope * STEP_MS;
  }
  return curve;
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
  const shares = both.map((b, i) => b / (spoken + shown[i] - b || 1));
  let best = 0;
  let sum = 0;
  for (let i = 0; i < shares.length; i++) {
    sum += shares[i];
    if (shares[i] > shares[best]) best = i;
  }
  const peak = shares[best];
  // The middle of the delays that match about as well as the best.
  let left = best;
  let right = best;
  while (left > 0 && shares[left - 1] >= peak * 0.99) left--;
  while (right < shares.length - 1 && shares[right + 1] >= peak * 0.99) right++;
  let next = 0;
  for (let i = 0; i < shares.length; i++)
    if (Math.abs(i - best) * STEP_MS > NEAR_MS)
      next = Math.max(next, shares[i]);
  const chance = sum / shares.length;
  return {
    delayMs: ((left + right) / 2) * STEP_MS - limitMs,
    match: peak,
    lead: next > chance ? (peak - chance) / (next - chance) : Infinity,
  };
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
  let found: Match | null = null;
  for (const ratio of RATIOS) {
    // Only the target's lines that could land among the reference's.
    const lines = speech(target, ratio).filter(
      (s) =>
        s.endMs > heard[0].startMs - limitMs &&
        s.startMs < heard[heard.length - 1].endMs + limitMs
    );
    if (!lines.length) continue;
    const m = { ...match(heard, read, lines, limitMs), ratio };
    if (!found || m.match > found.match) found = m;
  }
  if (!found) return null;
  return {
    delayMs: Math.round(found.delayMs),
    ratio: found.ratio,
    confident: found.match >= MIN_MATCH && found.lead >= MIN_LEAD,
  };
}
