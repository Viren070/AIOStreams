import { baseline } from './0001_baseline.js';
import { settings } from './0002_settings.js';
import { analytics } from './0003_analytics.js';
import { userIndexes } from './0004_user_indexes.js';
import { analyticsV2 } from './0005_analytics_v2.js';
import { analyticsIp } from './0006_analytics_ip.js';
import { usenet } from './0007_usenet.js';
import { usenetMetrics } from './0008_usenet_metrics.js';
import { usenetLibraryExt } from './0009_usenet_library_ext.js';
import { usenetLibraryPassword } from './0010_usenet_library_password.js';
import { usenetSpeed } from './0011_usenet_speed.js';
import type { Migration } from './types.js';

export const MIGRATIONS: readonly Migration[] = [
  baseline,
  settings,
  analytics,
  userIndexes,
  analyticsV2,
  analyticsIp,
  usenet,
  usenetMetrics,
  usenetLibraryExt,
  usenetLibraryPassword,
  usenetSpeed,
];

export type { Migration } from './types.js';
