import { createLogger } from '../logging/logger.js';
import { appConfig } from '../utils/index.js';
import { parentIdOf, repairTargetOf, type ArrHistoryRecord } from './client.js';
import { bumpRepairCount } from './breaker.js';
import {
  clientForLink,
  linkArrProvenance,
  type ArrLinkedDownload,
} from './link.js';
import type { ArrLink, ArrRepair } from './types.js';

const logger = createLogger('arr/repair');

/** Backoff after a failed attempt; past the last one the repair gives up. */
const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

/**
 * Items already searched for in this pass. A dead season pack is one library
 * row per episode, all resolving to the same series; without this the arr
 * would get the same search a dozen times over. Cleared by
 * {@link beginRepairPass}.
 */
const searchedThisPass = new Set<string>();

/** Start a run of repairs; scopes the per-item search dedupe to it. */
export function beginRepairPass(): void {
  searchedThisPass.clear();
}

/** Queue a repair for a download whose release turned out to be gone. */
export function pendingRepair(reason: ArrRepair['reason']): ArrRepair {
  return { state: 'pending', reason, attempts: 0, nextAt: Date.now() };
}

export type RepairOutcome =
  | 'repaired'
  | 'already-handled'
  | 'not-linked'
  | 'deferred'
  | 'failed';

/**
 * Tell the arr its release is dead, so it stops treating the file as good
 * and goes looking again: delete the file records the import produced, mark
 * the grab failed (what makes the arr blocklist the release and, with
 * "Redownload Failed" on, search for a replacement), then optionally search
 * explicitly. Past `arr.maxRepairsPerItem` replacements the item is given up
 * on instead. Every step re-reads the arr's own state first, so running this
 * twice does nothing the second time.
 */
export async function repairArrDownload(
  download: ArrLinkedDownload
): Promise<{ outcome: RepairOutcome; link?: ArrLink }> {
  let link = download.link;
  if (!link) {
    link = await linkArrProvenance(download);
    if (!link) return { outcome: 'not-linked' };
  }
  const repair: ArrRepair = link.repair ?? pendingRepair('failed');
  if (repair.state === 'done') return { outcome: 'already-handled', link };
  if (repair.state === 'failed') return { outcome: 'failed', link };
  if (repair.nextAt > Date.now()) return { outcome: 'deferred', link };

  const client = clientForLink(link);
  if (!client) {
    return {
      outcome: 'not-linked',
      link: await save(download, link, {
        ...repair,
        state: 'failed',
        lastError: 'the arr instance that grabbed this is no longer configured',
      }),
    };
  }

  try {
    const records = await client.history(link.downloadId);
    const grab = records.find((r) => r.eventType === 'grabbed');
    if (!grab) {
      return {
        outcome: 'not-linked',
        link: await save(download, link, {
          ...repair,
          state: 'failed',
          lastError: 'no grab for this download in the arr history',
        }),
      };
    }
    // The arr already knows (someone marked it failed, or we did before).
    const alreadyFailed = records.some((r) => r.eventType === 'downloadFailed');

    let exhausted = false;
    if (!alreadyFailed) {
      await deleteImportedFiles(client, link, records, grab);
      await client.markFailed(grab.id);
      logger.info(
        { instance: client.label, downloadId: link.downloadId },
        'marked the grab failed; the arr will blocklist and replace it'
      );
      exhausted = await countAgainstItem(client, records, link);
    }

    if (!alreadyFailed && !exhausted && appConfig.arr.searchAfterRepair) {
      const parent = parentIdOf(grab, client.type) ?? link.parentId;
      const key = `${client.id}:${parent ?? link.downloadId}`;
      if (!searchedThisPass.has(key)) {
        searchedThisPass.add(key);
        await client.searchFor(grab);
      }
    }
    return {
      outcome: alreadyFailed ? 'already-handled' : 'repaired',
      link: await save(download, link, {
        ...repair,
        state: 'done',
        lastAt: Date.now(),
        lastError: exhausted
          ? `gave up after ${appConfig.arr.maxRepairsPerItem} dead releases for this item; it is now unmonitored`
          : undefined,
        attempts: repair.attempts,
        nextAt: repair.nextAt,
        reason: repair.reason,
      }),
    };
  } catch (err) {
    const attempts = repair.attempts + 1;
    const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    const exhausted = attempts > BACKOFF_MS.length;
    const message = (err as Error)?.message ?? String(err);
    logger.warn(
      { downloadId: link.downloadId, attempts, err: message },
      exhausted ? 'arr repair gave up' : 'arr repair failed; will retry'
    );
    return {
      outcome: exhausted ? 'failed' : 'deferred',
      link: await save(download, link, {
        ...repair,
        state: exhausted ? 'failed' : 'pending',
        attempts,
        lastAt: Date.now(),
        nextAt: Date.now() + backoff,
        lastError: message,
      }),
    };
  }
}

/**
 * Charge this replacement to the movie/episode it was for. At the ceiling
 * the item is unmonitored and no further replacement is searched for.
 * Returns whether we gave up.
 */
async function countAgainstItem(
  client: NonNullable<ReturnType<typeof clientForLink>>,
  records: ArrHistoryRecord[],
  link: ArrLink
): Promise<boolean> {
  const ceiling = appConfig.arr.maxRepairsPerItem;
  if (ceiling <= 0) return false;
  const targetId = repairTargetOf(records, client.type) ?? link.parentId;
  if (targetId === undefined) return false;

  const count = await bumpRepairCount(client.id, client.type, targetId);
  if (count < ceiling) return false;

  const episodeIds = records
    .filter((r) => r.eventType === 'grabbed')
    .map((r) => r.episodeId)
    .filter((id): id is number => id !== undefined);
  await client
    .setMonitored(
      client.type === 'radarr'
        ? { movieId: targetId }
        : { episodeIds: episodeIds.length > 0 ? episodeIds : [targetId] },
      false
    )
    .catch((err) =>
      logger.warn(
        { instance: client.label, err: (err as Error)?.message },
        'could not unmonitor an item we gave up on'
      )
    );
  logger.warn(
    { instance: client.label, targetId, count },
    'gave up replacing this item: every replacement so far has been dead'
  );
  return true;
}

/**
 * Remove the file records the import produced (the media itself is a link
 * into our library). Matched on the path the arr recorded, with the basename
 * as fallback when paths do not line up; no match at all is fine, the file
 * may already be gone or upgraded.
 */
async function deleteImportedFiles(
  client: ReturnType<typeof clientForLink> & object,
  link: ArrLink,
  records: ArrHistoryRecord[],
  grab: ArrHistoryRecord
): Promise<void> {
  const parent = parentIdOf(grab, client.type) ?? link.parentId;
  if (parent === undefined) return;
  const importedPaths = records
    .filter((r) => r.eventType === 'downloadFolderImported')
    .map((r) => r.data?.importedPath)
    .filter((p): p is string => !!p);
  const paths = new Set([...(link.importedPaths ?? []), ...importedPaths]);
  if (paths.size === 0) return;
  const basenames = new Set(
    [...paths].map((p) => p.split(/[\\/]/).pop()?.toLowerCase())
  );
  const files = await client.listFiles(parent);
  for (const file of files) {
    const path = file.path ?? file.relativePath ?? '';
    const base = path.split(/[\\/]/).pop()?.toLowerCase();
    if (!paths.has(path) && !(base && basenames.has(base))) continue;
    await client.deleteFile(file.id);
    logger.info(
      { instance: client.label, file: path },
      'deleted the imported file record for a dead release'
    );
  }
}

async function save(
  download: ArrLinkedDownload,
  link: ArrLink,
  repair: ArrRepair
): Promise<ArrLink> {
  const next: ArrLink = { ...link, repair };
  await download.saveLink(next);
  return next;
}
