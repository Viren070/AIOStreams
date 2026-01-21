import {
  Cache,
  HEADERS_FOR_IP_FORWARDING,
  INTERNAL_SECRET_HEADER,
  Env,
  maskSensitiveInfo,
} from './index.js';
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
import { createLogger } from './logger.js';

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
    .replace(/(?<![^?&])(apiKey=[^&]+)/g, 'apiKey=****');
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

  if (Env.BASE_URL && urlObj.origin === Env.BASE_URL) {
    const internalUrl = new URL(Env.INTERNAL_URL);
    urlObj.protocol = internalUrl.protocol;
    urlObj.host = internalUrl.host;
    urlObj.port = internalUrl.port;
  }

  if (Env.REQUEST_URL_MAPPINGS) {
    for (const [key, value] of Object.entries(Env.REQUEST_URL_MAPPINGS)) {
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

  if (urlObj.toString().startsWith(Env.INTERNAL_URL)) {
    headers.set(INTERNAL_SECRET_HEADER, Env.INTERNAL_SECRET);
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
    currentCount > Env.RECURSION_THRESHOLD_LIMIT &&
    !options.ignoreRecursion
  ) {
    logger.warn(
      `Detected possible recursive requests to ${urlObj.toString()}. Current count: ${currentCount}. Blocking request.`
    );
    throw new PossibleRecursiveRequestError(
      `Possible recursive request to ${urlObj.toString()}`
    );
  }
  if (currentCount > 0) {
    await urlCount.update(key, currentCount + 1);
  } else {
    await urlCount.set(key, 1, Env.RECURSION_THRESHOLD_WINDOW);
  }

  let dispatcher: Dispatcher | undefined;

  if (options.forceProxy) {
    dispatcher = getProxyAgent(options.forceProxy);
  } else if (useProxy) {
    dispatcher = getProxyAgent(Env.ADDON_PROXY![proxyIndex]);
  }

  logger.debug(
    `Making a ${useProxy ? 'proxied' : options.forceProxy ? 'forced proxied (' + options.forceProxy + ')' : 'direct'}${proxyIndex !== -1 ? ` (proxy ${proxyIndex + 1})` : ''} request to ${makeUrlLogSafe(
      urlObj.toString()
    )} with forwarded ip ${maskSensitiveInfo(options.forwardIp ?? 'none')} and headers ${maskSensitiveInfo(JSON.stringify(Object.fromEntries(headers)))}`
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
      let logParams: [string, Record<string, any>] = [
        'Fetch failed due to network error',
        err.cause,
      ];
      delete logParams[1].stack;
      logger.error(...logParams);
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
    if (proxyUrlObj.protocol === 'socks5:') {
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

  if (!Env.ADDON_PROXY || Env.ADDON_PROXY.length === 0) {
    return { useProxy: false, proxyIndex };
  }

  if (hostname === 'localhost') {
    return { useProxy: false, proxyIndex };
  }

  useProxy = true;
  if (Env.ADDON_PROXY_CONFIG) {
    for (const rule of Env.ADDON_PROXY_CONFIG.split(',')) {
      const [ruleHostname, ruleProxyIndexOrBool] = rule.split(':');
      if (
        ['true', 'false'].includes(ruleProxyIndexOrBool) === false &&
        isNaN(parseInt(ruleProxyIndexOrBool))
      ) {
        logger.error(`Invalid proxy config: ${rule}`);
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

  if (useProxy && Env.ADDON_PROXY[proxyIndex] === undefined) {
    logger.error(`Invalid proxy index: ${proxyIndex}, does not exist`);
    return { useProxy: false, proxyIndex: -1 };
  }

  return { useProxy, proxyIndex };
}

export function domainHasUserAgent(url: URL) {
  let userAgent: string | undefined;
  let hostname = url.hostname;

  if (!Env.HOSTNAME_USER_AGENT_OVERRIDES) {
    return undefined;
  }

  const mappings = Array.from(Env.HOSTNAME_USER_AGENT_OVERRIDES.entries());
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
