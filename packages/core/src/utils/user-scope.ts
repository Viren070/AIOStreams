import type { UserData } from '../db/schemas.js';
import { getSimpleTextHash } from './crypto.js';

type ScopedUser = Pick<UserData, 'uuid' | 'activeVariants' | 'autoVariants'>;

/**
 * Identity of a configuration instance: the uuid plus any active variants.
 * Per-user cache keys must use this, since two variants of one uuid are
 * different configurations. Account-level concerns (analytics, ownership, rate
 * limiting) stay on the bare uuid.
 *
 * Returns exactly the uuid when no variant is active, so existing keys hold.
 */
export function userScopeKey(user: ScopedUser): string {
  const uuid = user.uuid ?? '';
  const ids = [...(user.activeVariants ?? []), ...(user.autoVariants ?? [])];
  return ids.length ? `${uuid}#${ids.join(',')}` : uuid;
}

/**
 * Discriminator for the Stremio addon id. Without it two variants of one uuid
 * emit the same id and installing one overwrites the other.
 */
export function userScopeIdSuffix(user: ScopedUser): string {
  const base = user.uuid?.substring(0, 12) ?? '';
  if (!user.activeVariants?.length) return base;
  const hash = getSimpleTextHash(user.activeVariants.join(',')).substring(0, 8);
  return `${base}.${hash}`;
}
