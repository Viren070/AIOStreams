import { sameLanguage } from '../languages';
import type { EngineTrack } from '../playback/engine';
import { alignSubtitles, type Alignment, type Span } from './align';
import { subtitleType } from './tracks';

/** The formats players hand over line by line, rather than as pictures. */
const TEXT_CODECS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text']);
/** Pictures, whose lines only the file's index gives. */
const PICTURE_CODECS = new Set(['hdmv_pgs_subtitle']);

/** The file's own subtitle an added one is matched against: a full one, in its language where there is one, and text over pictures. */
export function referenceTrack(
  tracks: EngineTrack[],
  lang: string | undefined
): EngineTrack | undefined {
  let best: EngineTrack | undefined;
  let bestRank = Infinity;
  for (const track of tracks) {
    const type = subtitleType(track);
    const text = TEXT_CODECS.has(track.codec ?? '');
    if (
      track.type !== 'subtitle' ||
      track.external ||
      (!text && !PICTURE_CODECS.has(track.codec ?? '')) ||
      (type !== 'normal' && type !== 'sdh')
    )
      continue;
    const rank =
      (text ? 0 : 4) +
      (lang && track.lang && sameLanguage(lang, track.lang) ? 0 : 2) +
      (type === 'normal' ? 0 : 1);
    if (rank < bestRank) [best, bestRank] = [track, rank];
  }
  return best;
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
