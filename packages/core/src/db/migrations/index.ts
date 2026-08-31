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
import { usenetLibraryAliases } from './0012_usenet_library_aliases.js';
import { releaseBlocklist } from './0013_release_blocklist.js';
import { releaseBlocklistPublish } from './0014_release_blocklist_publish.js';
import { usenetLatency } from './0015_usenet_latency.js';
import { usenetIndexerMetrics } from './0016_usenet_indexer_metrics.js';
import { streamSessions } from './0017_stream_sessions.js';
import { taskState } from './0018_task_state.js';
import { configProfiles } from './0019_config_profiles.js';
import { animeDatabase } from './0020_anime_database.js';
import { analyticsIndexes } from './0021_analytics_indexes.js';
import { animeBuildSources } from './0022_anime_build_sources.js';
import { linkedAccounts } from './0023_linked_accounts.js';
import { community } from './0024_community.js';
import { configSessions } from './0025_config_sessions.js';
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
  usenetLibraryAliases,
  releaseBlocklist,
  releaseBlocklistPublish,
  usenetLatency,
  usenetIndexerMetrics,
  streamSessions,
  taskState,
  configProfiles,
  animeDatabase,
  analyticsIndexes,
  animeBuildSources,
  linkedAccounts,
  community,
  configSessions,
];

export type { Migration } from './types.js';
