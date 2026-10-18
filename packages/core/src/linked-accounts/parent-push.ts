import { config as appConfig } from '../config/index.js';
import { LinkedAccountRepository } from '../db/repositories/linked-accounts.js';
import { userConfigBus } from '../db/repositories/users.js';
import { createLogger } from '../logging/logger.js';
import { LinkedAccountService } from './service.js';
import type { PushResult } from './types.js';

const logger = createLogger('linked-accounts');

/**
 * How far below the saved configuration to look. Deep enough for chains of
 * parents (nested inheritance, MAX_PARENT_CONFIG_DEPTH when merged); where a
 * configuration only inherits from its direct parent, the deeper ones simply
 * build an unchanged manifest and are not pushed.
 */
const MAX_PARENT_DEPTH = 5;

export interface ParentPushDeps {
  enabled(): boolean;
  delayMs(): number;
  maxLinks(): number;
  /** Pause between two links' pushes. */
  spacingMs(): number;
  sleep(ms: number): Promise<void>;
  targets(
    parentUuid: string,
    maxDepth: number,
    limit: number
  ): Promise<Array<{ uuid: string; id: string }>>;
  pushIfChanged(uuid: string, id: string): Promise<PushResult | null>;
}

const defaultDeps: ParentPushDeps = {
  enabled: () => appConfig.linkedAccounts.enabled,
  delayMs: () => appConfig.linkedAccounts.parentPushDelay * 1000,
  maxLinks: () => appConfig.linkedAccounts.parentPushMaxLinks,
  // A push fetches the manifest from this instance's own URL, and the platform
  // then fetches it again, often from the same address. Both count against the
  // manifest rate limit, which knows no exception for the server itself.
  spacingMs: () => {
    const { disabled, stremioManifest } = appConfig.rateLimits;
    if (disabled) return 0;
    return (
      2 *
      Math.ceil((stremioManifest.window * 1000) / stremioManifest.maxRequests)
    );
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  targets: (uuid, depth, limit) =>
    LinkedAccountRepository.listForParentChange(uuid, depth, limit),
  pushIfChanged: (uuid, id) => LinkedAccountService.pushIfChanged(uuid, id),
};

/**
 * Pushes the links of every configuration that inherits from a saved one, for
 * links that opted in. A save waits `delayMs` so a burst of saves is handled
 * once, and all work runs one push at a time, after the save has answered.
 * Only a changed manifest reaches the platform, so pushing a link twice is
 * harmless.
 */
export class ParentChangePusher {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ParentPushDeps = defaultDeps) {}

  saved(parentUuid: string): void {
    if (!this.deps.enabled()) return;
    clearTimeout(this.timers.get(parentUuid));
    const timer = setTimeout(() => {
      this.timers.delete(parentUuid);
      // Caught so one failure cannot leave the chain rejected, which would
      // skip every later run.
      this.queue = this.queue
        .then(() => this.run(parentUuid))
        .catch((error) =>
          logger.error(
            { parent: parentUuid, error: String(error) },
            'push after a parent change failed'
          )
        );
    }, this.deps.delayMs());
    timer.unref?.();
    this.timers.set(parentUuid, timer);
  }

  /** Resolves once the work queued so far is done. */
  idle(): Promise<void> {
    return this.queue;
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private async run(parentUuid: string): Promise<void> {
    const max = this.deps.maxLinks();
    let targets: Array<{ uuid: string; id: string }>;
    try {
      // One more than allowed, to tell a full run from a capped one.
      targets = await this.deps.targets(parentUuid, MAX_PARENT_DEPTH, max + 1);
    } catch (error) {
      logger.warn(
        { parent: parentUuid, error: String(error) },
        'could not find the links to push after a parent change'
      );
      return;
    }

    if (targets.length > max) {
      logger.warn(
        { parent: parentUuid, max },
        'too many links to push after a parent change; pushing the least recently pushed ones'
      );
      targets = targets.slice(0, max);
    }

    for (const [index, { uuid, id }] of targets.entries()) {
      if (index > 0) await this.deps.sleep(this.deps.spacingMs());
      if (!this.deps.enabled()) return;
      try {
        const result = await this.deps.pushIfChanged(uuid, id);
        logger.info(
          { parent: parentUuid, uuid, pushed: result !== null },
          result
            ? 'pushed a linked account after a parent change'
            : 'linked account already up to date after a parent change'
        );
      } catch {
        // The service records and logs the failure on the link itself.
      }
    }
  }
}

let started: ParentChangePusher | null = null;

/** Starts pushing on parent changes for this process. Safe to call twice. */
export function startParentChangePushes(): ParentChangePusher {
  if (started) return started;
  const pusher = new ParentChangePusher();
  userConfigBus.on('saved', (uuid: string) => {
    // Listeners run inside the save; a throw here would fail a save that
    // already committed.
    try {
      pusher.saved(uuid);
    } catch (error) {
      logger.error(
        { parent: uuid, error: String(error) },
        'could not schedule a push after a parent change'
      );
    }
  });
  started = pusher;
  return pusher;
}
