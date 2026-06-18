import {
  Cache,
  HEADERS_FOR_IP_FORWARDING,
  INTERNAL_SECRET_HEADER,
  Env,
  maskSensitiveInfo,
} from './index.js';
import { config as appConfig } from '../config/index.js';
import {
  BodyInit,
  Dispatcher,
  fetch,
  Headers,
  HeadersInit,
  ProxyAgent,
  RequestInit,
} from 'undici';
import { socksDispatcher } from 'fetch-socks';
import { createLogger } from '../logging/logger.js';
import { resolveHeaderPreset } from './header-presets.js';

const logger = createLogger('http');
const urlCount = Cache.getInstance<string, number>(
  'url-count',
  undefined,
  'memory'
);

export class PossibleRecursiveRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PossibleRecursiveRequestError';
  }
}
export function makeUrlLogSafe(url: string) {
  // for each component of the path, if it is longer than 10 characters, mask it
  // and replace the query params of key 'password' with '****'
  return url
    .split('/')
    .map((component) => {
      if (component.length > 10 && !component.includes('.')) {
        return maskSensitiveInfo(component);
      }
      return component;
    })
    .join('/')
    .replace(/(?<![^?&])(password=[^&]+)/g, 'password=****')
    .replace(/(?<![^?&])(apikey=[^&]+)/gi, 'apikey=****');
}

/**
 * The "context" a fetch runs within. Surfaced as a `[context]` key in
 * `hostnameUserAgentOverrides` / `addonProxyConfig`, so per-purpose requests can
 * be tuned.
 */
export type FetchContext =
  | 'nzb_grabs'
  | 'torrent_grabs'
  | 'newznab'
  | 'torznab';

export interface RequestOptions {
  timeout: number;
  signal?: AbortSignal;
  method?: string;
  forwardIp?: string;
  ignoreRecursion?: boolean;
  headers?: HeadersInit;
  body?: BodyInit;
  forceProxy?: string;
  context?: FetchContext;
  rawOptions?: RequestInit;
}

export async function makeRequest(url: string, options: RequestOptions) {
  const urlObj = new URL(url);

  if (
    appConfig.bootstrap.baseUrl &&
    urlObj.origin === appConfig.bootstrap.baseUrl
  ) {
    const internalUrl = new URL(appConfig.bootstrap.internalUrl);
    urlObj.protocol = internalUrl.protocol;
    urlObj.host = internalUrl.host;
    urlObj.port = internalUrl.port;
  }

  if (appConfig.http.requestUrlMappings) {
    for (const [key, value] of Object.entries(
      appConfig.http.requestUrlMappings
    )) {
      if (urlObj.origin === key) {
        const mappedUrl = new URL(value);
        urlObj.protocol = mappedUrl.protocol;
        urlObj.host = mappedUrl.host;
        urlObj.port = mappedUrl.port;
        break;
      }
    }
  }

  const { useProxy, proxyIndex } = shouldProxy(urlObj, options.context);
  const headers = new Headers(options.headers);
  if (options.forwardIp) {
    for (const header of HEADERS_FOR_IP_FORWARDING) {
      headers.set(header, options.forwardIp);
    }
  }

  if (urlObj.toString().startsWith(appConfig.bootstrap.internalUrl)) {
    headers.set(INTERNAL_SECRET_HEADER, appConfig.bootstrap.internalSecret);
  }

  // Apply per-host / per-[context] override headers
  const overrideHeaders = resolveOverrideHeaders(urlObj, options.context);
  for (const [name, value] of Object.entries(overrideHeaders)) {
    headers.set(name, value);
  }

  if (
    ['none', 'false', '', 'undefined'].includes(
      (headers.get('User-Agent') ?? '').toLowerCase().trim()
    )
  ) {
    headers.delete('User-Agent');
  }

  // block recursive requests
  const key = `${urlObj.toString()}-${options.forwardIp}`;
  const currentCount = (await urlCount.get(key)) ?? 0;
  if (
    currentCount > appConfig.recursion.thresholdLimit &&
    !options.ignoreRecursion
  ) {
    logger.warn(
      { url: makeUrlLogSafe(urlObj.toString()), count: currentCount },
      'detected possible recursive requests, blocking'
    );
    throw new PossibleRecursiveRequestError(
      `Possible recursive request to ${urlObj.toString()}`
    );
  }
  if (currentCount > 0) {
    await urlCount.update(key, currentCount + 1);
  } else {
    await urlCount.set(key, 1, appConfig.recursion.thresholdWindow);
  }

  let dispatcher: Dispatcher | undefined;

  if (options.forceProxy) {
    dispatcher = getProxyAgent(options.forceProxy);
  } else if (useProxy) {
    dispatcher = getProxyAgent(appConfig.http.addonProxy[proxyIndex]);
  }

  logger.trace(
    {
      url: makeUrlLogSafe(urlObj.toString()),
      method: options.method ?? 'GET',
      proxy: useProxy
        ? `proxy-${proxyIndex + 1}`
        : options.forceProxy
          ? 'forced'
          : 'direct',
    },
    'http request'
  );

  let response;
  try {
    response = await fetch(urlObj.toString(), {
      ...options.rawOptions,
      method: options.method,
      body: options.body,
      headers: headers,
      dispatcher: dispatcher,
      signal: options.signal ?? AbortSignal.timeout(options.timeout),
    });
  } catch (err) {
    if (
      err instanceof Error &&
      err.name === 'TypeError' &&
      err.message === 'fetch failed' &&
      err.cause
    ) {
      const cause = { ...(err.cause as Record<string, any>) };
      delete cause.stack;
      logger.error({ cause }, 'fetch failed due to network error');
    }
    throw err;
  }

  return response;
}

const proxyAgents = new Map<string, Dispatcher>();
export function getProxyAgent(proxyUrl: string): Dispatcher | undefined {
  if (!proxyUrl) {
    return undefined;
  }

  let proxyAgent = proxyAgents.get(proxyUrl);

  if (!proxyAgent) {
    const proxyUrlObj = new URL(proxyUrl);
    if (
      proxyUrlObj.protocol === 'socks5:' ||
      proxyUrlObj.protocol === 'socks5h:'
    ) {
      proxyAgent = socksDispatcher({
        type: 5,
        port: parseInt(proxyUrlObj.port),
        host: proxyUrlObj.hostname,
        userId: proxyUrlObj.username || undefined,
        password: proxyUrlObj.password || undefined,
      });
    } else {
      proxyAgent = new ProxyAgent(proxyUrl);
    }
  }

  return proxyAgent;
}

export function shouldProxy(
  url: URL,
  context?: string
): {
  useProxy: boolean;
  proxyIndex: number;
} {
  const hostname = url.hostname;

  if (!appConfig.http.addonProxy || appConfig.http.addonProxy.length === 0) {
    return { useProxy: false, proxyIndex: -1 };
  }
  if (hostname === 'localhost') {
    return { useProxy: false, proxyIndex: -1 };
  }

  const config = appConfig.http.addonProxyConfig;
  let proxyIndex = 0;

  if (config && Object.keys(config).length > 0) {
    const matched = matchOverride(config, hostname, context);
    if (matched === undefined || matched === false) {
      // A config exists but nothing matched (and no `*`), or the match disables
      // the proxy → don't proxy.
      return { useProxy: false, proxyIndex: -1 };
    }
    if (matched === true) {
      proxyIndex = 0;
    } else if (typeof matched === 'number' && Number.isInteger(matched)) {
      proxyIndex = matched;
    } else {
      logger.error({ value: String(matched) }, 'invalid proxy config value');
      return { useProxy: false, proxyIndex: -1 };
    }
  }

  if (appConfig.http.addonProxy[proxyIndex] === undefined) {
    logger.error({ proxyIndex }, 'proxy index out of range');
    return { useProxy: false, proxyIndex: -1 };
  }

  return { useProxy: true, proxyIndex };
}

/**
 * Resolve the override headers to apply to a request for `url` in an optional
 * `context`. Reads `hostnameUserAgentOverrides`: the matched value is either a
 * literal user-agent (→ `{ 'User-Agent': value }`) or a `{preset}` reference
 * expanded to its full header set (see `header-presets.ts`). Returns an empty
 * object when nothing matches.
 */
export function resolveOverrideHeaders(
  url: URL,
  context?: string
): Record<string, string> {
  const map = appConfig.http.hostnameUserAgentOverrides;
  if (!map || Object.keys(map).length === 0) return {};
  const value = matchOverride(map, url.hostname, context);
  if (value === undefined || value === '') return {};
  return resolveHeaderPreset(value) ?? { 'User-Agent': value };
}

/**
 * Pick the most specific value from a host / `[context]`-keyed override map for a
 * request. Used by the request-header overrides (`hostnameUserAgentOverrides`)
 * and the addon-proxy config (`addonProxyConfig`), both of which key entries by
 * either a hostname pattern or a `[context]` label.
 *
 * When several keys match, the most specific wins, in this order:
 *   1. exact hostname (`example.com`)
 *   2. wildcard hostname suffix (`*.example.com`)
 *   3. `[context]` label (e.g. `[nzb_grabs]`)
 *   4. global `*`
 *
 * Returns the matched value, or `undefined` when nothing matches.
 */
export function matchOverride<T>(
  map: Record<string, T>,
  hostname: string,
  context?: string
): T | undefined {
  const contextKey = context ? `[${context}]` : undefined;
  let exact: T | undefined;
  let wildcard: T | undefined;
  let ctx: T | undefined;
  let global: T | undefined;
  for (const [key, value] of Object.entries(map)) {
    if (key === hostname) {
      exact = value;
    } else if (key === '*') {
      global = value;
    } else if (key.length > 1 && key.startsWith('*')) {
      if (hostname.endsWith(key.slice(1))) wildcard = value;
    } else if (contextKey && key === contextKey) {
      ctx = value;
    }
  }
  if (exact !== undefined) return exact;
  if (wildcard !== undefined) return wildcard;
  if (ctx !== undefined) return ctx;
  return global;
}
