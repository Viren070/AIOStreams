/*
 * Suppresses cache writes a list render would otherwise repeat, the values
 * being stable.
 *
 * Cleared wholesale when it fills and again on a timer, so an entry evicted
 * from the shared cache is written again rather than suppressed for the life of
 * the process.
 */
const written = new Set<string>();
const MAX = 50_000;
const RESET_MS = 60 * 60 * 1000;
let resetAt = Date.now();

/** True the first time an id is seen in the current window. */
export function firstWriteOf(id: string): boolean {
  const now = Date.now();
  if (now - resetAt > RESET_MS || written.size >= MAX) {
    written.clear();
    resetAt = now;
  }
  if (written.has(id)) return false;
  written.add(id);
  return true;
}
