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
