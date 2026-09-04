/**
 * The user agents a configuration has recently been called with.
 *
 * Writing a condition against `userAgent` means guessing what a client sends;
 * this records the last few so the configuration page can show them instead.
 */
import { createLogger } from '../logging/logger.js';
import { Cache } from '../utils/cache.js';

const logger = createLogger('client-agents');

export interface ClientAgent {
  userAgent: string;
  /** Epoch ms. */
  firstSeen: number;
  lastSeen: number;
  requests: number;
}

/**
 * Manifest requests do not count. A client can install with one user agent and
 * play with another, and it is the playing one a condition acts on. The
 * configuration page also fetches the manifest itself, so recording those would
 * fill the list with the browser you edit in.
 */
const IGNORED_RESOURCES: ReadonlySet<string> = new Set([
  'manifest.json',
  'manifest',
  'configure',
]);

/** Deliberately short: this is a hint for writing a condition, not a log. */
const MAX_AGENTS = 5;
const TTL_SECONDS = 30 * 24 * 60 * 60;
/** One write per configuration per window, unless the agent is a new one. */
const WRITE_INTERVAL_MS = 60_000;
const MAX_USER_AGENT_LENGTH = 512;

const cache = Cache.getInstance<string, ClientAgent[]>('client_agents');

const lastWrite = new Map<string, number>();
const seen = new Set<string>();

export async function getClientAgents(uuid: string): Promise<ClientAgent[]> {
  const agents = (await cache.get(uuid)) ?? [];
  return [...agents].sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * Records one request's user agent. Fire and forget: a failure here must never
 * affect the response, and a lost entry only costs a line in a hint list.
 */
export async function recordClientAgent(
  uuid: string | undefined,
  userAgent: string | undefined,
  resource: string
): Promise<void> {
  if (!uuid || !userAgent?.trim()) return;
  if (IGNORED_RESOURCES.has(resource)) return;
  const value = userAgent.trim().slice(0, MAX_USER_AGENT_LENGTH);

  const key = `${uuid}|${value}`;
  const isNew = !seen.has(key);
  const due = Date.now() - (lastWrite.get(uuid) ?? 0) > WRITE_INTERVAL_MS;
  if (!isNew && !due) return;

  seen.add(key);
  lastWrite.set(uuid, Date.now());
  // Bounded by the number of live configurations; entries are tiny.
  if (seen.size > 10_000) seen.clear();

  try {
    const now = Date.now();
    const agents = (await cache.get(uuid)) ?? [];
    const existing = agents.find((agent) => agent.userAgent === value);
    if (existing) {
      existing.lastSeen = now;
      existing.requests += 1;
    } else {
      agents.push({
        userAgent: value,
        firstSeen: now,
        lastSeen: now,
        requests: 1,
      });
    }
    const kept = agents
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, MAX_AGENTS);
    await cache.set(uuid, kept, TTL_SECONDS);
  } catch (error: any) {
    logger.debug(
      { uuid, err: error?.message ?? String(error) },
      'could not record client user agent'
    );
  }
}
