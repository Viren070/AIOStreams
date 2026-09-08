export { initDb, getDb, closeDb } from './db.js';
export { UserRepository } from './repositories/users.js';
export {
  AdminUsersRepository,
  type AdminUserListItem,
  type AdminUserDetail,
} from './repositories/admin-users.js';
export {
  SettingsRepository,
  type SettingRow,
} from './repositories/settings.js';
export {
  UsenetLibraryRepository,
  usenetLibraryBus,
  type UsenetLibraryEntry,
  type UsenetLibraryFile,
  type UsenetLibraryStatus,
  type UsenetLibrarySource,
  type UsenetLibraryOrigin,
  type UsenetLibraryStatusGroup,
  type UsenetLibrarySort,
  type UsenetLibrarySortDir,
} from './repositories/usenet-library.js';
export {
  ReleaseBlocklistRepository,
  clampRefreshSeconds,
  MIN_REFRESH_SECONDS,
  MAX_REFRESH_SECONDS,
  type BlocklistAggregatedEntry,
} from './repositories/release-blocklist.js';
export {
  ReleaseBlocklistPublishRepository,
  clampPublishIntervalSeconds,
  MIN_PUBLISH_INTERVAL_SECONDS,
  MAX_PUBLISH_INTERVAL_SECONDS,
  DEFAULT_PUBLISH_INTERVAL_SECONDS,
} from './repositories/release-blocklist-publish.js';
export {
  UsenetMetricsRepository,
  type UsenetMetricDelta,
  type UsenetMetricScope,
  type UsenetProviderRollup,
  type UsenetMetricBucket,
} from './repositories/usenet-metrics.js';
export {
  UsenetIndexerMetricsRepository,
  type UsenetIndexerGrabDelta,
  type UsenetIndexerScope,
  type UsenetIndexerRollup,
  type UsenetIndexerLastError,
} from './repositories/usenet-indexer-metrics.js';
export {
  StreamSessionRepository,
  type StreamTransport,
  type StreamEndReason,
  type StreamSessionRow,
  type StreamSessionUpsert,
  type StreamBandwidthDelta,
  type StreamBandwidthRollup,
  type StreamBandwidthBucket,
  type StreamHistoryQuery,
} from './repositories/stream-sessions.js';
export {
  ConfigProfileRepository,
  resolveConfigAlias,
  MAX_PROFILES_PER_OWNER,
  type ConfigProfile,
  type ConfigAliasTarget,
} from './repositories/config-profiles.js';
export {
  ConfigSessionRepository,
  type ConfigSessionCredentials,
  type IssuedConfigSession,
} from './repositories/config-sessions.js';
export {
  LinkedAccountRepository,
  MAX_LINKED_ACCOUNTS_PER_USER,
} from './repositories/linked-accounts.js';
export {
  CommunityRepository,
  type CommunityItemInsert,
  type CommunityLiveUpdate,
} from './repositories/community.js';
export * from './schemas.js';

export { sql, raw, join, SqlFragment } from './sql.js';
export {
  DbError,
  classifyPgError,
  classifySqliteError,
  type DbErrorKind,
} from './errors.js';
export type {
  DbDriver,
  Dialect,
  ExecResult,
  IntervalUnit,
  Row,
  SqlInput,
} from './driver/types.js';
