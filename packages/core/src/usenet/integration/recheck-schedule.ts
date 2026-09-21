import { createLogger } from '../../logging/logger.js';
import { appConfig } from '../../utils/index.js';
import { parseTime } from '../../utils/time.js';

const logger = createLogger('usenet/recheck');

/** Spread rechecks so a batch imported together does not re-run in lockstep. */
const JITTER = 0.1;

/**
 * Resolve the recheck interval for an entry of `ageMs`, in ms. Keys are
 * maximum ages; the narrowest matching band wins, `*` catches the rest.
 * Returns null when the band says `never` (or nothing matches).
 */
export function resolveRecheckTier(
  schedule: Record<string, string>,
  ageMs: number
): number | null {
  const bands: Array<{ max: number; interval: string }> = [];
  let fallback: string | undefined;
  for (const [key, interval] of Object.entries(schedule)) {
    if (key === '*') {
      fallback = interval;
      continue;
    }
    try {
      bands.push({ max: parseTime(key), interval });
    } catch {
      logger.warn({ key }, 'ignoring invalid recheck schedule age');
    }
  }
  bands.sort((a, b) => a.max - b.max);
  const hit = bands.find((b) => ageMs <= b.max)?.interval ?? fallback;
  if (!hit || hit === 'never') return null;
  try {
    return parseTime(hit);
  } catch {
    logger.warn({ interval: hit }, 'ignoring invalid recheck interval');
    return null;
  }
}

/**
 * Whether now is inside the configured recheck hours. Probing competes with
 * playback for connections, so a window keeps it out of the evening; empty
 * means any hour. A range that wraps past midnight is the normal case.
 */
export function withinRecheckWindow(now = new Date()): boolean {
  const window = appConfig.usenet.recheck.window?.trim();
  if (!window) return true;
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(window);
  if (!match) return true;
  const [fromH, fromM, toH, toM] = match.slice(1).map(Number);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const from = fromH * 60 + fromM;
  const to = toH * 60 + toM;
  return from <= to
    ? minutes >= from && minutes < to
    : minutes >= from || minutes < to;
}

/**
 * When an entry should next be checked, epoch ms (null = never). Age is the
 * NZB's post date where known, else when we added it: fresh posts are the
 * ones that get taken down, old ones that survived rarely change.
 */
export function nextCheckAt(
  entry: { postedAt?: number; addedAt?: string },
  now = Date.now()
): number | null {
  if (appConfig.usenet.recheck.scope === 'off') return null;
  const posted = entry.postedAt
    ? entry.postedAt * 1000
    : entry.addedAt
      ? Date.parse(entry.addedAt)
      : now;
  const ageMs = Math.max(0, now - (Number.isNaN(posted) ? now : posted));
  const interval = resolveRecheckTier(appConfig.usenet.recheck.schedule, ageMs);
  if (interval === null) return null;
  return Math.round(now + interval * (1 + (Math.random() * 2 - 1) * JITTER));
}
