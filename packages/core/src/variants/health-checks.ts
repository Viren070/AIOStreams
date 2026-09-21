/**
 * Health checks: user-defined URLs whose reachability gates config variants and
 * stream expressions through `health('<id>')`.
 *
 * A result is cached by check definition rather than by user, so identical
 * checks across configurations cost one request per interval. Failures are
 * cached too: a service that is down must not be re-probed on every request.
 */
import { config as appConfig } from '../config/index.js';
import type { HealthCheck, HealthCheckExpect, UserData } from '../db/schemas.js';
import { createLogger } from '../logging/logger.js';
import { Cache } from '../utils/cache.js';
import { getSimpleTextHash } from '../utils/crypto.js';
import { fetchRemoteCapped } from '../utils/safe-fetch.js';
import {
  isUnsafeRemoteUrl,
  isUnsafeRemoteUrlResolved,
} from '../utils/url-safety.js';

const logger = createLogger('health-checks');

export interface HealthResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** Epoch ms the probe finished, which is what makes a result stale. */
  checkedAt: number;
  latencyMs: number;
}

export interface NormalisedHealthCheck {
  id: string;
  url: string;
  method: 'GET' | 'HEAD';
  expect: HealthCheckExpect;
  ttl: number;
  timeout: number;
  onError: 'unhealthy' | 'healthy';
}

const DEFAULT_TTL = 300;
const DEFAULT_TIMEOUT = 3000;
const DEFAULT_STATUS = '2xx';

const cache = Cache.getInstance<string, HealthResult>(
  'health_check',
  undefined,
  appConfig.bootstrap.redisUri ? 'redis' : 'memory'
);

/**
 * Per process, so a burst of requests for one check triggers a single probe.
 * The shared cache still dedupes across replicas at the granularity of a TTL.
 */
const inflight = new Map<string, Promise<HealthResult>>();

export function healthChecksEnabled(userData: UserData): boolean {
  const access = appConfig.userLimits.healthChecks.access;
  if (access === 'none') return false;
  if (access === 'trusted') return userData.trusted === true;
  return true;
}

/** Applies defaults and the operator's floors and ceilings. */
export function normaliseHealthCheck(check: HealthCheck): NormalisedHealthCheck {
  const limits = appConfig.userLimits.healthChecks;
  return {
    id: check.id.toLowerCase(),
    url: check.url,
    method: check.method ?? 'GET',
    expect: check.expect ?? {},
    ttl: Math.max(check.ttl ?? DEFAULT_TTL, limits.minTtl),
    timeout: Math.min(check.timeout ?? DEFAULT_TIMEOUT, limits.maxTimeout),
    onError: check.onError ?? 'unhealthy',
  };
}

/**
 * Identity of a probe. The id is deliberately absent: two users naming the same
 * endpoint differently still share one result.
 */
export function healthCheckKey(check: NormalisedHealthCheck): string {
  return getSimpleTextHash(
    JSON.stringify({
      url: check.url,
      method: check.method,
      expect: check.expect,
      timeout: check.timeout,
      onError: check.onError,
    })
  );
}

export function statusMatches(expected: string | undefined, status: number) {
  const rule = expected ?? DEFAULT_STATUS;
  const range = /^(\d{3})-(\d{3})$/.exec(rule);
  if (range) return status >= Number(range[1]) && status <= Number(range[2]);
  if (/^\dxx$/i.test(rule)) return Math.floor(status / 100) === Number(rule[0]);
  return status === Number(rule);
}

/** Walks a dotted path with optional `[n]` indexes. */
function readJsonPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    const [, key, indexes] = /^([^[]*)((?:\[\d+\])*)$/.exec(segment) ?? [];
    if (key === undefined) return undefined;
    if (key) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    for (const match of indexes?.match(/\d+/g) ?? []) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(match)];
    }
  }
  return current;
}

function bodyMatches(expect: HealthCheckExpect, body: Buffer): boolean {
  if (!expect.bodyContains && !expect.jsonPath) return true;
  const text = body.toString('utf8');

  if (
    expect.bodyContains &&
    !text.toLowerCase().includes(expect.bodyContains.toLowerCase())
  ) {
    return false;
  }

  if (expect.jsonPath) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    const value = readJsonPath(parsed, expect.jsonPath);
    if (expect.jsonValue === undefined) return Boolean(value);
    return String(value) === String(expect.jsonValue);
  }

  return true;
}

/**
 * What a health check URL is allowed to be. Throws with the reason, so a save
 * can report it and a probe can refuse.
 */
export function assertSafeHealthCheckUrl(check: {
  id: string;
  url: string;
}): void {
  const limits = appConfig.userLimits.healthChecks;
  let url: URL;
  try {
    url = new URL(check.url);
  } catch {
    throw new Error(`Health check "${check.id}" has an invalid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Health check "${check.id}" must use http or https.`);
  }
  if (!limits.allowPrivateUrls && isUnsafeRemoteUrl(check.url)) {
    throw new Error(
      `Health check "${check.id}" points at a private address, which this instance does not allow.`
    );
  }
  // A check aimed at this instance would re-enter the request it is gating.
  for (const own of [
    appConfig.bootstrap.baseUrl,
    appConfig.bootstrap.internalUrl,
  ]) {
    if (!own) continue;
    let ownHost: string;
    try {
      ownHost = new URL(own).host;
    } catch {
      continue;
    }
    if (ownHost === url.host) {
      throw new Error(
        `Health check "${check.id}" points back at this instance.`
      );
    }
  }
}

/** Never rejects: a failure is a result, and gets cached like any other. */
async function probe(check: NormalisedHealthCheck): Promise<HealthResult> {
  const limits = appConfig.userLimits.healthChecks;
  const started = Date.now();
  try {
    assertSafeHealthCheckUrl(check);
    if (
      !limits.allowPrivateUrls &&
      (await isUnsafeRemoteUrlResolved(check.url))
    ) {
      throw new Error('URL refused (unsafe scheme or private address)');
    }
    const response = await fetchRemoteCapped(check.url, {
      maxBytes: limits.maxBytes,
      timeoutMs: check.timeout,
      method: check.method,
      allowPrivateHosts: limits.allowPrivateUrls,
      throwOnHttpError: false,
    });
    if (response.notModified) throw new Error('unexpected 304 response');

    const ok =
      statusMatches(check.expect.status, response.status) &&
      bodyMatches(check.expect, response.body);
    const result: HealthResult = {
      ok,
      status: response.status,
      checkedAt: Date.now(),
      latencyMs: Date.now() - started,
    };
    logger.debug(
      { id: check.id, ok, status: response.status, ms: result.latencyMs },
      'probed health check'
    );
    return result;
  } catch (error: any) {
    const message = error?.message ?? String(error);
    const result: HealthResult = {
      ok: check.onError === 'healthy',
      error: message,
      checkedAt: Date.now(),
      latencyMs: Date.now() - started,
    };
    logger.warn(
      { id: check.id, err: message, ok: result.ok, ms: result.latencyMs },
      'health check failed'
    );
    return result;
  }
}

function refresh(
  key: string,
  check: NormalisedHealthCheck
): Promise<HealthResult> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = probe(check)
    .then(async (result) => {
      // Kept for a second interval past freshness so a stale result is still
      // there to serve while the refresh behind it runs.
      await cache.set(key, result, check.ttl * 2);
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

/**
 * A fresh result is returned as is, a stale one is returned immediately and
 * refreshed behind the request, and a miss waits for the probe.
 */
export async function getHealth(
  check: HealthCheck,
  options: { bypassCache?: boolean } = {}
): Promise<HealthResult> {
  const normalised = normaliseHealthCheck(check);
  const key = healthCheckKey(normalised);

  if (!options.bypassCache) {
    const hit = await cache.get(key);
    if (hit) {
      if (Date.now() - hit.checkedAt > normalised.ttl * 1000) {
        void refresh(key, normalised).catch(() => {});
      }
      return hit;
    }
  }
  return refresh(key, normalised);
}

/**
 * The checks a configuration may actually run right now. Enforced here rather
 * than trusted from validation, since access and limits can change after a
 * configuration was saved and requests must degrade rather than fail.
 */
function permittedChecks(userData: UserData): HealthCheck[] {
  if (!healthChecksEnabled(userData)) return [];
  return (userData.healthChecks ?? []).slice(
    0,
    appConfig.userLimits.healthChecks.max
  );
}

/**
 * Resolves every check the configuration defines, once, so one request sees one
 * answer per check no matter how many expressions ask for it.
 */
export async function resolveHealthResults(
  userData: UserData
): Promise<Record<string, boolean>> {
  const checks = permittedChecks(userData);
  if (!checks.length) return {};

  const entries = await Promise.all(
    checks.map(async (check) => {
      const result = await getHealth(check);
      return [check.id.toLowerCase(), result.ok] as const;
    })
  );
  return Object.fromEntries(entries);
}

/** Same as `resolveHealthResults` but keeps the detail, for the test endpoint. */
export async function resolveHealthDetails(
  userData: UserData
): Promise<Record<string, HealthResult>> {
  const checks = permittedChecks(userData);
  if (!checks.length) return {};

  const entries = await Promise.all(
    checks.map(async (check) => {
      const result = await getHealth(check);
      return [check.id.toLowerCase(), result] as const;
    })
  );
  return Object.fromEntries(entries);
}
