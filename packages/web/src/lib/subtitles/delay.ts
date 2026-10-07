import { storedMap } from '../storage';

import type { SubtitleLine } from './cues';

export const SUBTITLE_DELAY_LIMIT_MS = 60_000;
export const SUBTITLE_DELAY_STEP_MS = 100;
/** Pressing on hearing a line comes this late, on average. */
const REACTION_MS = 300;

export function clampDelay(ms: number): number {
  return Math.max(
    -SUBTITLE_DELAY_LIMIT_MS,
    Math.min(SUBTITLE_DELAY_LIMIT_MS, Math.round(ms))
  );
}

/** The delay that shows `line` at `heardAtMs`, the moment it was heard. */
export function delayForLine(heardAtMs: number, line: SubtitleLine): number {
  return clampDelay(heardAtMs - line.startMs - REACTION_MS);
}

/** Taps further apart than this were two different lines. */
const MAX_TAP_GAP_MS = 30_000;

/**
 * The delay from when a line was heard and when its subtitle showed; null when
 * too far apart to be one line. Reaction time is in both taps and cancels out.
 */
export function delayForTaps(
  delayMs: number,
  heardAtMs: number,
  sawAtMs: number
): number | null {
  const gap = heardAtMs - sawAtMs;
  return Math.abs(gap) > MAX_TAP_GAP_MS ? null : clampDelay(delayMs + gap);
}

export function delayLabel(ms: number): string {
  if (!ms) return 'In sync';
  return `${ms > 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

/*
 * Kept per version rather than per title: two releases of one episode are
 * rarely off by the same amount.
 */
const delays = storedMap<number>('aiostreams-web-subtitle-delays', 200);

export function savedSubtitleDelay(
  sourceId: string | null | undefined
): number {
  return (sourceId && delays.get(sourceId)) || 0;
}

export function saveSubtitleDelay(
  sourceId: string | null | undefined,
  ms: number
): void {
  if (sourceId) delays.set(sourceId, ms || undefined);
}
