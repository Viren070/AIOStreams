import type { MediaSegmentDto } from './types';

export interface Chapter {
  title: string;
  startMs: number;
}

/** mpv's `chapter-list`, in order, without chapters it gives no time for. */
export function parseChapters(data: unknown): Chapter[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (c): c is { title?: unknown; time: number } =>
        typeof c?.time === 'number' && Number.isFinite(c.time)
    )
    .map((c) => ({
      title: typeof c.title === 'string' ? c.title.trim() : '',
      startMs: Math.max(0, c.time * 1000),
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

// Whole titles only, once lowercased and stripped of numbers and punctuation,
// so "OP 2" and "Opening Credits" match but "The Opening of the Gates" does not.
const KINDS: [MediaSegmentDto['Type'], RegExp][] = [
  [
    'Intro' as MediaSegmentDto['Type'],
    /^(op|opening|opening (credits|song|theme)|intro|introduction|title sequence|main titles?)$/,
  ],
  [
    'Outro' as MediaSegmentDto['Type'],
    /^(ed|ending|ending (credits|song|theme)|end credits|credits|closing credits|outro)$/,
  ],
  ['Recap' as MediaSegmentDto['Type'], /^(recap|previously|previously on)$/],
  [
    'Preview' as MediaSegmentDto['Type'],
    /^(preview|next episode preview|next episode|next time)$/,
  ],
];

function kindOf(title: string): MediaSegmentDto['Type'] | undefined {
  const plain = title
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
  return KINDS.find(([, pattern]) => pattern.test(plain))?.[0];
}

const TICKS_PER_MS = 10_000;

/**
 * Segments named by a file's chapters, in the server's shape, for files the
 * server has none for. A chapter runs until the next one starts.
 */
export function chapterSegments(
  chapters: Chapter[],
  durationMs: number
): MediaSegmentDto[] {
  return chapters.flatMap((chapter, i) => {
    const type = kindOf(chapter.title);
    const endMs = chapters[i + 1]?.startMs ?? durationMs;
    if (!type || !(endMs > chapter.startMs)) return [];
    return [
      {
        Type: type,
        StartTicks: chapter.startMs * TICKS_PER_MS,
        EndTicks: endMs * TICKS_PER_MS,
      },
    ];
  });
}
