import { downloadManager } from '../../utils/download-manager.js';
import { LOCAL_NZB_SCHEME } from './nzb-source.js';

/** Best-effort invalidation for URLs that actually use the remote grab cache. */
export async function invalidateRemoteNzb(
  url: string | undefined
): Promise<boolean> {
  if (!url || url.startsWith(LOCAL_NZB_SCHEME)) return false;
  return downloadManager.invalidateNzb(url).catch(() => false);
}

/** Parse once and evict only the corresponding remote grab on failure. */
export async function parseWithNzbGrabInvalidation<T>(
  url: string | undefined,
  parse: () => Promise<T>
): Promise<T> {
  try {
    return await parse();
  } catch (err) {
    await invalidateRemoteNzb(url);
    throw err;
  }
}
