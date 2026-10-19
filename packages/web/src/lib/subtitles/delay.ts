import { t } from '@lingui/core/macro';
import { formatLocale } from '../i18n';
import type { SyncOutcome } from '../playback/controller';
import { storedMap } from '../storage';

import type { SubtitleLine } from './cues';

export const SUBTITLE_DELAY_LIMIT_MS = 600_000;
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

/** How far subtitles are moved, as `+1.5s`, or `+1:02.5` past a minute. */
export function delayAmount(ms: number): string {
  const total = Math.round(Math.abs(ms) / 100) / 10;
  const minutes = Math.floor(total / 60);
  const seconds = (total - minutes * 60).toLocaleString(formatLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    minimumIntegerDigits: minutes ? 2 : 1,
  });
  if (!minutes) return ms > 0 ? t`+${seconds}s` : t`−${seconds}s`;
  const time = `${minutes.toLocaleString(formatLocale())}:${seconds}`;
  return ms > 0 ? t`+${time}` : t`−${time}`;
}

export function delayLabel(ms: number): string {
  return ms ? delayAmount(ms) : t`In sync`;
}

/** What the player says when subtitles move. */
export function delayNotice(ms: number): string {
  if (!ms) return t`Subtitles in sync`;
  const amount = delayAmount(ms);
  return t`Subtitles ${amount}`;
}

/** What the player says about an automatic sync; nothing for a small correction it made unasked. */
export function syncNotice(outcome: SyncOutcome): string | null {
  if ('failed' in outcome) {
    if (outcome.failed === 'speed')
      return t`These subtitles run at a different speed to the video`;
    return outcome.asked
      ? t`These subtitles don't match the video's own`
      : null;
  }
  const moved = Math.abs(outcome.movedMs);
  const amount = delayAmount(outcome.delayMs);
  if (outcome.retimed && outcome.first)
    return moved && outcome.delayMs
      ? t`Subtitles retimed and synced: ${amount}`
      : t`Subtitles retimed to the video's speed`;
  if (!outcome.asked && moved < (outcome.first ? 200 : 1000)) return null;
  if (!outcome.delayMs) return t`Subtitles in sync`;
  return t`Subtitles synced: ${amount}`;
}

/** `fixed` when the user set it for the subtitle, which an automatic sync leaves alone. */
export interface SavedDelay {
  ms: number;
  fixed?: boolean;
}

/*
 * Kept per version and subtitle rather than per title: two releases of one
 * episode, or two subtitles of one release, are rarely off by the same amount.
 */
const delays = storedMap<SavedDelay>(
  'aiostreams-web-subtitle-track-delays',
  500
);
/** One delay for all of a version's subtitles, which one without its own starts from. */
const versionDelays = storedMap<number>('aiostreams-web-subtitle-delays', 200);

export function savedSubtitleDelay(
  sourceId: string | null | undefined,
  track: string | null
): SavedDelay | undefined {
  if (!sourceId) return undefined;
  const own = track ? delays.get(`${sourceId}|${track}`) : undefined;
  const version = versionDelays.get(sourceId);
  return own ?? (version ? { ms: version } : undefined);
}

export function saveSubtitleDelay(
  sourceId: string | null | undefined,
  track: string,
  delay: SavedDelay
): void {
  if (sourceId) delays.set(`${sourceId}|${track}`, delay);
}
