import { baseline } from './0001_baseline.js';
import { settings } from './0002_settings.js';
import { analytics } from './0003_analytics.js';
import { userIndexes } from './0004_user_indexes.js';
import { analyticsV2 } from './0005_analytics_v2.js';
import type { Migration } from './types.js';

export const MIGRATIONS: readonly Migration[] = [
  baseline,
  settings,
  analytics,
  userIndexes,
  analyticsV2,
];

export type { Migration } from './types.js';
