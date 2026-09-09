import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { makeRequest } from '../../utils/http.js';
import {
  PlaybackHandoffRepository,
  type DeliveryRow,
} from '../../db/repositories/playback-handoff.js';

const logger = createLogger('playback-handoff');

/** Beyond the list, the row is given up on. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

const REQUEST_TIMEOUT_MS = 15_000;

const BATCH = 100;

/** Permanent failures in a row before an addon stops receiving new events. */
const FAILURES_BEFORE_DISABLE = 20;

/**
 * How long an unhealthy sink is left alone between attempts. Nothing tells us
 * when a user reconnects an addon at its own end, so it has to be retried.
 */
export const SINK_PROBE_MS = 3_600_000;

type Outcome =
  | { kind: 'delivered' }
  | { kind: 'retry'; error: string; retryAfterMs?: number }
  | { kind: 'permanent'; error: string }
  | { kind: 'reauth'; error: string };

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function deliverOne(row: DeliveryRow): Promise<Outcome> {
  let res: Response;
  try {
    res = await makeRequest(row.url, {
      method: 'POST',
      body: row.body,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      // Server-initiated and repeated by design, so the recursion guard does
      // not apply.
      ignoreRecursion: true,
    });
  } catch (error) {
    return {
      kind: 'retry',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (res.ok) return { kind: 'delivered' };
  if (res.status === 401 || res.status === 403)
    return { kind: 'reauth', error: `HTTP ${res.status}` };
  if (res.status === 429 || res.status >= 500)
    return {
      kind: 'retry',
      error: `HTTP ${res.status}`,
      retryAfterMs: retryAfterMs(res.headers.get('retry-after')),
    };
  return { kind: 'permanent', error: `HTTP ${res.status}` };
}

/** Runs on one replica, so claiming is a plain read. */
export async function deliverPlaybackEvents(): Promise<{
  delivered: number;
  failed: number;
  retried: number;
}> {
  const now = Date.now();
  const rows = await PlaybackHandoffRepository.claimDue(
    now,
    BATCH,
    now - SINK_PROBE_MS
  );
  let delivered = 0;
  let failed = 0;
  let retried = 0;
  if (!rows.length) return { delivered, failed, retried };

  // One in-flight request per sink, so a stop never overtakes its start.
  const bySink = new Map<string, DeliveryRow[]>();
  for (const row of rows) {
    const list = bySink.get(row.sinkId);
    if (list) list.push(row);
    else bySink.set(row.sinkId, [row]);
  }

  await Promise.all(
    [...bySink.entries()].map(async ([sinkId, sinkRows]) => {
      for (const row of sinkRows) {
        const outcome = await deliverOne(row);
        const at = Date.now();
        if (outcome.kind === 'delivered') {
          await PlaybackHandoffRepository.markDelivered(row.id, at);
          await PlaybackHandoffRepository.markSinkHealthy(sinkId, at);
          delivered++;
          continue;
        }
        if (outcome.kind === 'reauth') {
          await PlaybackHandoffRepository.setSinkStatus(
            sinkId,
            'auth_expired',
            {
              error: outcome.error,
              errorKind: 'reauth',
            }
          );
          logger.warn(
            { sinkId, err: outcome.error },
            'addon rejected playback reporting, waiting for the user to reconnect'
          );
          // The row stays pending: reconnecting should deliver the backlog.
          return;
        }

        const attempts = row.attempts + 1;
        if (
          outcome.kind === 'retry' &&
          attempts < appConfig.watchState.deliveryMaxAttempts
        ) {
          const backoff =
            BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)];
          await PlaybackHandoffRepository.markRetry(
            row.id,
            at + Math.max(backoff, outcome.retryAfterMs ?? 0),
            outcome.error
          );
          retried++;
          // Later rows for this sink are due again on the next run, in order.
          return;
        }

        await PlaybackHandoffRepository.markFailed(row.id, outcome.error);
        failed++;
        const failures =
          await PlaybackHandoffRepository.bumpSinkFailures(sinkId);
        if (failures >= FAILURES_BEFORE_DISABLE) {
          await PlaybackHandoffRepository.setSinkStatus(sinkId, 'error', {
            error: outcome.error,
            errorKind: outcome.kind,
          });
          logger.warn(
            { sinkId, failures },
            'addon keeps rejecting playback events, no longer queueing for it'
          );
          return;
        }
      }
    })
  );

  if (delivered || failed || retried)
    logger.debug({ delivered, failed, retried }, 'playback deliveries run');
  return { delivered, failed, retried };
}
