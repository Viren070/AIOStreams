import { ScreenerStore } from '../db/repositories/screener.js';
import { config } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { myBackbones } from './backbones.js';
import { streamReleaseKey, type KeyableStream } from './stream-key.js';
import type { ScreenerEvalOptions, ScreenerVerdict } from './types.js';
import type { ScreenerOptions } from '../debrid/base.js';

const logger = createLogger('screener');

const DEFAULT_QUORUM = 2;

/** Per-user Screener knobs (from UserData); the shared debrid-layer contract. */
export type ScreenerUserOptions = ScreenerOptions;

type FilterableStream = KeyableStream & { id: string };

/**
 * Drop streams whose release was flagged (dead/fake/mislabeled) by Screener,
 * evaluated against the user's quorum/backbone settings. Runs before dedup so a
 * flagged candidate never becomes a failover attempt.
 *
 * Default-on: filters unless the user explicitly disabled it. Never leaves the
 * user with nothing, if every stream is flagged, all are shown as a last resort
 * (mirroring nzbdavex). Returns the input array unchanged when nothing is
 * dropped, so callers can cheaply detect a no-op.
 */
export async function applyScreener<T extends FilterableStream>(
  streams: T[],
  opts: ScreenerUserOptions | undefined,
  ownBackbones: string[],
  onRemoved?: (stream: T, verdict: ScreenerVerdict) => void
): Promise<T[]> {
  if (opts?.enabled === false || streams.length === 0) return streams;
  try {
    if (!(await ScreenerStore.hasEntries())) return streams;
  } catch (err) {
    // Fail open: a store hiccup must never reject the request.
    logger.debug(`screener presence check failed, passing through: ${err}`);
    return streams;
  }

  // Key by the stream object itself, not stream.id: ids can repeat across
  // streams and an id-keyed map would judge one against another's verdict.
  const keyByStream = new Map<T, string>();
  for (const s of streams) {
    const key = streamReleaseKey(s);
    if (key) keyByStream.set(s, key);
  }
  if (keyByStream.size === 0) return streams;

  const evalOpts: ScreenerEvalOptions = {
    quorum: opts?.quorum ?? DEFAULT_QUORUM,
    backboneScope: config.screener.backboneScope,
    myBackbones: ownBackbones,
    trustedBackbones: config.screener.trustedBackbones,
  };

  let verdicts: Map<string, ScreenerVerdict>;
  try {
    verdicts = await ScreenerStore.evaluateKeys(
      [...new Set(keyByStream.values())],
      evalOpts
    );
  } catch (err) {
    logger.debug(`screener evaluate failed, passing streams through: ${err}`);
    return streams;
  }

  const kept: T[] = [];
  const removed: Array<{ stream: T; verdict: ScreenerVerdict }> = [];
  for (const s of streams) {
    const key = keyByStream.get(s);
    const verdict = key ? verdicts.get(key) : undefined;
    if (verdict?.filtered) {
      removed.push({ stream: s, verdict });
      continue;
    }
    kept.push(s);
  }

  if (removed.length === 0) return streams;
  if (kept.length === 0) {
    // Never leave the user with nothing, show all as a last resort, and don't
    // record the skips since nothing was actually removed.
    logger.warn(
      `Screener flagged all ${streams.length} stream(s); showing anyway (last resort)`
    );
    return streams;
  }
  for (const r of removed) onRemoved?.(r.stream, r.verdict);
  logger.info(
    `Screener removed ${removed.length} flagged release(s); ${kept.length} remain`
  );
  return kept;
}

/**
 * Would Screener filter this single release for a viewer with these
 * options? The resolve-time counterpart of {@link applyScreener}: same enabled
 * gate and the same {@link ScreenerStore.evaluateKeys} verdict under the
 * viewer's quorum/backbone, so a sibling NZB of an already-flagged release is
 * skipped under the exact rules the stream list used.
 *
 * Fails safe: any error (or no entries / disabled) returns false, so a store
 * blip never blocks a playable release.
 */
export async function isReleaseScreened(
  key: string,
  opts: ScreenerUserOptions | undefined
): Promise<boolean> {
  if (opts?.enabled === false) return false;
  try {
    if (!(await ScreenerStore.hasEntries())) return false;
    const evalOpts: ScreenerEvalOptions = {
      quorum: opts?.quorum ?? DEFAULT_QUORUM,
      backboneScope: config.screener.backboneScope,
      myBackbones: myBackbones(),
      trustedBackbones: config.screener.trustedBackbones,
    };
    const verdicts = await ScreenerStore.evaluateKeys([key], evalOpts);
    return verdicts.get(key)?.filtered ?? false;
  } catch (err) {
    logger.debug(`screener resolve-check failed, not skipping: ${err}`);
    return false;
  }
}
