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
