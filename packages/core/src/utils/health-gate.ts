import { Cache } from './cache.js';
import { isUnsafeRemoteUrlResolved } from './url-safety.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('health-gate');

const TTL_SECONDS = 30;
// One budget for the whole probe, lookups and fetches together. Per-hop caps
// would each be honoured and still leave a redirect chain multiplying them,
// and a user waits on the total rather than on a hop.
// Sized for a cold lookup, a TLS handshake and a redirect rather than for one
// warm fetch. Overrunning leaves the item enabled, so the cost is that this
// stops gating.
const TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 3;

// Resolved on first use rather than at module load: Cache reaches appConfig,
// which imports this module's neighbours, and taking the instance up front
// makes that a cycle.
let store: Cache<string, boolean> | undefined;
const cache = () =>
  (store ??= Cache.getInstance<string, boolean>('health-check', 500));

const inFlight = new Map<string, Promise<boolean>>();

// The resolver call carries no timeout of its own, so an unresolvable host would
// otherwise wait on the system resolver while a user waits on the stream. A
// lookup that overruns its share of the budget is treated as unsafe, which
// leaves the item enabled.
async function unsafeWithinBudget(
  url: string,
  ms: number
): Promise<'safe' | 'unsafe' | 'timed-out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      isUnsafeRemoteUrlResolved(url).then((unsafe) =>
        unsafe ? ('unsafe' as const) : ('safe' as const)
      ),
      new Promise<'timed-out'>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * What a health check concluded, and why. Returned rather than logged so the
 * gate and the Test button read the same value: a button that explained itself
 * from its own logic could reassure about something the gate does not do.
 */
export type HealthCause =
  | 'server-error'
  | 'answered'
  | 'unsafe-address'
  | 'no-time'
  | 'unresolvable'
  | 'bad-redirect'
  | 'too-many-redirects'
  | 'unreachable';

export interface HealthVerdict {
  ok: boolean;
  outcome: 'skipped' | 'enabled';
  cause: HealthCause;
  reason: string;
  status?: number;
}

const enabled = (
  cause: HealthCause,
  reason: string,
  status?: number
): HealthVerdict => ({ ok: true, outcome: 'enabled', cause, reason, status });

/**
 * Probe a URL and say what the gate would do with it. Does no logging: a user
 * pressing Test is not an event worth a warning.
 */
export async function probeVerdict(url: string): Promise<HealthVerdict> {
  const deadline = Date.now() + TIMEOUT_MS;
  const remaining = () => deadline - Date.now();
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (remaining() <= 0) {
        return enabled(
          'no-time',
          'The check ran out of time, so nothing is skipped.'
        );
      }
      // The URL comes from an end user, so the DNS-resolving guard applies: a
      // literal-host check passes a name that resolves to a private address.
      // Every hop is re-checked, so a redirect cannot reach one the first
      // refused.
      const safety = await unsafeWithinBudget(current, remaining());
      if (safety === 'unsafe') {
        return enabled(
          'unsafe-address',
          'That address is not reachable from the public internet, so it is ignored. Use a public http(s) address.'
        );
      }
      if (safety === 'timed-out') {
        return enabled(
          'unresolvable',
          'The host did not resolve in time, so nothing is skipped.'
        );
      }

      const res = await fetch(current, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(remaining(), 1)),
      });
      await res.body?.cancel().catch(() => {});

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return enabled(
            'bad-redirect',
            'The URL redirected without saying where, so nothing is skipped.',
            res.status
          );
        }
        current = new URL(location, current).toString();
        continue;
      }

      // Only a definite refusal skips a provider. A monitor that does not know
      // the id has told us nothing about the service, and a mistyped URL is a
      // configuration error rather than an outage.
      if (res.status >= 500) {
        return {
          ok: true,
          outcome: 'skipped',
          cause: 'server-error',
          reason: 'The check answered with a server error, so this is skipped.',
          status: res.status,
        };
      }
      return enabled(
        'answered',
        'The check answered, so this stays enabled.',
        res.status
      );
    }
    return enabled(
      'too-many-redirects',
      'The URL redirected too many times, so nothing is skipped.'
    );
  } catch {
    // Nor can a monitor we failed to reach disable something that is working.
    return {
      ok: false,
      outcome: 'enabled',
      cause: 'unreachable',
      reason: 'The check could not be reached, so nothing is skipped.',
    };
  }
}

/**
 * Whether a usenet server accepts a connection. It opens the socket, completes
 * the TLS handshake where the row asks for it, and closes — it never signs in,
 * so a wrong password is not reported as an outage.
 */
export async function probeNntpVerdict(
  host: string,
  port: number,
  ssl: boolean
): Promise<HealthVerdict> {
  const { connect: netConnect } = await import('node:net');
  const { connect: tlsConnect } = await import('node:tls');
  return new Promise<HealthVerdict>((resolve) => {
    let settled = false;
    const finish = (verdict: HealthVerdict) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(verdict);
    };
    const socket = ssl
      ? tlsConnect({ host, port, servername: host })
      : netConnect({ host, port });
    socket.setTimeout(TIMEOUT_MS);
    socket.once(ssl ? 'secureConnect' : 'connect', () =>
      finish(
        enabled(
          'answered',
          'The server accepted a connection. It was not signed in to, so the username and password are not tested.'
        )
      )
    );
    socket.once('timeout', () =>
      finish({
        ok: false,
        outcome: 'skipped',
        cause: 'no-time',
        reason: 'The server did not answer in time, so it is skipped.',
      })
    );
    socket.once('error', () =>
      finish({
        ok: false,
        outcome: 'skipped',
        cause: 'unreachable',
        reason: 'The server could not be reached, so it is skipped.',
      })
    );
  });
}

async function probe(url: string): Promise<boolean> {
  const verdict = await probeVerdict(url);
  if (verdict.outcome === 'skipped') return false;
  // Only the states a human has to act on reach the log at warn; the transient
  // ones would be noisy at every probe.
  const actionable: HealthCause[] = [
    'unsafe-address',
    'bad-redirect',
    'too-many-redirects',
  ];
  if (actionable.includes(verdict.cause)) {
    logger.warn(`${verdict.reason} Health check: ${url}`);
  } else if (verdict.cause !== 'answered') {
    logger.debug(`${verdict.reason} Health check: ${url}`);
  }
  return true;
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
 * The usenet servers that accept a connection right now.
 *
 * Unlike a URL check this fails closed: a server that will not accept a
 * connection cannot serve articles, so the reading is the thing itself rather
 * than a signal about it. Verdicts are cached and shared for the same reason
 * and for the same window as the URL checks.
 */
async function nntpUsable(server: {
  host: string;
  port: number;
  ssl: boolean;
}): Promise<boolean> {
  const key = `nntp://${server.host}:${server.port}/${server.ssl ? 1 : 0}`;
  const cached = await cache().get(key);
  if (cached !== undefined) return cached;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = probeNntpVerdict(server.host, server.port, server.ssl)
      .then(async (verdict) => {
        const ok = verdict.outcome === 'enabled';
        if (!ok) {
          logger.warn(
            `${verdict.reason} Usenet server: ${server.host}:${server.port}`
          );
        }
        await cache().set(key, ok, TTL_SECONDS);
        return ok;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/**
 * The usenet servers that accept a connection right now.
 *
 * Unlike a URL check this fails closed: a server that will not accept a
 * connection cannot serve articles, so the reading is the thing itself rather
 * than a signal about it. Verdicts are cached and shared for the same reason
 * and for the same window as the URL checks.
 */
export async function resolveHealthyNntp<
  T extends { host: string; port: number; ssl: boolean },
>(servers: readonly T[]): Promise<T[]> {
  const usable = await Promise.all(servers.map((server) => nntpUsable(server)));
  return servers.filter((_, index) => usable[index]);
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
