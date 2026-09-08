import { createLogger } from '../logging/logger.js';
import { appConfig } from '../utils/index.js';
import {
  QUEUE_CLEANUP_RULES,
  type QueueCleanupRuleDef,
} from '../config/schema/arr-rules.js';
import { bumpRepairCount, clearRepairCount } from './breaker.js';
import { arrClients } from './instances.js';
import type { ArrClient, ArrQueueItem } from './client.js';

const logger = createLogger('arr/queue');

/**
 * When Sonarr or Radarr refuse an import (a pack missing an episode, a title
 * they cannot match), the download sits in their queue indefinitely and
 * nothing on our side sees it. This walks the queues of the configured
 * instances, reads the reason the arr gave, and acts on it.
 *
 * Only downloads we handed over are ever touched: another client's queue
 * item may point at paths we know nothing about.
 */

/** How the transport tells us which queue items are its own. */
export interface QueueOwnership {
  /** Whether this download id is one of ours. */
  isOurs(downloadId: string): boolean;
  /**
   * Whether we no longer have a job for it: retired after import, or
   * removed.
   */
  isGone(downloadId: string): Promise<boolean>;
}

export type QueueAction = QueueCleanupRuleDef['action'];

export interface QueueCleanupResult {
  scanned: number;
  acted: number;
  byAction: Partial<Record<QueueAction | 'ghost', number>>;
  /** Our downloads the arr has not flagged, by `status/state`. */
  unflagged: Record<string, number>;
}

/**
 * When each stuck item was first seen, so a warning the arr resolves by
 * itself is never acted on. In memory: forgetting after a restart only costs
 * one more observation.
 */
const firstSeen = new Map<string, number>();

/** Items already reported as matching no rule. */
const unmatched = new Set<string>();

/** Rule definitions by id, merged with the user's enable/action choices. */
function activeRules(): QueueCleanupRuleDef[] {
  const overrides = new Map(
    appConfig.arr.queueCleanup.rules.map((r) => [r.id, r])
  );
  return QUEUE_CLEANUP_RULES.map((rule) => {
    const override = overrides.get(rule.id);
    return override
      ? { ...rule, enabled: override.enabled, action: override.action }
      : rule;
  }).filter((rule) => rule.enabled);
}

/** Everything the arr said about this item. */
function messageLines(item: ArrQueueItem): string[] {
  const parts: string[] = [];
  if (item.errorMessage) parts.push(item.errorMessage);
  for (const status of item.statusMessages ?? []) {
    if (status.title) parts.push(status.title);
    parts.push(...(status.messages ?? []));
  }
  return parts;
}

/** The same, lowercased and joined for matching. */
function messageText(item: ArrQueueItem): string {
  return messageLines(item).join(' ').toLowerCase();
}

/** Drop tracking for items that have left an instance's queue. */
function forgetGone(
  tracker: { keys(): Iterable<string>; delete(key: string): boolean },
  prefix: string,
  live: Set<string>
): void {
  for (const key of [...tracker.keys()]) {
    if (key.startsWith(prefix) && !live.has(key)) tracker.delete(key);
  }
}

/** The movie/episode a queue item is for, for the per-item repair ceiling. */
function targetOf(
  item: ArrQueueItem,
  type: ArrClient['type']
): number | undefined {
  return type === 'radarr' ? item.movieId : (item.episodeId ?? item.seriesId);
}

/**
 * An item is only a candidate once the arr itself has flagged it; this is
 * what keeps the pass away from healthy traffic.
 */
function isFlagged(item: ArrQueueItem): boolean {
  const status = (item.trackedDownloadStatus ?? '').toLowerCase();
  return status === 'warning' || status === 'error';
}

/**
 * Act on one download. `rows` are the arr's queue rows for it (a pack shows
 * one per episode, all carrying the same status); deleting any one of them
 * removes the whole download, so the delete happens once.
 */
async function act(
  client: ArrClient,
  rows: ArrQueueItem[],
  rule: QueueCleanupRuleDef
): Promise<void> {
  const item = rows[0];
  const { action, id: reason } = rule;
  if (action === 'import') {
    const imported = await client.manualImport(
      item.downloadId ?? '',
      rule.phrase
    );
    logger.info(
      { instance: client.label, title: item.title, reason, files: imported },
      imported > 0
        ? 'pushed a stuck import through manually'
        : 'nothing importable in a stuck item; left it alone'
    );
    return;
  }

  let blocklist = action !== 'remove';
  let skipRedownload = action !== 'blocklist_search';

  // Past the per-item ceiling, give up: unmonitor instead of searching again.
  if (blocklist) {
    const ceiling = appConfig.arr.maxRepairsPerItem;
    const gaveUp: number[] = [];
    for (const row of rows) {
      const targetId = targetOf(row, client.type);
      if (ceiling <= 0 || targetId === undefined) continue;
      const count = await bumpRepairCount(client.id, client.type, targetId);
      if (count >= ceiling) gaveUp.push(targetId);
    }
    if (gaveUp.length > 0) {
      skipRedownload = true;
      await client
        .setMonitored(
          client.type === 'radarr'
            ? { movieId: gaveUp[0] }
            : { episodeIds: gaveUp },
          false
        )
        .catch((err) =>
          logger.warn(
            { instance: client.label, err: (err as Error)?.message },
            'could not unmonitor an item we gave up on'
          )
        );
      logger.warn(
        { instance: client.label, title: item.title, targets: gaveUp.length },
        'gave up on this item: too many failed imports in a row'
      );
    }
  }

  await client.deleteQueueItem(item.id, {
    removeFromClient: true,
    blocklist,
    skipRedownload,
  });
  logger.info(
    {
      instance: client.label,
      title: item.title,
      rows: rows.length,
      action,
      reason,
    },
    'cleaned up a stuck queue item'
  );
}

async function cleanupInstance(
  client: ArrClient,
  ownership: QueueOwnership,
  rules: QueueCleanupRuleDef[],
  result: QueueCleanupResult
): Promise<void> {
  const graceMs = appConfig.arr.queueCleanup.graceMinutes * 60_000;
  const items = await client.queue();
  const now = Date.now();

  const downloads = new Map<string, ArrQueueItem[]>();
  for (const item of items) {
    const downloadId = item.downloadId;
    if (!downloadId || !ownership.isOurs(downloadId)) continue;
    result.scanned++;
    const rows = downloads.get(downloadId);
    if (rows) rows.push(item);
    else downloads.set(downloadId, [item]);
  }

  for (const [downloadId, rows] of downloads) {
    const item = rows[0];
    const key = `${client.id}:${downloadId}`;
    const seen = firstSeen.get(key);

    // A download we no longer have. Not a bad release, so never blocklisted,
    // but it needs its own observation window: the row retires the moment the
    // arr takes the last file, while its queue item is still finishing.
    const gone = await ownership.isGone(downloadId);
    if (gone && !isFlagged(item)) {
      if (seen === undefined) {
        firstSeen.set(key, now);
        continue;
      }
      if (now - seen < graceMs) continue;
      for (const row of rows) {
        const targetId = targetOf(row, client.type);
        if (targetId !== undefined) {
          await clearRepairCount(client.id, client.type, targetId);
        }
      }
      await client.deleteQueueItem(item.id, {
        removeFromClient: true,
        blocklist: false,
        skipRedownload: true,
      });
      firstSeen.delete(key);
      result.acted++;
      result.byAction.ghost = (result.byAction.ghost ?? 0) + 1;
      logger.info(
        { instance: client.label, title: item.title },
        'removed a queue entry for a download that is already done with'
      );
      continue;
    }

    if (!isFlagged(item)) {
      firstSeen.delete(key);
      unmatched.delete(key);
      const shape = `${item.trackedDownloadStatus}/${item.trackedDownloadState}`;
      result.unflagged[shape] = (result.unflagged[shape] ?? 0) + 1;
      continue;
    }

    const text = messageText(item);
    const rule = rules.find((r) => text.includes(r.phrase));
    if (!rule) {
      firstSeen.delete(key);
      if (!unmatched.has(key)) {
        unmatched.add(key);
        logger.info(
          {
            instance: client.label,
            title: item.title,
            state: item.trackedDownloadState,
            messages: messageLines(item),
          },
          'a stuck queue item matched no cleanup rule; leaving it alone'
        );
      }
      continue;
    }
    unmatched.delete(key);

    if (graceMs > 0) {
      if (seen === undefined) {
        firstSeen.set(key, now);
        logger.debug(
          {
            instance: client.label,
            title: item.title,
            rule: rule.id,
            rows: rows.length,
            status: item.trackedDownloadStatus,
            state: item.trackedDownloadState,
          },
          'saw a stuck queue item; waiting out the grace period'
        );
        continue;
      }
      if (now - seen < graceMs) continue;
    }

    await act(client, rows, rule);
    firstSeen.delete(key);
    result.acted++;
    result.byAction[rule.action] = (result.byAction[rule.action] ?? 0) + 1;
  }

  const live = new Set([...downloads.keys()].map((d) => `${client.id}:${d}`));
  forgetGone(firstSeen, `${client.id}:`, live);
  forgetGone(unmatched, `${client.id}:`, live);
}

/** One pass over every enabled instance's queue. */
export async function runArrQueueCleanup(ownership: QueueOwnership): Promise<{
  ok: boolean;
  message: string;
  result?: QueueCleanupResult;
}> {
  if (!appConfig.arr.queueCleanup.enabled) {
    return { ok: true, message: 'disabled' };
  }
  const clients = arrClients();
  if (clients.length === 0) {
    return { ok: true, message: 'no Sonarr/Radarr instances configured' };
  }
  const rules = activeRules();
  const result: QueueCleanupResult = {
    scanned: 0,
    acted: 0,
    byAction: {},
    unflagged: {},
  };

  for (const client of clients) {
    try {
      await cleanupInstance(client, ownership, rules, result);
    } catch (err) {
      logger.warn(
        { instance: client.label, err: (err as Error)?.message },
        'queue cleanup failed for an instance'
      );
    }
  }

  const detail = Object.entries(result.byAction)
    .map(([action, n]) => `${action} ${n}`)
    .join(', ');
  logger.debug(
    { instances: clients.length, ...result },
    'queue cleanup pass finished'
  );
  return {
    ok: true,
    message:
      `scanned ${result.scanned}, acted on ${result.acted}` +
      (detail ? ` (${detail})` : ''),
    result,
  };
}
