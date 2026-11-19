import { Dispatcher, ProxyAgent } from 'undici';
import { socksDispatcher } from 'fetch-socks';
import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { matchOverride, type FetchContext } from './overrides.js';

const logger = createLogger('http');

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

/**
 * Pick the undici {@link Dispatcher} (proxy tunnel) for a request to `urlObj` in
 * an optional `context`. `forceProxy` overrides the configured addon-proxy
 * selection. Also returns the {@link shouldProxy} decision (for logging). Shared
 * by `makeRequest` and the streaming proxy route.
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
