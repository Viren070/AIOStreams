import { config as appConfig } from '../config/index.js';
import { Cache, createLogger, getSimpleTextHash } from '../utils/index.js';
import {
  UsenetIndexerAttemptsRepository,
  type UsenetAttemptKind,
  type UsenetIndexerAttemptDelta,
} from '../db/index.js';
import { indexerLabelFor } from '../usenet/integration/grab-metrics.js';
import {
  decodeFileInfo,
  decodeStoreAuth,
  type PlaybackTarget,
} from './failover.js';
import type { DebridError } from '../debrid/base.js';
import { isFailoverRetryableError } from './play-chain.js';

const logger = createLogger('attempt-stats');

/** The same outcome for a release isn't recounted within this window. */
const SEEN_TTL_SECONDS = 6 * 60 * 60;
/** Attempts still unsettled this long after the chain ended are dropped. */
const SETTLE_TIMEOUT_MS = 5 * 60_000;

const seen = Cache.getInstance<string, true>(
  'usenet-attempt-seen',
  50_000,
  appConfig.bootstrap.redisUri ? 'redis' : 'memory'
);
/** Keys being recorded right now, so concurrent flushes can't both count one. */
const claimed = new Set<string>();

/** Not the indexer's fault: errors failover won't retry, or no free slot. */
function isAccountError(err: unknown): boolean {
  return (
    !isFailoverRetryableError(err as Error) ||
    (err as DebridError).code === 'TOO_MANY_ACTIVE_CONNECTIONS'
  );
}

/** `aborted`: cut off by the chain before it settled. */
type Settled = 'ok' | 'failed' | 'skipped' | 'aborted';

interface Tracked {
  index: number;
  target: PlaybackTarget;
  signal?: AbortSignal;
  settled: Promise<Settled>;
}

/**
 * Records each usenet attempt of one playback chain into per-indexer rollups.
 * Wrap every resolver with {@link wrap}, then call {@link flush} once.
 */
export class PlayAttemptTracker {
  private readonly tracked: Tracked[] = [];

  wrap(
    index: number,
    target: PlaybackTarget | undefined,
    resolve: (signal?: AbortSignal) => Promise<string | undefined>
  ): (signal?: AbortSignal) => Promise<string | undefined> {
    if (!target) return resolve;
    return (signal) => {
      const p = resolve(signal);
      const settled = p.then(
        // Pending downloads (no URL yet) count once they play.
        (url): Settled =>
          signal?.aborted ? 'aborted' : url ? 'ok' : 'skipped',
        (err): Settled =>
          signal?.aborted
            ? 'aborted'
            : isAccountError(err)
              ? 'skipped'
              : 'failed'
      );
      this.tracked.push({ index, target, signal, settled });
      return p;
    };
  }

  /**
   * Waits for the attempts to settle, then records them. Attempts the chain
   * aborted count as timed out if no URL won, else as losers and are skipped.
   * Never throws.
   */
  async flush(urlWon: boolean): Promise<void> {
    try {
      await this.record(urlWon);
    } catch (err) {
      logger.warn({ err }, 'failed to record usenet attempt stats');
    }
  }

  private async record(urlWon: boolean): Promise<void> {
    if (this.tracked.length === 0) return;
    const endedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<undefined>((r) => {
      timer = setTimeout(() => r(undefined), SETTLE_TIMEOUT_MS);
      timer.unref();
    });
    const outcomes = await Promise.all(
      this.tracked.map((t) => Promise.race([t.settled, timeout]))
    );
    clearTimeout(timer);

    const ordered = this.tracked
      .map((t, i) => ({ ...t, outcome: outcomes[i] }))
      .sort((a, b) => a.index - b.index);

    let earlierFailure = false;
    for (const { index, target, signal, outcome } of ordered) {
      if (!outcome || outcome === 'skipped') continue;
      if (outcome === 'aborted' && urlWon) continue;
      const info = await decodeFileInfo(target.fileInfoRaw);
      if (info?.type !== 'usenet') continue;
      // Library items aren't indexer grabs; Easynews isn't an indexer.
      if (info.serviceItemId || info.easynewsUrl) continue;
      // Undecodable credentials fail before reaching the indexer.
      const auth = decodeStoreAuth(target);
      if (!auth || auth.id === 'easynews') continue;

      const indexer = indexerLabelFor(info.indexer, info.nzb);
      const attempt: UsenetAttemptKind = index === 0 ? 'first' : 'failover';
      const delta: UsenetIndexerAttemptDelta = {
        indexer,
        attempt,
        ageBucket: info.ageBucket ?? 'unknown',
      };
      if (outcome === 'ok') {
        delta.ok = 1;
        // Only the winner is played; the chain aborts every other attempt.
        const won = !signal?.aborted;
        if (won && attempt === 'failover' && earlierFailure) delta.rescues = 1;
      } else {
        delta.failed = 1;
        earlierFailure = true;
      }

      // Per user, service, attempt and outcome: anything different still counts.
      const user = getSimpleTextHash(auth.id + auth.credential);
      const seenKey = `${attempt}:${outcome === 'ok' ? 'ok' : 'failed'}:${user}:${indexer}:${info.hash}`;
      if (claimed.has(seenKey)) continue;
      claimed.add(seenKey);
      try {
        if ((await seen.get(seenKey)) !== undefined) continue;
        await UsenetIndexerAttemptsRepository.record(delta, endedAt);
        await seen.set(seenKey, true, SEEN_TTL_SECONDS);
      } catch (err) {
        logger.warn({ err, indexer }, 'failed to record usenet attempt');
      } finally {
        claimed.delete(seenKey);
      }
    }
  }
}
