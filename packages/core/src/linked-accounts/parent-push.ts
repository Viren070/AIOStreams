import { config as appConfig } from '../config/index.js';
import { ConfigParentRepository } from '../db/repositories/config-parents.js';
import { LinkedAccountRepository } from '../db/repositories/linked-accounts.js';
import { userConfigBus } from '../db/repositories/users.js';
import { createLogger } from '../logging/logger.js';
import { LinkedAccountService } from './service.js';
import type { PushResult } from './types.js';

const logger = createLogger('linked-accounts');

/** Deep enough for any parent chain a configuration can have. */
const MAX_PARENT_DEPTH = 5;

export interface ParentPushDeps {
  enabled(): boolean;
  delayMs(): number;
  maxLinks(): number;
  descendants(parentUuid: string, maxDepth: number): Promise<string[]>;
  targets(uuids: string[]): Promise<Array<{ uuid: string; id: string }>>;
  pushIfChanged(uuid: string, id: string): Promise<PushResult | null>;
}

const defaultDeps: ParentPushDeps = {
  enabled: () => appConfig.linkedAccounts.enabled,
  delayMs: () => appConfig.linkedAccounts.parentPushDelay * 1000,
  maxLinks: () => appConfig.linkedAccounts.parentPushMaxLinks,
  descendants: (uuid, depth) => ConfigParentRepository.descendants(uuid, depth),
  targets: (uuids) => LinkedAccountRepository.listPushOnParentChange(uuids),
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
      this.queue = this.queue.then(() => this.run(parentUuid));
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
    let targets: Array<{ uuid: string; id: string }>;
    try {
      const children = await this.deps.descendants(
        parentUuid,
        MAX_PARENT_DEPTH
      );
      if (children.length === 0) return;
      targets = await this.deps.targets(children);
    } catch (error) {
      logger.warn(
        { parent: parentUuid, error: String(error) },
        'could not find the links to push after a parent change'
      );
      return;
    }

    const max = this.deps.maxLinks();
    if (targets.length > max) {
      logger.warn(
        { parent: parentUuid, links: targets.length, max },
        'too many links to push after a parent change; pushing only the first ones'
      );
      targets = targets.slice(0, max);
    }

    for (const { uuid, id } of targets) {
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
  userConfigBus.on('saved', (uuid: string) => pusher.saved(uuid));
  started = pusher;
  return pusher;
}
