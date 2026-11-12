import type { Span } from '@/lib/subtitles/align';
import type { MkvFile, MkvSubtitle } from './file';

/** How long a line whose index entry has no duration shows, at most, before the next. */
const UNTIMED_MS = 4000;
/** A PGS entry this short clears the line before it. */
const PGS_CLEAR_MS = 100;
/** Lines outside these are gaps or silences a PGS labelling took for lines. */
const PGS_SHORTEST_MS = 250;
const PGS_LONGEST_MS = 12_000;
/** What a labelling pays for an odd line, a line replaced without a clear, and a doubled clear. */
const PGS_ODD_LINE = 4;
const PGS_REPLACED = 1;
const PGS_CLEARED_TWICE = 3;

interface Point {
  timeMs: number;
  durationMs?: number;
}

/** When the track's lines show, from the file's index; empty where the index leaves it out. */
export function indexLines(file: MkvFile, track: MkvSubtitle): Span[] {
  const points: Point[] = [];
  for (const cue of file.cues.get(track.number) ?? [])
    if (points[points.length - 1]?.timeMs !== cue.timeMs) points.push(cue);
  return track.kind === 'pgs' ? pgsLines(points) : timedLines(points);
}

function timedLines(points: Point[]): Span[] {
  const lines: Span[] = [];
  points.forEach(({ timeMs, durationMs }, i) => {
    const endMs =
      durationMs !== undefined
        ? timeMs + durationMs
        : Math.min(timeMs + UNTIMED_MS, points[i + 1]?.timeMs ?? Infinity);
    if (endMs > timeMs) lines.push({ startMs: timeMs, endMs });
  });
  return lines;
}

/**
 * PGS indexes the display set that shows each line and the one that clears it. Some muxers give
 * the clearing ones a frame's duration; otherwise each entry is labelled one or the other, the
 * labelling with the fewest odd lines and replaced or doubled clears winning.
 */
function pgsLines(points: Point[]): Span[] {
  const clears = points.filter(
    (p) => p.durationMs !== undefined && p.durationMs <= PGS_CLEAR_MS
  ).length;
  if (clears * 10 >= points.length * 3)
    return points.flatMap(({ timeMs, durationMs }) =>
      durationMs !== undefined && durationMs > PGS_CLEAR_MS
        ? [{ startMs: timeMs, endMs: timeMs + durationMs }]
        : []
    );
  const t = points.map((p) => p.timeMs);
  const n = t.length;
  if (n < 2) return [];
  const line = (i: number) => {
    if (i + 1 >= n) return 0;
    const gap = t[i + 1] - t[i];
    return gap < PGS_SHORTEST_MS || gap > PGS_LONGEST_MS ? PGS_ODD_LINE : 0;
  };
  // The cheapest labelling of the entries up to i with entry i showing a line or clearing one, and whether the one before showed one.
  const show = new Array<number>(n).fill(0);
  const clear = new Array<number>(n).fill(0);
  const showAfterShow = new Array<boolean>(n).fill(false);
  const clearAfterShow = new Array<boolean>(n).fill(false);
  show[0] = line(0);
  clear[0] = PGS_CLEARED_TWICE;
  for (let i = 1; i < n; i++) {
    const replaced = show[i - 1] + PGS_REPLACED;
    showAfterShow[i] = replaced < clear[i - 1];
    show[i] = (showAfterShow[i] ? replaced : clear[i - 1]) + line(i);
    const clearedTwice = clear[i - 1] + PGS_CLEARED_TWICE;
    clearAfterShow[i] = show[i - 1] <= clearedTwice;
    clear[i] = clearAfterShow[i] ? show[i - 1] : clearedTwice;
  }
  const lines: Span[] = [];
  let isShow = show[n - 1] < clear[n - 1];
  for (let i = n - 1; i >= 0; i--) {
    if (isShow && i < n - 1) lines.push({ startMs: t[i], endMs: t[i + 1] });
    isShow = isShow ? showAfterShow[i] : clearAfterShow[i];
  }
  return lines.reverse();
}
