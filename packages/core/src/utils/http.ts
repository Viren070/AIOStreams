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

export interface RequestOptions {
  timeout: number;
  method?: string;
  forwardIp?: string;
  ignoreRecursion?: boolean;
  headers?: HeadersInit;
  body?: BodyInit;
  forceProxy?: string;
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

  const { useProxy, proxyIndex } = shouldProxy(urlObj);
  const headers = new Headers(options.headers);
  if (options.forwardIp) {
    for (const header of HEADERS_FOR_IP_FORWARDING) {
      headers.set(header, options.forwardIp);
    }
  }

  if (urlObj.toString().startsWith(appConfig.bootstrap.internalUrl)) {
    headers.set(INTERNAL_SECRET_HEADER, appConfig.bootstrap.internalSecret);
  }

  let domainUserAgent = domainHasUserAgent(urlObj);
  if (domainUserAgent) {
    headers.set('User-Agent', domainUserAgent);
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
      proxy: useProxy ? `proxy-${proxyIndex + 1}` : options.forceProxy ? 'forced' : 'direct',
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
      signal: AbortSignal.timeout(options.timeout),
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

export function shouldProxy(url: URL): {
  useProxy: boolean;
  proxyIndex: number;
} {
  let useProxy = false;
  let hostname = url.hostname;
  let proxyIndex = -1;

  if (!appConfig.http.addonProxy || appConfig.http.addonProxy.length === 0) {
    return { useProxy: false, proxyIndex };
  }

  if (hostname === 'localhost') {
    return { useProxy: false, proxyIndex };
  }

  useProxy = true;
  if (
    appConfig.http.addonProxyConfig &&
    Object.keys(appConfig.http.addonProxyConfig).length > 0
  ) {
    for (const [ruleHostname, ruleValue] of Object.entries(
      appConfig.http.addonProxyConfig
    )) {
      const ruleProxyIndexOrBool = String(ruleValue);
      if (
        ['true', 'false'].includes(ruleProxyIndexOrBool) === false &&
        isNaN(parseInt(ruleProxyIndexOrBool))
      ) {
        logger.error(
          { hostname: ruleHostname, value: ruleProxyIndexOrBool },
          'invalid proxy config value'
        );
        continue;
      }
      if (ruleHostname === '*') {
        useProxy = !(ruleProxyIndexOrBool === 'false');
        proxyIndex = Number.isInteger(parseInt(ruleProxyIndexOrBool))
          ? parseInt(ruleProxyIndexOrBool)
          : ruleProxyIndexOrBool === 'true'
            ? 0
            : -1;
      } else if (ruleHostname.startsWith('*')) {
        if (hostname.endsWith(ruleHostname.slice(1))) {
          useProxy = !(ruleProxyIndexOrBool === 'false');
          proxyIndex = Number.isInteger(parseInt(ruleProxyIndexOrBool))
            ? parseInt(ruleProxyIndexOrBool)
            : ruleProxyIndexOrBool === 'true'
              ? 0
              : -1;
        }
      }
      if (hostname === ruleHostname) {
        useProxy = !(ruleProxyIndexOrBool === 'false');
        proxyIndex = Number.isInteger(parseInt(ruleProxyIndexOrBool))
          ? parseInt(ruleProxyIndexOrBool)
          : ruleProxyIndexOrBool === 'true'
            ? 0
            : -1;
      }
    }
  } else {
    proxyIndex = 0;
  }

  if (useProxy && appConfig.http.addonProxy[proxyIndex] === undefined) {
    logger.error({ proxyIndex }, 'proxy index out of range');
    return { useProxy: false, proxyIndex: -1 };
  }

  return { useProxy, proxyIndex };
}

export function domainHasUserAgent(url: URL) {
  let userAgent: string | undefined;
  let hostname = url.hostname;

  if (
    !appConfig.http.hostnameUserAgentOverrides ||
    Object.keys(appConfig.http.hostnameUserAgentOverrides).length === 0
  ) {
    return undefined;
  }

  const mappings = Object.entries(appConfig.http.hostnameUserAgentOverrides);
  for (const [ruleHostname, ruleUserAgent] of mappings) {
    if (ruleHostname === '*') {
      userAgent = ruleUserAgent;
    } else if (ruleHostname.startsWith('*')) {
      if (hostname.endsWith(ruleHostname.slice(1))) {
        userAgent = ruleUserAgent;
      }
    } else if (hostname === ruleHostname) {
      userAgent = ruleUserAgent;
    }
  }

  return userAgent;
}
