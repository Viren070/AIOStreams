import { config as appConfig } from '../../config/index.js';
import { maskSensitiveInfo, redactForLog } from '../../logging/redact.js';

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
 * given URL. Shared by `makeRequest` and the streaming proxy route so both
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
