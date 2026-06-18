import { isProbablyObfuscated } from '../index.js';

/**
 * The filename component of an archive-inner path. `name` holds the filename
 * only (the full `path` is carried separately).
 */
export function baseName(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash === -1 ? p : p.slice(slash + 1);
}

/** Strip a trailing media/archive extension from a release/job name. */
export function stripReleaseExt(name: string): string {
  return name.replace(
    /\.(mkv|mp4|avi|ts|m2ts|mov|wmv|flv|rar|7z|zip|nzb)$/i,
    ''
  );
}

/**
 * Strip a trailing `.nzb` from a job/display name. SABnzbd's `name` is the
 * clean job name (the `.nzb` filename is `nzb_name`), so a stored name should
 * never carry the extension; otherwise it shows on the dashboard and doubles
 * up to `.nzb.nzb` in the SABnzbd `nzb_name` field.
 */
export function stripNzbExt(name: string): string {
  return name.replace(/\.nzb$/i, '');
}

/**
 * Display name for an archive inner file. When an archive holds a SINGLE file
 * whose inner name is obfuscated (a random release-group name), show it as the
 * release name + the inner file's real extension instead. The inner `path` (the
 * open selector) is never changed.
 */
export function innerDisplayName(
  innerPath: string,
  innerCount: number,
  releaseName?: string
): string {
  const base = baseName(innerPath);
  if (innerCount === 1 && releaseName && isProbablyObfuscated(base)) {
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot) : '';
    return `${releaseName}${ext}`;
  }
  return base;
}

/**
 * Best-effort NZB password: the `<head><meta type="password">` value, else a
 * `{{password}}` (or `{password}`) token embedded in the release name (a common
 * indexer convention for protected archives).
 */
export function extractNzbPassword(
  meta: Record<string, string> | undefined,
  name?: string
): string | undefined {
  const fromMeta = meta?.password?.trim();
  if (fromMeta) return fromMeta;
  const m = name?.match(/\{\{([^}]+)\}\}/) ?? name?.match(/\{([^}]+)\}/);
  return m?.[1]?.trim() || undefined;
}
