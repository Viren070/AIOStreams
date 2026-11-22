// Through the utils barrel, which has to load before cache.ts does.
import {
  Cache,
  HEADERS_FOR_IP_FORWARDING,
  INTERNAL_SECRET_HEADER,
} from '../index.js';
import { BodyInit, Dispatcher, HeadersInit, request } from 'undici';
import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { encodeBody, releaseBody, toResponse } from './body.js';
import { checkCooldown, recordCooldown } from './cooldown.js';
import { resolveDispatcher } from './dispatcher.js';
import { headersFor, RequestHeaders } from './headers.js';
import { impersonates, impersonationHost } from './impersonation.js';
import type { FetchContext } from './overrides.js';
import { PrivateAddressError, vettedAddresses } from './private-addresses.js';
import {
  CROSS_ORIGIN_SENSITIVE_HEADERS,
  getRedirectHop,
  MAX_REDIRECTS,
  REQUEST_BODY_HEADERS,
} from './redirects.js';
import {
  isBadPort,
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
  /** The client preset to send as when no override applies. */
  preset?: string;
  redirect?: 'follow' | 'manual';
  /** Still arms 429 cooldowns, but is never refused by one. */
  ignoreCooldown?: boolean;
}

const STANDARD_METHODS = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'];

export async function makeRequest(url: string, options: RequestOptions) {
  const requested = options.method ?? 'GET';
  let method = STANDARD_METHODS.includes(requested.toUpperCase())
    ? requested.toUpperCase()
    : requested;
  if (options.body != null && (method === 'GET' || method === 'HEAD')) {
    throw new TypeError('Request with GET/HEAD method cannot have body.');
  }

  let urlObj = rewriteRequestUrl(new URL(url));
  const headers = new RequestHeaders(options.headers);
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
  let body = await encodeBody(options.body, headers);

  // Redirects are followed manually so the proxy ruleset, override headers,
  // URL rewrites and internal-secret handling are re-evaluated on every hop.
  for (let redirects = 0; ; redirects++) {
    if (redirects > 0) {
      cooldown = await checkCooldown(urlObj, headers, options);
    }
    if (isBadPort(urlObj)) {
      throw new Error(`Requests to port ${urlObj.port} are blocked`);
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
    if (urlObj.origin === new URL(appConfig.bootstrap.internalUrl).origin) {
      headers.set(INTERNAL_SECRET_HEADER, appConfig.bootstrap.internalSecret);
    } else {
      headers.delete(INTERNAL_SECRET_HEADER);
    }

    const { headers: sent, preset } = headersFor(
      headers,
      urlObj,
      options.context,
      options.preset
    );
    const proxy =
      options.forceProxy ??
      (useProxy ? appConfig.http.addonProxy[proxyIndex] : undefined);
    const impersonation =
      preset && impersonates(preset) ? await impersonationHost() : undefined;
    if (!impersonation) sent.delete('host');

    logger.debug(
      {
        url: makeUrlLogSafe(urlObj.toString()),
        method,
        ...(redirects > 0 ? { redirects } : {}),
        ...(impersonation ? { client: preset } : {}),
        tunneled: !!dispatcher
          ? 'true' +
            (options.forceProxy ? ' (forced)' : ` (proxy index ${proxyIndex})`)
          : 'false',
        ...(appConfig.logging.logSensitiveInfo
          ? { headers: sent.toObject(), dispatcher: proxy }
          : {}),
      },
      'http request'
    );

    let data: Dispatcher.ResponseData;
    const sentAt = Date.now();
    try {
      data = impersonation
        ? await impersonation.request({
            preset: preset!,
            method,
            url: urlObj,
            headers: sent,
            body,
            proxy,
            addresses: proxy ? undefined : await vettedAddresses(urlObj),
            signal,
          })
        : await request(urlObj, {
            method: method as Dispatcher.HttpMethod,
            headers: sent.toObject(),
            body,
            dispatcher,
            signal,
          });
    } catch (err) {
      if (
        err instanceof Error &&
        !signal.aborted &&
        !(err instanceof PrivateAddressError)
      ) {
        logger.error(
          { cause: { ...err, message: err.message } },
          'request failed due to network error'
        );
      }
      throw err;
    }

    if (data.statusCode === 407) {
      releaseBody(data.body);
      throw new Error('Proxy authentication required');
    }
    const response = toResponse(method, data);
    await recordCooldown(cooldown, sentAt, response);

    if (options.redirect === 'manual') {
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
