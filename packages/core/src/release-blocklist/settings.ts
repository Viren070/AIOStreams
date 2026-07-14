import {
  PUBLIC_EXPORT_SETTING_KEYS,
  isPublicExportSettingKey,
} from '../config/schema/release-blocklist.js';
import {
  saveManagedSettings,
  settingEnvLocks,
  type ManagedSettingsPatchResult,
} from '../config/managed.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('release-blocklist');

/** The public export fields, as the publishing page names them. */
export type PublicExportLeaf =
  | 'publicExport'
  | 'publicExportScope'
  | 'publicExportPassword';

const dottedKey = (leaf: PublicExportLeaf) =>
  `releaseBlocklist.${leaf}` as const;

/** For each field, the env var pinning it, or `null` when it is editable. */
export function publicExportEnvLocks(): Record<
  PublicExportLeaf,
  string | null
> {
  const locks = settingEnvLocks(PUBLIC_EXPORT_SETTING_KEYS);
  return {
    publicExport: locks['releaseBlocklist.publicExport'],
    publicExportScope: locks['releaseBlocklist.publicExportScope'],
    publicExportPassword: locks['releaseBlocklist.publicExportPassword'],
  };
}

/** Persist public export fields edited on the publishing page. */
export async function savePublicExportSettings(
  patch: Partial<Record<PublicExportLeaf, unknown>>,
  username: string
): Promise<ManagedSettingsPatchResult> {
  const dotted = Object.fromEntries(
    Object.entries(patch).map(([leaf, value]) => [
      dottedKey(leaf as PublicExportLeaf),
      value,
    ])
  );
  const result = await saveManagedSettings(dotted, {
    isManaged: isPublicExportSettingKey,
    username,
    unmanagedMessage: 'Not a public export setting',
  });
  if (result.updated.length) {
    logger.info(
      { updated: result.updated, username },
      'public export settings updated'
    );
  }
  return result;
}
