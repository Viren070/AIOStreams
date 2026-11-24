import {
  Cache,
  HEADERS_FOR_IP_FORWARDING,
  formatDurationAsText,
  getSimpleTextHash,
} from '../index.js';
import type { Response } from 'undici';
import { createLogger } from '../../logging/logger.js';
import { registerLockErrorClass } from '../lock-error-registry.js';
import { shouldProxy } from './dispatcher.js';
import type { HeaderReader } from './headers.js';
import type { FetchContext } from './overrides.js';
import { makeUrlLogSafe, takeBasicAuthFromUrl } from './url.js';

const logger = createLogger('http');
const COOLDOWN_BASE_SECONDS = 5;
const COOLDOWN_CAP_SECONDS = 60;
const cooldowns = Cache.getInstance<string, { until: number; strikes: number }>(
  'upstream-cooldown',
  undefined,
  'memory'
);

export class RateLimitedError extends Error {
  constructor(retryAfterSeconds: number) {
    super(
      `Too Many Requests (retry after ${formatDurationAsText(retryAfterSeconds)})`
    );
    this.name = 'RateLimitedError';
  }
}
registerLockErrorClass(RateLimitedError);

// Retry-After header (delay-seconds or HTTP-date) -> delay in seconds.
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  // Date.parse is lenient (accepts "+1", "1.5" etc) - real HTTP-dates have letters.
  if (!/[a-zA-Z]/.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isNaN(date)
    ? undefined
    : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

const CREDENTIAL_PARAM = /apikey|api_key|token|secret|password|passwd|passkey/i;
const CREDENTIAL_HEADERS = [
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'cookie',
];

export interface CooldownKey {
  key: string;
  anon: boolean;
}

const INDEXER_CONTEXTS: (FetchContext | undefined)[] = [
  'newznab',
  'torznab',
  'nzb_grabs',
  'torrent_grabs',
];

// Upstreams limit a user (forwarded IP or credential) across all paths, and
// anonymous requests by the address they come from. Indexer managers serve each
// indexer under its own path with one API key.
export function cooldownKey(
  urlObj: URL,
  headers: HeaderReader,
  egress: string,
  context?: FetchContext
): CooldownKey {
  const user: string[] = [];
  const auth =
    takeBasicAuthFromUrl(new URL(urlObj)) ?? headers.get('authorization');
  if (auth) user.push(`authorization=${auth}`);
  for (const name of [...HEADERS_FOR_IP_FORWARDING, ...CREDENTIAL_HEADERS]) {
    const value = headers.get(name);
    if (value) user.push(`${name}=${value}`);
  }
  for (const [name, value] of urlObj.searchParams) {
    if (CREDENTIAL_PARAM.test(name)) user.push(`${name}=${value}`);
  }
  const { origin, pathname } = urlObj;
  const scope = INDEXER_CONTEXTS.includes(context)
    ? origin + pathname.slice(0, pathname.lastIndexOf('/'))
    : origin;
  return {
    key: `${scope}|${getSimpleTextHash([egress, ...user].join('&'))}`,
    anon: user.length === 0,
  };
}

interface CooldownOptions {
  forceProxy?: string;
  context?: FetchContext;
  ignoreCooldown?: boolean;
}

function getEgress(urlObj: URL, options: CooldownOptions): string {
  if (options.forceProxy) return options.forceProxy;
  const { useProxy, proxyIndex } = shouldProxy(urlObj, options.context);
  return useProxy ? String(proxyIndex) : '';
}

export async function checkCooldown(
  urlObj: URL,
  headers: HeaderReader,
  options: CooldownOptions
): Promise<CooldownKey> {
  const cooldown = cooldownKey(
    urlObj,
    headers,
    getEgress(urlObj, options),
    options.context
  );
  if (options.ignoreCooldown) return cooldown;
  const entry = await cooldowns.get(cooldown.key);
  const remaining = entry ? entry.until - Date.now() : 0;
  if (remaining > 0) {
    logger.debug(
      { url: makeUrlLogSafe(urlObj.toString()), remaining },
      'skipping request, upstream cooling down'
    );
    throw new RateLimitedError(Math.ceil(remaining / 1000));
  }
  return cooldown;
}

export async function recordCooldown(
  { key, anon }: CooldownKey,
  sentAt: number,
  response: Response
): Promise<void> {
  if (response.status !== 429 && !response.ok) return;
  const previous = await cooldowns.get(key);
  // Responses to requests sent before the cooldown ended belong to its burst.
  const sameBurst = previous !== undefined && sentAt < previous.until;
  if (response.ok) {
    if (previous && !sameBurst) await cooldowns.delete(key);
    return;
  }

  const strikes = sameBurst ? previous.strikes : (previous?.strikes ?? 0) + 1;
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
  const seconds =
    retryAfter !== undefined
      ? Math.min(Math.max(1, retryAfter), COOLDOWN_CAP_SECONDS)
      : anon
        ? COOLDOWN_BASE_SECONDS
        : Math.min(
            COOLDOWN_BASE_SECONDS * 2 ** (strikes - 1),
            COOLDOWN_CAP_SECONDS
          );
  const until = Math.max(previous?.until ?? 0, Date.now() + seconds * 1000);
  await cooldowns.set(
    key,
    { until, strikes },
    Math.ceil((until - Date.now()) / 1000) + 60
  );
}
