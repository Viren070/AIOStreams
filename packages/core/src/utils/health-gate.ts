import { Cache } from './cache.js';
import { isUnsafeRemoteUrl } from '../release-blocklist/url-safety.js';

const TTL_SECONDS = 30;
const TIMEOUT_MS = 2_000;
const MAX_REDIRECTS = 3;

// Resolved on first use rather than at module load: Cache reaches appConfig,
// which imports this module's neighbours, and taking the instance up front
// makes that a cycle.
let store: Cache<string, boolean> | undefined;
const cache = () =>
  (store ??= Cache.getInstance<string, boolean>('health-check', 500));

const inFlight = new Map<string, Promise<boolean>>();

async function probe(url: string): Promise<boolean> {
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Every hop is re-checked, so a redirect cannot reach an address the
      // first check refused.
      if (isUnsafeRemoteUrl(current)) return true;

      const res = await fetch(current, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => {});

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return true;
        current = new URL(location, current).toString();
        continue;
      }

      // Only a definite refusal skips a provider. A monitor that does not know
      // the id has told us nothing about the service, and a mistyped URL is a
      // configuration error rather than an outage.
      return res.status < 500;
    }
    return true;
  } catch {
    // Nor can a monitor we failed to reach disable something that is working.
    return true;
  }
}

async function usable(url: string): Promise<boolean> {
  const cached = await cache().get(url);
  if (cached !== undefined) return cached;

  let pending = inFlight.get(url);
  if (!pending) {
    pending = probe(url)
      .then(async (result) => {
        await cache().set(url, result, TTL_SECONDS);
        return result;
      })
      .finally(() => inFlight.delete(url));
    inFlight.set(url, pending);
  }
  return pending;
}

/**
 * The keys of `items` that may be used right now.
 *
 * An item with no `healthCheckUrl` is always included, so an untouched config
 * behaves as it does today. The first request for a URL waits for an answer;
 * the verdict is cached and shared after that, so a restart does not wait
 * again. Checks run in parallel, so the wait is one check rather than one per
 * item.
 */
export async function resolveHealthy<T, K>(
  items: readonly T[],
  keyOf: (item: T) => K
): Promise<Set<K>> {
  const allowed = new Set<K>();
  await Promise.all(
    items.map(async (item) => {
      const url = (item as { healthCheckUrl?: string })?.healthCheckUrl;
      if (!url || (await usable(url))) allowed.add(keyOf(item));
    })
  );
  return allowed;
}
