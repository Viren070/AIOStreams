import { ScreenerStore } from '../db/repositories/screener.js';
import { createLogger } from '../logging/logger.js';
import { keyKind } from './key.js';
import { myBackbones } from './backbones.js';

const logger = createLogger('screener');

/**
 * Mark a release key dead. Use when the caller already knows the release is
 * gone (e.g. the native usenet engine catching an `ArticleNotFoundError`).
 * Fire-and-forget; no-op for a missing/invalid key.
 */
export function markReleaseDead(key: string | null | undefined): void {
  // Usenet-only path: never let a torrent (btih) key in here.
  if (!key || keyKind(key) !== 'usenet') return;
  logger.debug(`Screener: auto-marking dead release ${key}`);
  void ScreenerStore.markVerdict(key, 'dead', myBackbones()).catch((e) =>
    logger.warn(`Screener auto-mark failed for ${key}: ${e}`)
  );
}
