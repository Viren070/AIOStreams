/**
 * Which installed entry a manifest belongs to.
 *
 * Identity comes first because a URL is not one. Ours carries an encrypted
 * password minted with a random IV, so every mint produces a different string
 * for the same configuration, and a password change rewrites it outright.
 */

/** A collection entry as a platform hands it back, before we trust any field. */
export interface InstalledAddon {
  transportUrl?: unknown;
  url?: unknown;
  id?: unknown;
  manifest?: { id?: unknown };
  [key: string]: unknown;
}

export interface InstalledMatch {
  /** Entry to update in place, or -1 when this addon is not installed yet. */
  index: number;
  /** The same addon under URLs it has since rotated away from. */
  staleIndices: number[];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Comparison key only, never something to fetch. The query string stays in:
 * platforms that keep it treat it as part of the addon's address.
 */
export function addonUrlKey(url: string): string {
  return url
    .trim()
    .replace(/^stremio:\/\//i, 'https://')
    .replace(/\/manifest\.json$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function addonUrlOf(entry: InstalledAddon): string {
  return str(entry.transportUrl) || str(entry.url);
}

export function addonIdOf(entry: InstalledAddon): string {
  return str(entry.manifest?.id) || str(entry.id);
}

export function matchInstalled(
  entries: readonly InstalledAddon[],
  target: { url: string; manifestId?: string },
  available: (entry: InstalledAddon, index: number) => boolean = () => true
): InstalledMatch {
  const key = addonUrlKey(target.url);
  const id = target.manifestId?.trim();

  const candidates: number[] = [];
  let exact = -1;

  entries.forEach((entry, index) => {
    if (!available(entry, index)) return;
    const sameUrl = addonUrlKey(addonUrlOf(entry)) === key;
    if (!sameUrl && !(id && addonIdOf(entry) === id)) return;
    if (sameUrl && exact < 0) exact = index;
    candidates.push(index);
  });

  // The exact URL wins the slot so an unrotated push stays a plain refresh.
  const index = exact >= 0 ? exact : (candidates[0] ?? -1);
  return { index, staleIndices: candidates.filter((i) => i !== index) };
}
