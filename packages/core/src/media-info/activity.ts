import { REMOTE_ORIGIN_PREFIX } from './remote.js';

const HOUR_MS = 60 * 60 * 1000;
const HOURS = 24;

interface Hour {
  hour: number;
  eligible: number;
  filled: Map<string, number>;
}

// What stream lists found, by the hour, on this process.
const hours: Hour[] = [];

function current(now: number): Hour {
  const hour = Math.floor(now / HOUR_MS);
  let last = hours[hours.length - 1];
  if (last?.hour !== hour) {
    last = { hour, eligible: 0, filled: new Map() };
    hours.push(last);
    while (hours[0].hour <= hour - HOURS) hours.shift();
  }
  return last;
}

function sourceOf(origin: string): string {
  return origin.startsWith(REMOTE_ORIGIN_PREFIX) ? 'remote' : origin;
}

/** One stream list: how many streams could be filled, and from where they were. */
export function noteLookup(eligible: number, filledFrom: string[]): void {
  const hour = current(Date.now());
  hour.eligible += eligible;
  for (const origin of filledFrom) {
    const source = sourceOf(origin);
    hour.filled.set(source, (hour.filled.get(source) ?? 0) + 1);
  }
}

/** Streams listed over the last day that could be filled, and those that were. */
export function lookupActivity(now = Date.now()): {
  eligible: number;
  filled: number;
  bySource: Record<string, number>;
} {
  const from = Math.floor(now / HOUR_MS) - HOURS + 1;
  let eligible = 0;
  const bySource: Record<string, number> = {};
  for (const hour of hours) {
    if (hour.hour < from) continue;
    eligible += hour.eligible;
    for (const [source, n] of hour.filled) {
      bySource[source] = (bySource[source] ?? 0) + n;
    }
  }
  const filled = Object.values(bySource).reduce((a, b) => a + b, 0);
  return { eligible, filled, bySource };
}
