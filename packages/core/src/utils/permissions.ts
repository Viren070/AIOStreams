/**
 * Permission names live here rather than in `auth.ts` so `env.ts` can validate
 * against them without importing the config, which would be a cycle.
 */

/**
 * Permissions an operator identity may hold. `admin` is a superset that implies
 * every other permission.
 */
export const Permission = {
  Admin: 'admin',
  Proxy: 'proxy',
  Service: 'service',
  Sabnzbd: 'sabnzbd',
  Webdav: 'webdav',
  CreateConfig: 'createConfig',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: Permission[] = Object.values(Permission);

/** Valid names for the `user=perm|perm` grammar, which also accepts `none`. */
export const PERMISSION_NAMES: readonly string[] = ALL_PERMISSIONS;

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_NAMES.includes(value);
}
