import type { MediaSegmentDto } from '../types';

type Kind = MediaSegmentDto['Type'];

export interface Chapter {
  title: string;
  startMs: number;
}

/** The app's chapters, in order. */
export function parseChapters(
  chapters: { title?: string; startMs: number }[]
): Chapter[] {
  return chapters
    .filter((c) => Number.isFinite(c.startMs))
    .map((c) => ({
      title: c.title?.trim() ?? '',
      startMs: Math.max(0, c.startMs),
    }))
    .sort((a, b) => a.startMs - b.startMs);
}

/** The chapter playing at `ms`: the last to start at or before it. */
export function chapterAt(chapters: Chapter[], ms: number): number {
  let index = -1;
  chapters.forEach((c, i) => {
    if (c.startMs <= ms) index = i;
  });
  return index;
}

// A whole title, or the words before its first punctuation mark, once
// lowercased and stripped of numbers, so "OP 2" and "OP - Song" match but
// "The Opening of the Gates" and "Opening Night" do not.
/* eslint-disable lingui/no-unlocalized-strings -- Jellyfin's segment kinds */
const KINDS: [Kind, RegExp][] = [
  [
    'Intro' as Kind,
    /^(op|opening|opening (credits|song|theme)|title sequence|main titles?)$/,
  ],
  [
    'Outro' as Kind,
    /^(ed|ending|ending (credits|song|theme)|end credits|credits|closing credits|outro)$/,
  ],
  ['Recap' as Kind, /^(recap|previously|previously on)$/],
  [
    'Preview' as Kind,
    /^(preview|next episode preview|next episode|next time)$/,
  ],
];
/* eslint-enable lingui/no-unlocalized-strings */

/** Names the cold open before the opening in some releases, so it counts only when nothing names the opening. */
const LOOSE_INTRO = /^(intro|introduction)$/;

const UNTITLED = /^(chapter)?$/;

/** TV anime openings and endings run a minute and a half, some with a title card after. */
const SONG_MIN_MS = 85_000;
const SONG_MAX_MS = 110_000;

/** Past this a named chapter also holds the programme, except credits, which run long on films. */
const NAMED_MAX_MS = 180_000;

function plainTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function names(title: string, pattern: RegExp): boolean {
  const lead = title.split(/[^a-z\d '’]/i)[0];
  return pattern.test(plainTitle(title)) || pattern.test(plainTitle(lead));
}

function kindOf(title: string): Kind | undefined {
  return KINDS.find(([, pattern]) => names(title, pattern))?.[0];
}

const TICKS_PER_MS = 10_000;

function segment(type: Kind, startMs: number, endMs: number): MediaSegmentDto {
  return {
    Type: type,
    StartTicks: startMs * TICKS_PER_MS,
    EndTicks: endMs * TICKS_PER_MS,
  };
}

/**
 * Segments named by a file's chapters, in the server's shape, for files the
 * server has none for. A chapter runs until the next one starts.
 */
export function chapterSegments(
  chapters: Chapter[],
  durationMs: number
): MediaSegmentDto[] {
  const hasOpening = chapters.some((c) => kindOf(c.title) === 'Intro');
  return chapters.flatMap((chapter, i) => {
    const type =
      kindOf(chapter.title) ??
      (!hasOpening && names(chapter.title, LOOSE_INTRO)
        ? ('Intro' as Kind)
        : undefined);
    const endMs = chapters[i + 1]?.startMs ?? durationMs;
    if (!type || !(endMs > chapter.startMs)) return [];
    if (type !== 'Outro' && endMs - chapter.startMs > NAMED_MAX_MS) return [];
    return [segment(type, chapter.startMs, endMs)];
  });
}

/** Segments guessed from the lengths of chapters that are only numbered. */
export function guessedSegments(
  chapters: Chapter[],
  durationMs: number
): MediaSegmentDto[] {
  if (
    !(durationMs > 0) ||
    !chapters.every((c) => UNTITLED.test(plainTitle(c.title)))
  )
    return [];
  return chapters.flatMap((chapter, i) => {
    const endMs = chapters[i + 1]?.startMs ?? durationMs;
    const lengthMs = endMs - chapter.startMs;
    if (lengthMs < SONG_MIN_MS || lengthMs > SONG_MAX_MS) return [];
    /* eslint-disable lingui/no-unlocalized-strings -- Jellyfin's segment kinds */
    if (endMs <= durationMs / 3)
      return [segment('Intro' as Kind, chapter.startMs, endMs)];
    if (chapter.startMs >= (durationMs * 2) / 3)
      return [segment('Outro' as Kind, chapter.startMs, endMs)];
    /* eslint-enable lingui/no-unlocalized-strings */
    return [];
  });
}
