import { Cache } from '../utils/cache.js';
import { createLogger } from '../logging/logger.js';
import type { ArrInstance } from './types.js';

const logger = createLogger('arr');

/**
 * How many times we have replaced a release for one movie or episode.
 * Every replacement is a fresh grab with a fresh download id, so the count
 * has to live against the target, outside any one download. The TTL is the
 * reset for anything that quietly came good and never reported it.
 */
const TTL_SECONDS = 30 * 24 * 60 * 60;

// `sql` explicitly: the default backend is memory unless Redis is configured,
// and a count that resets on restart would defeat the point.
const counts = Cache.getInstance<string, number>(
  'arr-repair-counts',
  undefined,
  'sql'
);

function key(
  instanceId: string,
  type: ArrInstance['type'],
  targetId: number
): string {
  return `${instanceId}:${type}:${targetId}`;
}

/** Record one more replacement, and report the running total. */
export async function bumpRepairCount(
  instanceId: string,
  type: ArrInstance['type'],
  targetId: number
): Promise<number> {
  const k = key(instanceId, type, targetId);
  const next = ((await counts.get(k)) ?? 0) + 1;
  // Written through: this is a read-modify-write, and the SQL backend's
  // write buffer is not consulted by reads.
  await counts.set(k, next, TTL_SECONDS, true);
  return next;
}

export async function repairCount(
  instanceId: string,
  type: ArrInstance['type'],
  targetId: number
): Promise<number> {
  return (await counts.get(key(instanceId, type, targetId))) ?? 0;
}

/** Something imported and stayed healthy: the item is no longer in trouble. */
export async function clearRepairCount(
  instanceId: string,
  type: ArrInstance['type'],
  targetId: number
): Promise<void> {
  const k = key(instanceId, type, targetId);
  if ((await counts.get(k)) === undefined) return;
  await counts.delete(k);
  logger.debug({ target: k }, 'cleared the repair count for a healthy item');
}
