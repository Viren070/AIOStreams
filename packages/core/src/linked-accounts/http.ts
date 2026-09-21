import { APIError, ErrorCode } from '../utils/constants.js';
import { makeRequest } from '../utils/http.js';
import {
  isUnsafeRemoteUrl,
  isUnsafeRemoteUrlResolved,
} from '../utils/url-safety.js';
import { config as appConfig } from '../config/index.js';

const TIMEOUT_MS = 15000;

export function normaliseInstanceUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Every host here comes from an end user, so the DNS-resolving guard applies
 * unless an operator has opted their instance out.
 */
export async function assertReachableUrl(url: string): Promise<void> {
  const unsafe = appConfig.linkedAccounts.allowPrivateUrls
    ? !/^https?:\/\//i.test(url)
    : await isUnsafeRemoteUrlResolved(url);
  if (unsafe) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      400,
      appConfig.linkedAccounts.allowPrivateUrls
        ? 'That is not a valid http(s) URL.'
        : 'That URL points somewhere this server will not connect to. It must be a public http(s) address.'
    );
  }
}

/** The literal-host check only, for URLs we build rather than accept. */
export function assertPublicUrl(url: string): void {
  if (!appConfig.linkedAccounts.allowPrivateUrls && isUnsafeRemoteUrl(url)) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      400,
      'That URL points somewhere this server will not connect to.'
    );
  }
}

export interface JsonResponse<T = any> {
  status: number;
  /** Null when the body was not JSON, which is how we spot an SPA catch-all. */
  json: T | null;
  text: string;
  /** Usually something sitting in front of the service, e.g. a login page. */
  redirected: boolean;
}

/**
 * Describes what came back instead of the JSON we wanted. Kept generic on
 * purpose: the cause is usually a wrong URL, a login page in front of the
 * service, or a version that does not serve the endpoint, and we cannot tell
 * which from here.
 */
export function unexpectedResponse(
  path: string,
  response: JsonResponse
): string {
  const got = response.redirected
    ? 'a redirect somewhere else'
    : response.status === 401 || response.status === 403
      ? `HTTP ${response.status}, so it needs its own login`
      : response.status >= 400
        ? `HTTP ${response.status}`
        : /^\s*</.test(response.text)
          ? 'an HTML page'
          : 'a non-JSON response';
  return `Expected JSON from ${path} but got ${got}.`;
}

export function isUnusable(response: JsonResponse): boolean {
  return (
    response.redirected || response.status >= 400 || response.json === null
  );
}

/**
 * Redirects are reported rather than followed: the target is never revalidated
 * against the SSRF guard, so following one would reopen the hole it closes.
 */
export async function requestJson<T = any>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
): Promise<JsonResponse<T>> {
  const response = await makeRequest(url, {
    timeout: TIMEOUT_MS,
    method: init.method ?? 'GET',
    ignoreRecursion: true,
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    rawOptions: { redirect: 'manual' },
  });

  const redirected =
    (response.status >= 300 && response.status < 400) ||
    // A manual redirect can also arrive filtered to an opaque status-0 response.
    response.status === 0;

  const text = redirected ? '' : await response.text();
  let json: T | null = null;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, redirected };
}
