import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, buildConnector, setGlobalDispatcher } from 'undici';
import {
  bootstrap,
  config as appConfig,
  settingsStore,
} from '../config/index.js';
import { isBlockedAddress } from './url-safety.js';

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
};

export class PrivateAddressError extends Error {
  constructor(host: string) {
    super(
      `${host} is a private address, and this instance does not allow connecting to private addresses`
    );
    this.name = 'PrivateAddressError';
  }
}

const bare = (host: string) => host.replace(/^\[|\]$/g, '').toLowerCase();
const destination = (host: string, port: string) => `${bare(host)}:${port}`;

let exemptFor: unknown;
let exempt = new Set<string>();

function collect(value: unknown, out: Set<string>, depth = 0): void {
  if (value == null || depth > 8) return;
  if (typeof value === 'string') {
    for (const part of value.split(/[\s,]+/)) {
      if (!/^https?:\/\//i.test(part) || !URL.canParse(part)) continue;
      const url = new URL(part);
      out.add(
        destination(url.hostname, url.port || DEFAULT_PORTS[url.protocol])
      );
    }
  } else if (typeof value === 'object') {
    for (const v of Object.values(value)) collect(v, out, depth + 1);
  }
}

/** Anything the operator configured, in any setting, stays reachable. */
function exemptDestinations(): Set<string> {
  const current = settingsStore.current;
  if (current !== exemptFor) {
    const next = new Set<string>();
    collect(bootstrap, next);
    collect(current, next);
    exempt = next;
    exemptFor = current;
  }
  return exempt;
}

function refusedHost(host: string, port: string): boolean {
  return (
    !appConfig.http.allowPrivateUrls &&
    !exemptDestinations().has(destination(host, port))
  );
}

/** For a clear message up front; a name that does not resolve fails on its own later. */
export async function isRefusedUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const port = url.port || DEFAULT_PORTS[url.protocol];
  if (!port || !refusedHost(url.hostname, port)) return false;
  const host = bare(url.hostname);
  if (isIP(host)) return isBlockedAddress(host);
  return new Promise((resolve) =>
    dnsLookup(host, { all: true }, (err, addresses) =>
      resolve(!err && addresses.some((a) => isBlockedAddress(a.address)))
    )
  );
}

// Checks the addresses the socket actually uses, so DNS rebinding cannot slip past.
const checkedLookup = ((hostname, options, callback) => {
  dnsLookup(hostname, options, (err, address, family) => {
    const addresses: LookupAddress[] = Array.isArray(address)
      ? address
      : [{ address: address as string, family: family as number }];
    if (!err && addresses.some((a) => isBlockedAddress(a.address))) {
      err = new PrivateAddressError(hostname);
    }
    (callback as (...args: unknown[]) => void)(err, address, family);
  });
}) as LookupFunction;

const plainConnect = buildConnector({});
const checkedConnect = buildConnector({ lookup: checkedLookup });

const connect: buildConnector.connector = (options, callback) => {
  const port = options.port || DEFAULT_PORTS[options.protocol];
  if (!refusedHost(options.hostname, port)) {
    return plainConnect(options, callback);
  }
  const host = bare(options.hostname);
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      const err = new PrivateAddressError(host);
      process.nextTick(() => callback(err, null));
      return;
    }
    return plainConnect(options, callback);
  }
  return checkedConnect(options, callback);
};

/** Not applied behind an outbound proxy, which reaches the target itself. */
export function installPrivateAddressGuard(): void {
  setGlobalDispatcher(new Agent({ connect }));
}
