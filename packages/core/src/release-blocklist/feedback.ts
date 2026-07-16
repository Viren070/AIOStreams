import { createLogger } from '../logging/logger.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import { instanceBackbones } from './backbones.js';
import { releaseKeyKind } from './keys.js';

const logger = createLogger('release-blocklist');

/**
 * Record local `dead` verdicts for a usenet release under every key it is
 * known by (`wd1:` fingerprint and/or `nh1:` content hash). Callers must
 * only invoke this on all-provider article-miss evidence. Fire-and-forget;
 * missing or non-usenet keys are skipped.
 */
export function markReleaseDead(
  ...keys: Array<string | null | undefined>
): void {
  const valid = keys.filter(
    (key): key is string => !!key && releaseKeyKind(key) === 'usenet'
  );
  if (valid.length === 0) return;
  const backbones = instanceBackbones();
  logger.info(
    `marking ${valid.join(' + ')} dead` +
      (backbones.length ? ` on ${backbones.join(', ')}` : ' (unscoped)')
  );
  for (const key of valid) {
    void ReleaseBlocklistRepository.markVerdict(key, 'dead', backbones).catch(
      (err) => logger.warn(`failed to mark ${key} dead: ${err}`)
    );
  }
}

/**
 * The release was proven working: drop any local verdicts and suppress
 * remote ones, under every key it is known by. Only keys a remote source
 * actually flags get an override. Fire-and-forget; missing or invalid keys
 * are skipped.
 */
export function retractRelease(
  ...keys: Array<string | null | undefined>
): void {
  for (const key of keys) {
    if (!key || releaseKeyKind(key) === null) continue;
    void ReleaseBlocklistRepository.retract(key, {
      onlyIfBlocked: true,
    }).catch((err) => logger.warn(`failed to retract ${key}: ${err}`));
  }
}
