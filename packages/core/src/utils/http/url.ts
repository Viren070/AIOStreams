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

/** Ports the fetch standard refuses to connect to. */
const BAD_PORTS = new Set(
  (
    '1 7 9 11 13 15 17 19 20 21 22 23 25 37 42 43 53 69 77 79 87 95 101 102 ' +
    '103 104 109 110 111 113 115 117 119 123 135 137 139 143 161 179 389 427 ' +
    '465 512 513 514 515 526 530 531 532 540 548 554 556 563 587 601 636 989 ' +
    '990 993 995 1719 1720 1723 2049 3659 4045 4190 5060 5061 6000 6566 6665 ' +
    '6666 6667 6668 6669 6679 6697 10080'
  ).split(' ')
);

export function isBadPort(url: URL): boolean {
  return BAD_PORTS.has(url.port);
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
