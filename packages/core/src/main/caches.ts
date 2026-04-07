import { Cache, Env } from '../utils/index.js';
import type { MetaPreview } from '../db/schemas.js';

export const shuffleCache = Cache.getInstance<string, MetaPreview[]>('shuffle');

export type MergedCatalogSkipState = {
  sourceSkips: Record<string, number>; // What skip to send to each upstream source
};
export const mergedCatalogCache = Cache.getInstance<
  string,
  MergedCatalogSkipState
>('merged_catalog');

export const precacheCache = Cache.getInstance<string, boolean>(
  'precache',
  undefined,
  Env.REDIS_URI ? 'redis' : 'memory'
);
