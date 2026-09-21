import { createLogger } from '../../logging/logger.js';
import {
  UsenetLibraryRepository,
  type UsenetLibraryEntry,
} from '../../db/index.js';
import {
  arrConfigured,
  beginRepairPass,
  linkArrProvenance,
  nudgeArrs,
  pendingRepair,
  repairArrDownload,
  runArrQueueCleanup,
  type ArrLink,
  type ArrLinkedDownload,
  type ArrRepair,
  type RepairOutcome,
} from '../../arr/index.js';
import { appConfig } from '../../utils/index.js';
import { NZO_PREFIX, hashFromNzoId, nzoIdFor } from './sabnzbd-ids.js';

const logger = createLogger('usenet/arr');

/** Adapt a usenet library row to the transport-agnostic arr integration. */
function asDownload(entry: UsenetLibraryEntry): ArrLinkedDownload {
  return {
    downloadId: nzoIdFor(entry.nzbHash),
    category: entry.category,
    link: entry.arrLink,
    saveLink: (link) => UsenetLibraryRepository.setArrLink(entry.nzbHash, link),
  };
}

/**
 * A download-client row just became importable: work out which arr grabbed it
 * (so a later repair can find its way back) and ask the arrs to poll now.
 * Fire-and-forget; the arr's own polling is the fallback for both.
 */
export function onArrDownloadReady(entry: UsenetLibraryEntry): void {
  if (entry.origin !== 'sabnzbd' || !arrConfigured()) return;
  void (async () => {
    await linkArrProvenance(asDownload(entry));
    await nudgeArrs(entry.category);
  })().catch((err) =>
    logger.debug(
      { nzbHash: entry.nzbHash, err: (err as Error)?.message },
      'arr hand-off failed'
    )
  );
}

/** Queue a repair for a row the recheck condemned. */
export async function enqueueArrRepair(
  entry: UsenetLibraryEntry,
  reason: ArrRepair['reason']
): Promise<void> {
  if (entry.origin !== 'sabnzbd' || !arrConfigured()) return;
  const link: ArrLink | undefined = entry.arrLink;
  if (link?.repair?.state === 'done') return;
  await UsenetLibraryRepository.setArrLink(entry.nzbHash, {
    ...(link ?? {
      instanceId: '',
      downloadId: nzoIdFor(entry.nzbHash),
      linkedAt: Date.now(),
    }),
    repair: pendingRepair(reason),
  });
  logger.info(
    { nzbHash: entry.nzbHash, name: entry.name, reason },
    'queued an arr replacement for a dead release'
  );
}

/**
 * A verdict outside the recheck just condemned a row (serve-path failure,
 * census shadow): queue and run the repair now, then ask the arrs to poll.
 * Recheck never revisits `failed` rows, so the moment of condemnation is the
 * only chance to tell the arr. Fire-and-forget; every step is idempotent.
 */
export function condemnArrDownload(
  nzbHash: string,
  reason: ArrRepair['reason']
): void {
  void (async () => {
    const entry = await UsenetLibraryRepository.get(nzbHash);
    if (!entry || entry.origin !== 'sabnzbd') return;
    await enqueueArrRepair(entry, reason);
    await processArrRepairs();
    await nudgeArrs(entry.category);
  })().catch((err) =>
    logger.debug(
      { nzbHash, err: (err as Error)?.message },
      'arr condemnation hand-off failed'
    )
  );
}

/**
 * Work through queued repairs. Runs at the end of a recheck pass and from the
 * dashboard's "retry repair"; each one is idempotent, so a partial pass simply
 * resumes next time.
 */
export async function processArrRepairs(
  opts: { limit?: number } = {}
): Promise<{
  processed: number;
  repaired: number;
}> {
  if (!arrConfigured()) return { processed: 0, repaired: 0 };
  // Detect-only: entries are still marked failed and shown in the library,
  // the arr is simply left alone. The manual retry ignores this.
  if (!appConfig.arr.autoRepair) return { processed: 0, repaired: 0 };
  const pending = await UsenetLibraryRepository.listPendingArrRepairs(
    opts.limit ?? 50
  );
  beginRepairPass();
  let repaired = 0;
  for (const entry of pending) {
    const { outcome } = await repairArrDownload(asDownload(entry));
    if (outcome === 'repaired') repaired++;
    // A row the arr has finished with is no longer a download it is waiting
    // on; hide it so the client's queue and history stay clean.
    if (outcome === 'repaired' || outcome === 'already-handled') {
      await UsenetLibraryRepository.setHidden(entry.nzbHash, true);
    }
  }
  return { processed: pending.length, repaired };
}

/**
 * Clean up queue items the arrs could not import. The usenet side only has to
 * say which download ids are its own and which of them it has finished with;
 * everything else about the pass is transport-agnostic.
 */
export async function runUsenetArrQueueCleanup(): Promise<{
  ok: boolean;
  message: string;
}> {
  return runArrQueueCleanup({
    isOurs: (downloadId) => downloadId.startsWith(NZO_PREFIX),
    isGone: async (downloadId) => {
      const hash = hashFromNzoId(downloadId);
      const resolved = await UsenetLibraryRepository.getResolved(hash);
      // Retired (hidden after the arr took it) or gone from the library
      // entirely: either way there is nothing left for the arr to import.
      return !resolved?.entry || !!resolved.entry.hiddenAt;
    },
  });
}

/** Repair one entry now, whatever its schedule says (dashboard action). */
export async function repairArrEntryNow(
  nzbHash: string
): Promise<RepairOutcome> {
  const entry = await UsenetLibraryRepository.get(nzbHash);
  if (!entry) return 'not-linked';
  await UsenetLibraryRepository.setArrLink(nzbHash, {
    ...(entry.arrLink ?? {
      instanceId: '',
      downloadId: nzoIdFor(nzbHash),
      linkedAt: Date.now(),
    }),
    repair: pendingRepair(entry.arrLink?.repair?.reason ?? 'failed'),
  });
  const fresh = await UsenetLibraryRepository.get(nzbHash);
  beginRepairPass();
  const { outcome } = await repairArrDownload(asDownload(fresh!));
  if (outcome === 'repaired' || outcome === 'already-handled') {
    await UsenetLibraryRepository.setHidden(nzbHash, true);
  }
  return outcome;
}
