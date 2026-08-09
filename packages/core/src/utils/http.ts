import {
  Cache,
  HEADERS_FOR_IP_FORWARDING,
  INTERNAL_SECRET_HEADER,
  Env,
  maskSensitiveInfo,
  redactForLog,
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
  // Long opaque path components are masked; credential query/fragment
  // params and userinfo passwords are stripped by the shared redaction pass.
  return redactForLog(
    url
      .split('/')
      .map((component) => {
        if (component.length > 10 && !component.includes('.')) {
          return maskSensitiveInfo(component);
        }
        return component;
      })
      .join('/')
  );
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
  let urlObj = rewriteRequestUrl(new URL(url));
  const headers = new Headers(options.headers);
  if (options.forwardIp) {
    for (const header of HEADERS_FOR_IP_FORWARDING) {
      headers.set(header, options.forwardIp);
    }
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
      `Possible recursive request to ${makeUrlLogSafe(urlObj.toString())}`
    );
  }
  if (currentCount > 0) {
    await urlCount.update(key, currentCount + 1);
  } else {
    await urlCount.set(key, 1, appConfig.recursion.thresholdWindow);
  }

  // One signal for the whole redirect chain.
  const signal = options.signal ?? AbortSignal.timeout(options.timeout);
  const { redirect: redirectMode, ...rawOptions } = options.rawOptions ?? {};
  let method = options.method ?? 'GET';
  let body = options.body;

  // Redirects are followed manually so the proxy ruleset, override headers,
  // URL rewrites and internal-secret handling are re-evaluated on every hop.
  for (let redirects = 0; ; redirects++) {
    const { dispatcher, useProxy, proxyIndex } = resolveDispatcher(
      urlObj,
      options.context,
      options.forceProxy
    );

    const basicAuth = takeBasicAuthFromUrl(urlObj);
    if (basicAuth) {
      headers.set('Authorization', basicAuth);
    }

    // Re-evaluated per hop so the secret never travels to a redirect target
    // outside the internal origin.
    if (urlObj.toString().startsWith(appConfig.bootstrap.internalUrl)) {
      headers.set(INTERNAL_SECRET_HEADER, appConfig.bootstrap.internalSecret);
    } else {
      headers.delete(INTERNAL_SECRET_HEADER);
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

    logger.debug(
      {
        url: makeUrlLogSafe(urlObj.toString()),
        method,
        ...(redirects > 0 ? { redirects } : {}),
        tunneled: !!dispatcher
          ? 'true' +
            (options.forceProxy ? ' (forced)' : ` (proxy index ${proxyIndex})`)
          : 'false',
        ...(appConfig.logging.logSensitiveInfo
          ? {
              headers: Object.fromEntries(headers.entries()),
              dispatcher:
                options.forceProxy ??
                (useProxy ? appConfig.http.addonProxy[proxyIndex] : undefined),
            }
          : {}),
      },
      'http request'
    );

    let response;
    try {
      response = await fetch(urlObj.toString(), {
        ...rawOptions,
        method,
        body,
        headers: headers,
        dispatcher: dispatcher,
        signal,
        redirect: redirectMode ?? 'manual',
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

    // Callers that set rawOptions.redirect handle redirects themselves.
    if (redirectMode) {
      return response;
    }

    const hop = getRedirectHop(
      response.status,
      response.headers.get('location'),
      urlObj.toString(),
      method
    );
    if (!hop) {
      return response;
    }

    // Release the pooled connection held by the intermediate response.
    await response.body?.cancel().catch(() => {});

    if (redirects >= MAX_REDIRECTS) {
      throw new Error(
        `Exceeded ${MAX_REDIRECTS} redirects requesting ${makeUrlLogSafe(url)}`
      );
    }

    const nextUrl = rewriteRequestUrl(new URL(hop.location));
    if (nextUrl.origin !== urlObj.origin) {
      for (const header of CROSS_ORIGIN_SENSITIVE_HEADERS) {
        headers.delete(header);
      }
    }
    if (hop.methodChanged) {
      body = undefined;
      for (const header of REQUEST_BODY_HEADERS) {
        headers.delete(header);
      }
    }
    method = hop.method;
    urlObj = nextUrl;
  }
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
    proxyAgents.set(proxyUrl, proxyAgent);
  }

  return proxyAgent;
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

export const REQUEST_BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-location',
  'content-length',
  'content-type',
];

/** Headers dropped when a redirect crosses origins. */
export const CROSS_ORIGIN_SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'host',
];

export const MAX_REDIRECTS = 20;

export interface RedirectHop {
  location: string;
  method: string;
  methodChanged: boolean;
}

/**
 * Classify a response as a followable redirect and compute the next hop,
 * applying the fetch-spec method rewrite (303 for all methods except GET/HEAD,
 * 301/302 for POST only). Returns undefined for non-redirects and missing or
 * invalid Location headers.
 */
export function getRedirectHop(
  statusCode: number,
  location: string | string[] | null | undefined,
  currentUrl: string,
  method: string
): RedirectHop | undefined {
  if (!REDIRECT_STATUSES.includes(statusCode)) {
    return undefined;
  }
  if (typeof location !== 'string' || !location) {
    return undefined;
  }
  let nextUrl: URL;
  try {
    nextUrl = new URL(location, currentUrl);
  } catch {
    return undefined;
  }
  const upper = method.toUpperCase();
  const methodChanged =
    (statusCode === 303 && upper !== 'GET' && upper !== 'HEAD') ||
    ((statusCode === 301 || statusCode === 302) && upper === 'POST');
  return {
    location: nextUrl.toString(),
    method: methodChanged ? 'GET' : method,
    methodChanged,
  };
}

/**
 * Fold URL userinfo credentials into a Basic Authorization header value,
 * stripping them from the URL.
 */
export function takeBasicAuthFromUrl(url: URL): string | undefined {
  if (!url.username && !url.password) {
    return undefined;
  }
  const value =
    'Basic ' +
    Buffer.from(
      `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
    ).toString('base64');
  url.username = '';
  url.password = '';
  return value;
}

/**
 * Resolve an outbound request URL: map a `BASE_URL` origin onto the internal URL,
 * then apply any `requestUrlMappings` origin override. Mutates and returns the
 * given URL. Shared by {@link makeRequest} and the streaming proxy route so both
 * resolve hosts identically.
 */
export function rewriteRequestUrl(urlObj: URL): URL {
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

  return urlObj;
}

/**
 * Pick the undici {@link Dispatcher} (proxy tunnel) for a request to `urlObj` in
 * an optional `context`. `forceProxy` overrides the configured addon-proxy
 * selection. Also returns the {@link shouldProxy} decision (for logging). Shared
 * by {@link makeRequest} and the streaming proxy route.
 */
export function resolveDispatcher(
  urlObj: URL,
  context?: FetchContext,
  forceProxy?: string
): {
  dispatcher: Dispatcher | undefined;
  useProxy: boolean;
  proxyIndex: number;
} {
  const { useProxy, proxyIndex } = shouldProxy(urlObj, context);
  let dispatcher: Dispatcher | undefined;
  if (forceProxy) {
    dispatcher = getProxyAgent(forceProxy);
  } else if (useProxy) {
    dispatcher = getProxyAgent(appConfig.http.addonProxy[proxyIndex]);
  }
  return { dispatcher, useProxy, proxyIndex };
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
