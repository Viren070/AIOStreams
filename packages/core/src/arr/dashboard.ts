import { settingsStore } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import {
  QUEUE_CLEANUP_RULES,
  type QueueCleanupRuleDef,
} from '../config/schema/arr-rules.js';
import { ArrClient } from './client.js';
import type { ArrInstance } from './types.js';

const logger = createLogger('arr');

/** Placeholder returned/accepted in place of a stored API key. */
export const ARR_SECRET_MASK = '__stored__';

/** An arr instance with its API key redacted for the dashboard. */
export interface MaskedArrInstance extends Omit<ArrInstance, 'apiKey'> {
  hasApiKey: boolean;
}

function stored(): ArrInstance[] {
  return (settingsStore.current.arr?.instances ?? []) as ArrInstance[];
}

export function getArrInstances(): MaskedArrInstance[] {
  return stored().map(({ apiKey, ...rest }) => ({
    ...rest,
    hasApiKey: !!apiKey,
  }));
}

/**
 * Persist the instance list. An instance whose key is {@link ARR_SECRET_MASK}
 * keeps the stored one (matched by id), so the editor never round-trips
 * secrets. Validation happens in the settings store.
 */
export async function saveArrInstances(
  incoming: (Partial<ArrInstance> & { apiKey?: string })[],
  username?: string
): Promise<void> {
  const byId = new Map(stored().map((i) => [i.id, i]));
  const merged = incoming.map((i) => {
    const prev = i.id ? byId.get(i.id) : undefined;
    const apiKey =
      i.apiKey === ARR_SECRET_MASK || i.apiKey === undefined
        ? prev?.apiKey
        : i.apiKey;
    return { ...i, apiKey };
  });
  await settingsStore.set('arr.instances', merged, username);
}

/** A cleanup rule as the settings editor sees it: catalogue text + choices. */
export interface QueueCleanupRuleView extends QueueCleanupRuleDef {
  /** The arr phrase this rule matches, shown to the user verbatim. */
  phrase: string;
}

/** The rule catalogue merged with the user's enable/action choices. */
export function getQueueCleanupRules(): QueueCleanupRuleView[] {
  const overrides = new Map(
    (
      (settingsStore.current.arr?.queueCleanup?.rules ?? []) as {
        id: string;
        enabled: boolean;
        action: QueueCleanupRuleDef['action'];
      }[]
    ).map((r) => [r.id, r])
  );
  return QUEUE_CLEANUP_RULES.map((rule) => {
    const override = overrides.get(rule.id);
    return override
      ? { ...rule, enabled: override.enabled, action: override.action }
      : { ...rule };
  });
}

/** Persist enable/action choices. */
export async function saveQueueCleanupRules(
  incoming: { id: string; enabled?: boolean; action?: string }[],
  username?: string
): Promise<void> {
  const chosen = new Map(incoming.map((r) => [r.id, r]));
  const merged = QUEUE_CLEANUP_RULES.map((rule) => {
    const choice = chosen.get(rule.id);
    return {
      id: rule.id,
      enabled: choice?.enabled ?? rule.enabled,
      action: (choice?.action ?? rule.action) as QueueCleanupRuleDef['action'],
    };
  });
  await settingsStore.set('arr.queueCleanup.rules', merged, username);
}

export interface ArrTestResult {
  ok: boolean;
  version?: string;
  appName?: string;
  error?: string;
}

/** Reachability + credential check for one instance (the "Test" button). */
export async function testArrInstance(
  instance: Partial<ArrInstance> & { apiKey?: string }
): Promise<ArrTestResult> {
  let apiKey = instance.apiKey;
  if (apiKey === ARR_SECRET_MASK || apiKey === undefined) {
    apiKey = stored().find((i) => i.id === instance.id)?.apiKey;
  }
  if (!instance.url || !apiKey) {
    return { ok: false, error: 'url and apiKey are required' };
  }
  try {
    const status = await new ArrClient({
      id: instance.id ?? 'test',
      name: instance.name,
      type: instance.type ?? 'sonarr',
      url: instance.url,
      apiKey,
    }).systemStatus();
    return { ok: true, version: status?.version, appName: status?.appName };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.debug({ url: instance.url, error }, 'arr test failed');
    return { ok: false, error };
  }
}
