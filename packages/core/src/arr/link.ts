import { createLogger } from '../logging/logger.js';
import { ArrClient, bestEffort, parentIdOf } from './client.js';
import { arrClients, arrClientsFor } from './instances.js';
import type { ArrLink } from './types.js';

const logger = createLogger('arr');

/**
 * A download we handed to an arr, as far as this side is concerned: the id we
 * reported it under, and the store the provenance lives in. Keeps the arr
 * code free of any one transport's schema.
 */
export interface ArrLinkedDownload {
  /** The id reported to the download client (our `nzo_id`). */
  downloadId: string;
  category?: string;
  link?: ArrLink;
  saveLink(link: ArrLink | null): Promise<void>;
}

/**
 * Find which arr grabbed a download and remember it, so a later repair knows
 * whom to tell. Cheap and idempotent: the first instance whose history has a
 * `grabbed` record for our download id wins.
 */
export async function linkArrProvenance(
  download: ArrLinkedDownload
): Promise<ArrLink | undefined> {
  const clients = arrClientsFor(download.category);
  for (const client of clients) {
    let records;
    try {
      records = await client.history(download.downloadId);
    } catch (err) {
      logger.debug(
        { instance: client.label, err: (err as Error)?.message },
        'arr history lookup failed'
      );
      continue;
    }
    const grab = records.find((r) => r.eventType === 'grabbed');
    if (!grab) continue;
    const imported = records.filter(
      (r) => r.eventType === 'downloadFolderImported'
    );
    const link: ArrLink = {
      instanceId: client.id,
      downloadId: download.downloadId,
      grabId: grab.id,
      parentId: parentIdOf(grab, client.type),
      linkedAt: Date.now(),
      importedAt: imported.length
        ? Date.parse(imported[imported.length - 1].date ?? '') || undefined
        : undefined,
      importedPaths: imported
        .map((r) => r.data?.importedPath)
        .filter((p): p is string => !!p),
      repair: download.link?.repair,
    };
    await download.saveLink(link);
    logger.debug(
      { instance: client.label, downloadId: download.downloadId },
      'linked download to an arr'
    );
    return link;
  }
  return undefined;
}

/**
 * Tell every arr to poll its download clients now, so an import that just
 * became available is picked up in seconds instead of on the next poll.
 */
export async function nudgeArrs(category?: string): Promise<void> {
  const clients = arrClientsFor(category);
  await Promise.all(
    clients.map((c) =>
      bestEffort(`${c.label} refresh`, () => c.refreshMonitoredDownloads())
    )
  );
}

/** The client a link points at, if it is still configured. */
export function clientForLink(link: ArrLink): ArrClient | undefined {
  return arrClients().find((c) => c.id === link.instanceId);
}
