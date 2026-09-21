import { config } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import { instanceBackbones } from './backbones.js';
import { releaseKeyKind } from './keys.js';

const logger = createLogger('release-blocklist');

/**
 * How widely a `dead` verdict applies:
 * - `backbones`: only where this instance's providers reach. A provider-
 *   verified article miss is gone from our backbones but may live on others.
 * - `global`: everywhere, no scope. A release-intrinsic archive defect
 *   (compressed/solid/unsupported container) can't be byte-range streamed by
 *   anyone on any backbone, so the verdict is recorded unscoped and shared so.
 */
export type BlocklistScope = 'backbones' | 'global';

/**
 * Maps a usenet failure code onto its scope, or null when the code is not
 * shareable evidence
 */
export function blocklistScopeForCode(
  code: string | null | undefined
): BlocklistScope | null {
  switch (code) {
    case 'missing_on_providers':
    case 'article_not_found':
      return 'backbones';
    case 'archive_compressed':
    case 'archive_solid':
    case 'archive_unsupported':
      return 'global';
    default:
      return null;
  }
}

function markDead(
  scope: BlocklistScope,
  keys: Array<string | null | undefined>
): void {
  if (!config.releaseBlocklist.enabled) return;
  const valid = keys.filter(
    (key): key is string => !!key && releaseKeyKind(key) === 'usenet'
  );
  if (valid.length === 0) return;
  const backbones = scope === 'global' ? [] : instanceBackbones();
  logger.info(
    `marking ${valid.join(' + ')} dead ` +
      (scope === 'global'
        ? 'everywhere (release defect)'
        : backbones.length
          ? `on ${backbones.join(', ')}`
          : '(unscoped)')
  );
  for (const key of valid) {
    void ReleaseBlocklistRepository.markVerdict(key, 'dead', backbones).catch(
      (err) => logger.warn(`failed to mark ${key} dead: ${err}`)
    );
  }
}

/**
 * Record local `dead` verdicts for a usenet release under every key it is
 * known by (`wd1:` fingerprint and/or `nh1:` content hash), scoped to this
 * instance's provider backbones.
 */
export function markReleaseDead(
  ...keys: Array<string | null | undefined>
): void {
  markDead('backbones', keys);
}

/**
 * Mark a release dead at whatever scope its failure `code` justifies (see
 * {@link blocklistScopeForCode}), or do nothing when the code is not blocklist
 * evidence. Lets classification sites route by code without duplicating policy.
 */
export function markReleaseDeadForCode(
  code: string | null | undefined,
  ...keys: Array<string | null | undefined>
): void {
  const scope = blocklistScopeForCode(code);
  if (scope) markDead(scope, keys);
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
  if (!config.releaseBlocklist.enabled) return;
  for (const key of keys) {
    if (!key || releaseKeyKind(key) === null) continue;
    void ReleaseBlocklistRepository.retract(key, {
      onlyIfBlocked: true,
    }).catch((err) => logger.warn(`failed to retract ${key}: ${err}`));
  }
}
