import { config } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import { instanceBackbones } from './backbones.js';
import { ReleaseFailuresRepository } from '../db/repositories/release-failures.js';
import { releaseKeyKind } from './keys.js';
import {
  groupDemotionSettings,
  releaseGroupOf,
  titleKeysFor,
  type ReleaseTitle,
} from './group-demotion.js';

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

/**
 * Usenet failure codes that point at the release itself but are not proof
 * on one failure (see {@link SOFT_FAILURE_CODES}). They count per release
 * key, and `releaseBlocklist.repeatFailures` of them mark the release dead.
 */
export const SOFT_FAILURE_CODES: ReadonlySet<string> = new Set([
  // Volumes missing from the post (the NZB lists fewer parts than the set).
  'incomplete_archive',
  // The engine could not read a volume of the set (missing or truncated).
  'archive_incomplete',
  // Articles fetched but not decodable (corrupt or not yEnc) on our providers.
  'unsupported_encoding',
  // Volumes that cannot be ordered into one set (a naming defect of the post).
  'archive_ungrouped',
]);

/** Whether `code` is a soft release defect counted towards a verdict. */
export function isSoftFailureCode(code: string | null | undefined): boolean {
  return !!code && SOFT_FAILURE_CODES.has(code);
}

export type { ReleaseTitle };

/** What is known about the failed or played release besides its keys. */
export interface ReleaseContext {
  filename?: string | null;
  title?: ReleaseTitle | null;
}

type Keys = ReadonlyArray<string | null | undefined>;

function usenetKeys(keys: Keys): string[] {
  return [
    ...new Set(
      keys.filter(
        (key): key is string => !!key && releaseKeyKind(key) === 'usenet'
      )
    ),
  ];
}

async function markDead(scope: BlocklistScope, keys: Keys): Promise<string[]> {
  if (!config.releaseBlocklist.enabled) return [];
  const valid = usenetKeys(keys);
  if (valid.length === 0) return [];
  const backbones = scope === 'global' ? [] : instanceBackbones();
  logger.info(
    `marking ${valid.join(' + ')} dead ` +
      (scope === 'global'
        ? 'everywhere (release defect)'
        : backbones.length
          ? `on ${backbones.join(', ')}`
          : '(unscoped)')
  );
  await Promise.all(
    valid.map((key) =>
      ReleaseBlocklistRepository.markVerdict(key, 'dead', backbones).catch(
        (err) => logger.warn(`failed to mark ${key} dead: ${err}`)
      )
    )
  );
  return valid;
}

/** Count a dead release against its release group for the title. */
async function penaliseGroup(
  valid: string[],
  ctx: ReleaseContext | undefined
): Promise<void> {
  const settings = groupDemotionSettings();
  if (!settings || valid.length === 0) return;
  const group = releaseGroupOf(ctx?.filename);
  const titleKeys = titleKeysFor(ctx?.title);
  if (!group || titleKeys.length === 0) return;
  const releaseId = valid.find((k) => k.startsWith('wd1:')) ?? valid[0]!;
  try {
    await ReleaseFailuresRepository.addGroupPenalty(
      group,
      titleKeys,
      releaseId,
      settings.windowSeconds
    );
  } catch (err) {
    logger.warn(`failed to record a dead release of ${group}: ${err}`);
  }
}

/**
 * A usenet release failed with `code`. Hard codes mark it dead at once (see
 * {@link blocklistScopeForCode}); soft codes ({@link SOFT_FAILURE_CODES})
 * count, and mark it dead on this instance's backbones once
 * `releaseBlocklist.repeatFailures` is reached. Every other code is ignored.
 * A dead release also counts against its release group for the title in
 * `ctx`. Never rejects.
 */
export async function reportReleaseFailure(
  code: string | null | undefined,
  keys: Keys,
  ctx?: ReleaseContext
): Promise<void> {
  try {
    if (!config.releaseBlocklist.enabled) return;
    const scope = blocklistScopeForCode(code);
    if (scope) {
      await penaliseGroup(await markDead(scope, keys), ctx);
      return;
    }
    if (!isSoftFailureCode(code)) return;
    const threshold = config.releaseBlocklist.repeatFailures;
    if (threshold <= 0) return;
    const valid = usenetKeys(keys);
    if (valid.length === 0) return;
    const count = await ReleaseFailuresRepository.recordFailure(valid);
    if (count < threshold) {
      logger.debug(
        `${valid.join(' + ')} failed (${code}), ${count} of ${threshold}`
      );
      return;
    }
    logger.info(
      `${valid.join(' + ')} failed ${count} times (last ${code}), marking dead`
    );
    await penaliseGroup(await markDead('backbones', valid), ctx);
  } catch (err) {
    logger.warn(`failed to record a release failure: ${err}`);
  }
}

/**
 * A usenet release was proven missing on our providers (for example a
 * cached failure re-clicked): mark it dead on our backbones and count it
 * against its release group. Never rejects.
 */
export async function reportReleaseDead(
  keys: Keys,
  ctx?: ReleaseContext
): Promise<void> {
  await reportReleaseFailure('missing_on_providers', keys, ctx);
}

/**
 * The release played: retract its verdicts, reset its soft-failure count
 * and lift the demotion of its release group for the title. Never rejects.
 */
export async function reportReleaseSuccess(
  keys: Keys,
  ctx?: ReleaseContext
): Promise<void> {
  try {
    if (!config.releaseBlocklist.enabled) return;
    const valid = [
      ...new Set(
        keys.filter(
          (key): key is string => !!key && releaseKeyKind(key) !== null
        )
      ),
    ];
    await Promise.all(
      valid.map((key) =>
        ReleaseBlocklistRepository.retract(key, { onlyIfBlocked: true }).catch(
          (err) => logger.warn(`failed to retract ${key}: ${err}`)
        )
      )
    );
    await ReleaseFailuresRepository.clearFailures(valid).catch((err) =>
      logger.warn(`failed to reset failure counts: ${err}`)
    );
    const group = releaseGroupOf(ctx?.filename);
    const titleKeys = titleKeysFor(ctx?.title);
    if (group && titleKeys.length) {
      await ReleaseFailuresRepository.clearGroupPenalties(
        group,
        titleKeys
      ).catch((err) =>
        logger.warn(`failed to lift the demotion of ${group}: ${err}`)
      );
    }
  } catch (err) {
    logger.warn(`failed to record a release success: ${err}`);
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
  void markDead('backbones', keys);
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
  if (scope) void markDead(scope, keys);
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
  void ReleaseFailuresRepository.clearFailures(
    keys.filter((key): key is string => !!key && releaseKeyKind(key) !== null)
  ).catch((err) => logger.warn(`failed to reset failure counts: ${err}`));
}

/**
 * The {@link ReleaseContext} of anything carrying a filename and the
 * requested title's ids, such as a usenet stream token.
 */
export function releaseContextOf(source: {
  filename?: string | null;
  imdbId?: string | null;
  tmdbId?: number | string | null;
  tvdbId?: number | string | null;
  season?: number | string | null;
  episode?: number | string | null;
}): ReleaseContext {
  return {
    filename: source.filename,
    title: {
      imdbId: source.imdbId,
      tmdbId: source.tmdbId,
      tvdbId: source.tvdbId,
      season: source.season,
      episode: source.episode,
    },
  };
}

/** The {@link ReleaseTitle} of playback metadata, when there is any. */
export function releaseTitleOf(
  metadata:
    | {
        imdbId?: string | null;
        tmdbId?: number | null;
        tvdbId?: number | null;
        season?: number;
        episode?: number;
      }
    | null
    | undefined
): ReleaseTitle | undefined {
  if (!metadata) return undefined;
  const { imdbId, tmdbId, tvdbId, season, episode } = metadata;
  return { imdbId, tmdbId, tvdbId, season, episode };
}
