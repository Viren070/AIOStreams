import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { makeRequest } from '../../utils/http.js';
import {
  PlaybackHandoffRepository,
  type DeliveryRow,
  type SinkRow,
  type SinkStatus,
} from '../../db/repositories/playback-handoff.js';
import { TaskManager } from '../../tasks/index.js';
import { randomUUID } from 'node:crypto';

const logger = createLogger('playback-handoff');

/** Beyond the list, the row is given up on. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * How long an unhealthy sink is left alone between attempts. Nothing tells us
 * when a user reconnects an addon at its own end, so it has to be retried.
 */
export function sinkProbeMs(): number {
  return appConfig.watchState.sinkProbeMinutes * 60_000;
}

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

/** A pass gets at least this share of the budget however many addons share the run. */
const MIN_SLICE_SHARE = 0.1;

/**
 * One pass over one addon's due events, in order, until they run out or the
 * pass reaches `until`.
 *
 * A `retry` ends the pass rather than skipping ahead: a later event must not
 * overtake the one it follows.
 */
async function deliverSink(
  sink: SinkRow,
  until: number,
  counts: { delivered: number; failed: number; retried: number }
): Promise<{
  notBefore: number;
  status?: SinkStatus;
  failures?: number;
  lastPushAt?: number | null;
  error?: string | null;
  errorKind?: string | null;
  backlog?: boolean;
}> {
  const cfg = appConfig.watchState;
  const probeMs = sinkProbeMs();
  let attempted = false;
  let anyDelivered = false;
  let lastPushAt: number | null = null;
  // Served, so it waits behind addons that have not had a turn yet.
  const served = (backlog: boolean) =>
    attempted
      ? {
          notBefore: Date.now(),
          failures: 0,
          lastPushAt,
          status: 'connected' as SinkStatus,
          backlog,
        }
      : { notBefore: 0 };

  while (Date.now() < until) {
    const rows = await PlaybackHandoffRepository.dueDeliveries(
      sink.id,
      Date.now(),
      cfg.deliveryRowsPerSink
    );

    for (const row of rows) {
      if (Date.now() >= until) return served(true);
      attempted = true;
      const outcome = await deliverOne(row);
      const at = Date.now();

      if (outcome.kind === 'delivered') {
        await PlaybackHandoffRepository.markDelivered(row.id, at);
        counts.delivered++;
        anyDelivered = true;
        lastPushAt = at;
        continue;
      }

      if (outcome.kind === 'reauth') {
        logger.warn(
          { sinkId: sink.id, err: outcome.error },
          'addon rejected playback reporting, waiting for the user to reconnect'
        );
        // The rows stay pending: reconnecting should deliver the backlog.
        return {
          notBefore: at + probeMs,
          status: 'auth_expired',
          error: outcome.error,
          errorKind: 'reauth',
          lastPushAt,
        };
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
        counts.retried++;
        return failedPass(
          sink,
          anyDelivered,
          at,
          probeMs,
          outcome.error,
          outcome.kind,
          lastPushAt
        );
      }

      await PlaybackHandoffRepository.markFailed(row.id, outcome.error);
      counts.failed++;
      if (outcome.kind === 'permanent') continue;
      return failedPass(
        sink,
        anyDelivered,
        at,
        probeMs,
        outcome.error,
        outcome.kind,
        lastPushAt
      );
    }

    if (rows.length < cfg.deliveryRowsPerSink) return served(false);
  }

  return served(true);
}

/**
 * How an addon is treated after a pass it did not complete.
 *
 * Counted per pass, not per event given up on: a timing-out addon retries
 * forever without exhausting any single event's attempts.
 */
function failedPass(
  sink: SinkRow,
  anyDelivered: boolean,
  at: number,
  probeMs: number,
  error: string,
  errorKind: string,
  lastPushAt: number | null
) {
  if (anyDelivered) {
    // It answered for something, so it is up; the pass just ended early.
    return {
      notBefore: at,
      failures: 0,
      lastPushAt,
      status: 'connected' as SinkStatus,
    };
  }
  const failures = sink.consecutiveFailures + 1;
  const disable =
    failures >= appConfig.watchState.deliveryFailuresBeforeDisable;
  if (disable) {
    logger.warn(
      { sinkId: sink.id, failures },
      'addon keeps rejecting playback events, no longer queueing for it'
    );
  }
  return {
    notBefore: at + (disable ? probeMs : sinkBackoffMs(failures)),
    status: disable ? ('error' as SinkStatus) : undefined,
    failures,
    lastPushAt,
    error,
    errorKind,
  };
}

/** Holds a failing addon back without pushing it out of reach of a recovery. */
function sinkBackoffMs(failures: number): number {
  return Math.min(
    BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)],
    600_000
  );
}

export async function deliverPlaybackEvents(): Promise<{
  delivered: number;
  failed: number;
  retried: number;
}> {
  const cfg = appConfig.watchState;
  const counts = { delivered: 0, failed: 0, retried: 0 };
  const now = Date.now();

  await PlaybackHandoffRepository.reconcileDeliveryPointers(now, 200).catch(
    () => 0
  );

  const runToken = `${TaskManager.instanceId}:${randomUUID()}`;
  const budgetMs = cfg.deliveryBudgetSeconds * 1000;
  // A pass stops at the budget, and only a request already in flight runs past it.
  const leaseMs = budgetMs + REQUEST_TIMEOUT_MS + 60_000;
  const deadline = now + budgetMs;
  let claimed = 0;

  // A single claim would cap the addons served per run.
  for (let batch = 0; Date.now() < deadline; batch++) {
    const token = `${runToken}:${batch}`;
    const claimedAt = Date.now();
    const sinks = await PlaybackHandoffRepository.claimDeliverySinks(
      token,
      claimedAt,
      leaseMs,
      cfg.deliveryMaxSinksPerRun
    );
    if (!sinks.length) break;
    claimed += sinks.length;

    const remainingMs = deadline - claimedAt;
    const workers = Math.min(cfg.deliveryConcurrency, sinks.length);
    // Every claimed addon gets a turn: a deep queue cannot spend the whole run.
    const sliceMs = Math.max(
      budgetMs * MIN_SLICE_SHARE,
      (remainingMs * workers) / sinks.length
    );
    let next = 0;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (let i = next++; i < sinks.length; i = next++) {
          const sink = sinks[i];
          const sliceEnd = Date.now() + sliceMs;
          // Released untouched past the budget, so they are due again at once.
          const release =
            Date.now() < deadline
              ? await deliverSink(
                  sink,
                  Math.min(deadline, sliceEnd),
                  counts
                ).catch((error) => {
                  logger.warn(
                    {
                      sinkId: sink.id,
                      err:
                        error instanceof Error ? error.message : String(error),
                    },
                    'playback delivery pass failed'
                  );
                  return { notBefore: Date.now() + 60_000, backlog: false };
                })
              : { notBefore: 0, backlog: false };
          await PlaybackHandoffRepository.releaseDeliverySink(sink.id, token, {
            now: Date.now(),
            claimedAt,
            ...release,
            // A turn cut short by the end of the run is not a backlog.
            backlog: !!release.backlog && sliceEnd < deadline,
          }).catch((error) =>
            logger.warn(
              {
                sinkId: sink.id,
                err: error instanceof Error ? error.message : String(error),
              },
              'failed to release a playback delivery sink'
            )
          );
        }
      })
    );
    if (sinks.length < cfg.deliveryMaxSinksPerRun) break;
  }

  const { delivered, failed, retried } = counts;
  if (delivered || failed || retried)
    logger.debug(
      { delivered, failed, retried, sinks: claimed },
      'playback deliveries run'
    );
  return counts;
}
