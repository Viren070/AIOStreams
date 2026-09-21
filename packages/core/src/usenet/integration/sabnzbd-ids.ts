/**
 * The SABnzbd slot id a library row is reported under. Lives apart from the
 * API module so the arr integration can build one without importing it.
 */
export const NZO_PREFIX = 'SABnzbd_nzo_';

export function nzoIdFor(nzbHash: string): string {
  return `${NZO_PREFIX}${nzbHash}`;
}

export function hashFromNzoId(id: string): string {
  return id.startsWith(NZO_PREFIX) ? id.slice(NZO_PREFIX.length) : id;
}
