// Through the utils barrel, which has to load before cache.ts does.
import {
  Cache,
  HEADERS_FOR_IP_FORWARDING,
  INTERNAL_SECRET_HEADER,
} from '../index.js';
import { BodyInit, fetch, Headers, HeadersInit, RequestInit } from 'undici';
import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { checkCooldown, recordCooldown } from './cooldown.js';
import { resolveDispatcher } from './dispatcher.js';
import { resolveOverrideHeaders, type FetchContext } from './overrides.js';
import { PrivateAddressError } from './private-addresses.js';
import {
  CROSS_ORIGIN_SENSITIVE_HEADERS,
  getRedirectHop,
  MAX_REDIRECTS,
  REQUEST_BODY_HEADERS,
} from './redirects.js';
import {
  makeUrlLogSafe,
  rewriteRequestUrl,
  takeBasicAuthFromUrl,
} from './url.js';

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
  /** Still arms 429 cooldowns, but is never refused by one. */
  ignoreCooldown?: boolean;
}

export async function makeRequest(url: string, options: RequestOptions) {
  let urlObj = rewriteRequestUrl(new URL(url));
  const headers = new Headers(options.headers);
  if (options.forwardIp) {
    for (const header of HEADERS_FOR_IP_FORWARDING) {
      headers.set(header, options.forwardIp);
    }
  }

  // Checked before recursion accounting so an active cooldown isn't
  // misreported as a possible recursive request.
  let cooldown = await checkCooldown(urlObj, headers, options);

  // block recursive requests
  const key = `${urlObj.toString()}-${options.forwardIp}`;
  const currentCount = options.ignoreRecursion
    ? 0
    : ((await urlCount.get(key)) ?? 0);
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
  if (!options.ignoreRecursion) {
    if (currentCount > 0) {
      await urlCount.update(key, currentCount + 1);
    } else {
      await urlCount.set(key, 1, appConfig.recursion.thresholdWindow);
    }
  }

  // One signal for the whole redirect chain.
  const signal = options.signal ?? AbortSignal.timeout(options.timeout);
  const { redirect: redirectMode, ...rawOptions } = options.rawOptions ?? {};
  let method = options.method ?? 'GET';
  let body = options.body;

  // Redirects are followed manually so the proxy ruleset, override headers,
  // URL rewrites and internal-secret handling are re-evaluated on every hop.
  for (let redirects = 0; ; redirects++) {
    if (redirects > 0) {
      cooldown = await checkCooldown(urlObj, headers, options);
    }

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
    const sentAt = Date.now();
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
      if (err instanceof Error && err.cause instanceof PrivateAddressError) {
        throw err.cause;
      }
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

    await recordCooldown(cooldown, sentAt, response);

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
