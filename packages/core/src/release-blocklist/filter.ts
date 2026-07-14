import { config } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import { instanceBackbones } from './backbones.js';
import {
  streamReleaseKey,
  type BlocklistKeyableStream,
} from './stream-keys.js';
import type {
  BackboneGateMode,
  BackboneGrouping,
  BlocklistEvalOptions,
  BlocklistEvalResult,
} from './types.js';

const logger = createLogger('release-blocklist');

/** Evaluation options from the operator's runtime settings. */
export function blocklistEvalOptions(): BlocklistEvalOptions {
  const settings = config.releaseBlocklist;
  return {
    quorum: settings.quorum,
    gateMode: settings.backboneScope as BackboneGateMode,
    grouping: settings.backboneGrouping as BackboneGrouping,
    myBackbones: instanceBackbones(),
    trustedBackbones: settings.trustedBackbones,
  };
}

/**
 * Drop blocklisted streams from a stream list. Fails open on any store
 * error, and shows everything when every stream is flagged so the viewer
 * is never left with an empty list.
 */
export async function applyReleaseBlocklist<T extends BlocklistKeyableStream>(
  streams: T[],
  onRemoved?: (stream: T, verdict: BlocklistEvalResult) => void
): Promise<T[]> {
  if (streams.length === 0) return streams;
  try {
    if (!(await ReleaseBlocklistRepository.hasEntries())) return streams;

    const keys = new Set<string>();
    for (const stream of streams) {
      const key = streamReleaseKey(stream);
      if (key) keys.add(key);
    }
    if (keys.size === 0) return streams;

    const verdicts = await ReleaseBlocklistRepository.evaluateKeys(
      [...keys],
      blocklistEvalOptions()
    );
    if (verdicts.size === 0) return streams;

    const kept: T[] = [];
    const removed: Array<[T, BlocklistEvalResult]> = [];
    for (const stream of streams) {
      const key = streamReleaseKey(stream);
      const verdict = key ? verdicts.get(key) : undefined;
      if (verdict?.filtered) {
        removed.push([stream, verdict]);
      } else {
        kept.push(stream);
      }
    }
    if (removed.length === 0) return streams;
    if (kept.length === 0) {
      logger.warn(
        `every stream (${streams.length}) is blocklisted; showing all as a last resort`
      );
      return streams;
    }
    for (const [stream, verdict] of removed) {
      onRemoved?.(stream, verdict);
    }
    logger.debug(
      `filtered ${removed.length} of ${streams.length} streams via the release blocklist`
    );
    return kept;
  } catch (err) {
    logger.warn(`release blocklist filtering failed open: ${err}`);
    return streams;
  }
}
