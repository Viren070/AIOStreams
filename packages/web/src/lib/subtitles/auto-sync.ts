import { sameLanguage } from '../languages';
import type { EngineTrack } from '../playback/engine';
import { alignSubtitles, type Alignment, type Span } from './align';
import { subtitleType } from './tracks';

/** The formats players hand over line by line, rather than as pictures. */
const TEXT_CODECS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text']);
/** Pictures, whose lines only the file's index gives. */
const PICTURE_CODECS = new Set(['hdmv_pgs_subtitle']);

/** A full subtitle of the file's own, in a format whose lines can be had. */
function fullTrack(track: EngineTrack): boolean {
  const type = subtitleType(track);
  const codec = track.codec ?? '';
  return (
    track.type === 'subtitle' &&
    !track.external &&
    (TEXT_CODECS.has(codec) || PICTURE_CODECS.has(codec)) &&
    (type === 'normal' || type === 'sdh')
  );
}

/** Lower first: a full one, in the subtitle's language, text over pictures; with every track's lines to hand, the language counts first. */
function rank(
  track: EngineTrack,
  lang: string | undefined,
  indexed: boolean
): number {
  const picture = PICTURE_CODECS.has(track.codec ?? '');
  const other = !(lang && track.lang && sameLanguage(lang, track.lang));
  return (
    (indexed
      ? (other ? 4 : 0) + (picture ? 2 : 0)
      : (picture ? 4 : 0) + (other ? 2 : 0)) +
    (subtitleType(track) === 'normal' ? 0 : 1)
  );
}

/** The fewest lines in the index a track needs to be weighed against the others. */
const MIN_TRACK_LINES = 30;

/**
 * The file's own subtitle an added one is matched against: a full one, in its
 * language where there is one. With the file's `index`, the best one the
 * file's other subtitles back.
 */
export function referenceTrack(
  tracks: EngineTrack[],
  lang: string | undefined,
  index?: Record<string, Span[]> | null
): EngineTrack | undefined {
  const full = tracks.filter(fullTrack);
  const indexed = full.filter(
    (t) => (index?.[t.id]?.length ?? 0) >= MIN_TRACK_LINES
  );
  const order = (list: EngineTrack[], byIndex: boolean) =>
    [...list].sort((a, b) => rank(a, lang, byIndex) - rank(b, lang, byIndex));
  if (!index || !indexed.length) return order(full, false)[0];
  return order(indexed, true).find(backing(indexed, index));
}

/** Lines starting and ending this close together are the same line. */
const SAME_LINE_MS = 80;
/** The share of one track's lines another has for the two to be one source. */
const SAME_SOURCE = 0.85;
/** Tracks of one file this close line up with the same video. */
const SAME_VIDEO_MS = 400;
const SAME_VIDEO_LIMIT_MS = 10_000;

/** The share of `a`'s lines that `b` starts and ends with too. */
function sharedLines(a: Span[], b: Span[]): number {
  let from = 0;
  let shared = 0;
  for (const line of a) {
    while (from < b.length && b[from].startMs < line.startMs - SAME_LINE_MS)
      from++;
    for (
      let i = from;
      i < b.length && b[i].startMs <= line.startMs + SAME_LINE_MS;
      i++
    )
      if (Math.abs(b[i].endMs - line.endMs) <= SAME_LINE_MS) {
        shared++;
        break;
      }
  }
  return shared / a.length;
}

/**
 * Whether the file's other subtitles back a track: all are timed to the same
 * video, so independent ones line up at about no delay. Tracks timed alike, one
 * source in two formats or languages, count once. Of three or more sources,
 * one that none back while two back each other is out; of two that disagree,
 * the picture one, the disc's own, stays. Pairs are lined up only as asked.
 */
function backing(tracks: EngineTrack[], index: Record<string, Span[]>) {
  const sources: { tracks: EngineTrack[]; lines: Span[] }[] = [];
  for (const track of tracks) {
    const lines = [...index[track.id]].sort((a, b) => a.startMs - b.startMs);
    const same = sources.find(
      (s) =>
        sharedLines(s.lines, lines) >= SAME_SOURCE &&
        sharedLines(lines, s.lines) >= SAME_SOURCE
    );
    if (same) same.tracks.push(track);
    else sources.push({ tracks: [track], lines });
  }
  const agreed = new Map<string, boolean>();
  const agree = (i: number, j: number) => {
    const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
    let found = agreed.get(key);
    if (found === undefined) {
      const a = alignSubtitles(
        sources[Math.min(i, j)].lines,
        sources[Math.max(i, j)].lines,
        SAME_VIDEO_LIMIT_MS
      );
      found =
        !!a?.confident && a.ratio === 1 && Math.abs(a.delayMs) <= SAME_VIDEO_MS;
      agreed.set(key, found);
    }
    return found;
  };
  const picture = (i: number) =>
    sources[i].tracks.some((t) => PICTURE_CODECS.has(t.codec ?? ''));
  return (track: EngineTrack) => {
    const i = sources.findIndex((s) => s.tracks.includes(track));
    const others = sources.flatMap((_, j) => (j === i ? [] : [j]));
    if (!others.length || others.some((j) => agree(i, j))) return true;
    if (others.length === 1) return picture(i) || !picture(others[0]);
    return !others.some((j) => others.some((k) => k > j && agree(j, k)));
  };
}

/** A delay to show the subtitle with, a ratio to stretch its times by, or why neither. */
export type SyncResult =
  { delayMs: number } | { ratio: number } | { failed: 'unmatched' };

const MIN_LINES = 30;
const MIN_SPAN_MS = 60_000;
/** The lines around the playhead each try matches with, so a scene a cut moved soon wins. */
const WINDOW_LINES = 100;
/** Heard without a match, the subtitle belongs to something else. */
const GIVE_UP_LINES = 150;
const EVERY_LINES = 10;
/** Enough lines for one answer to stand alone. */
const SURE_LINES = 60;
const AGREE_MS = 300;
/** Smaller corrections aren't worth a jump. */
const NUDGE_MS = 150;

/**
 * Lines `target` up with the lines of the file's own subtitle as they come,
 * settling once two tries agree or one has plenty to go on, then following
 * the lines around the playhead for as long as it runs.
 */
export class SubtitleSync {
  private readonly heard = new Map<string, Span>();
  private received = 0;
  private triedAt = 0;
  private last: Alignment | null = null;
  private applied: number | null = null;
  /** Nothing more will change its answer. */
  done = false;

  /** Lines heard before it gives up. */
  private readonly patience: number;

  /** `asked` when the user waits on an answer, which comes as soon as one try can stand alone. */
  constructor(
    private readonly target: Span[],
    private readonly limitMs: number,
    private readonly positionMs: () => number,
    asked = false
  ) {
    this.patience = asked ? SURE_LINES : GIVE_UP_LINES;
  }

  /** Takes lines of the reference as they are read; a result when they settle or move it. */
  add(lines: Span[]): SyncResult | null {
    if (this.done) return null;
    for (const line of lines) {
      // Players time a line to the centisecond or the millisecond.
      const key = `${Math.floor(line.startMs / 10)}:${Math.floor(line.endMs / 10)}`;
      this.heard.set(key, line);
    }
    this.received += lines.length;
    const count = this.heard.size;
    if (count < MIN_LINES || this.received - this.triedAt < EVERY_LINES)
      return null;
    const reference = this.around(this.positionMs());
    if (reference.at(-1)!.endMs - reference[0].startMs < MIN_SPAN_MS)
      return null;
    this.triedAt = this.received;
    const found = alignSubtitles(reference, this.target, this.limitMs);
    const last = this.last;
    this.last = found;
    if (!found?.confident) {
      if (this.applied !== null || count < this.patience) return null;
      this.done = true;
      return { failed: 'unmatched' };
    }
    const agrees =
      !!last?.confident &&
      last.ratio === found.ratio &&
      Math.abs(last.delayMs - found.delayMs) <= AGREE_MS;
    if (!agrees && (this.applied !== null || reference.length < SURE_LINES))
      return null;
    if (found.ratio !== 1) {
      if (this.applied !== null) return null;
      this.done = true;
      return { ratio: found.ratio };
    }
    if (
      this.applied !== null &&
      Math.abs(found.delayMs - this.applied) < NUDGE_MS
    )
      return null;
    this.applied = found.delayMs;
    return { delayMs: found.delayMs };
  }

  private around(atMs: number): Span[] {
    const lines = [...this.heard.values()].sort(
      (a, b) => a.startMs - b.startMs
    );
    const next = lines.findIndex((l) => l.startMs >= atMs);
    const from = Math.max(
      0,
      Math.min(
        (next < 0 ? lines.length : next) - WINDOW_LINES / 2,
        lines.length - WINDOW_LINES
      )
    );
    return lines.slice(from, from + WINDOW_LINES);
  }
}
