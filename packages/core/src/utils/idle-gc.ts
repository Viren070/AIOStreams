import { createLogger } from '../logging/logger.js';

const logger = createLogger('idle-gc');

let lastGcAt = 0;

const MIN_INTERVAL_MS = 30_000;

/**
 * Callers invoke this at a quiescence milestone (idle-engine eviction)
 * to hand that memory back when nothing latency-sensitive is running.
 *
 * Requires `--expose-gc`; without the flag this is a no-op.
 */
export function idleGc(reason: string): boolean {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== 'function') return false;
  const now = Date.now();
  if (now - lastGcAt < MIN_INTERVAL_MS) return false;
  lastGcAt = now;
  const before = process.memoryUsage();
  // Twice: the first pass runs finalizers/weak callbacks whose garbage only
  // the second pass collects (Buffer backing stores in particular).
  gc();
  gc();
  const after = process.memoryUsage();
  logger.debug(
    {
      reason,
      rssMb: Math.round(after.rss / 1048576),
      freedRssMb: Math.round((before.rss - after.rss) / 1048576),
      freedExternalMb: Math.round((before.external - after.external) / 1048576),
      tookMs: Date.now() - now,
    },
    'idle gc'
  );
  return true;
}
