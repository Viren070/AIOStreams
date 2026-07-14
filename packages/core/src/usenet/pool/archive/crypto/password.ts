/**
 * Length bounds for archive passwords, shared by the RAR and 7z KDFs.
 */

/**
 * unrar cuts every password to 127 characters before deriving keys, for all RAR
 * versions.
 */
export const RAR_MAX_PASSWORD = 127;

/** Upper bound for any archive password; matches unrar's own MAXPASSWORD. */
export const MAX_ARCHIVE_PASSWORD = 512;

/** Apply RAR's key-derivation truncation to a password. */
export function rarPassword(password: string): string {
  return password.length > RAR_MAX_PASSWORD
    ? password.slice(0, RAR_MAX_PASSWORD)
    : password;
}
