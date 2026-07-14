import { config as appConfig } from '../config/index.js';

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 30_000;

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

export interface GithubRequestInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  token: string;
  /** JSON body; sets Content-Type: application/json. */
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Minimal GitHub REST client for the publish providers. The token is only
 * ever placed in the Authorization header; error messages carry GitHub's
 * `message` field, which never echoes credentials.
 */
export async function githubRequest<T = unknown>(
  path: string,
  init: GithubRequestInit
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${init.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': appConfig.http.defaultUserAgent,
      ...(init.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let body: unknown;
    const text = await res.text();
    try {
      const responseBody = JSON.parse(text) as { message?: unknown };
      if (typeof responseBody?.message === 'string' && responseBody.message) {
        message = `${responseBody.message} (HTTP ${res.status})`;
        body = responseBody;
      }
    } catch {}
    throw new GithubApiError(message, res.status, body);
  }

  let data: T = undefined as T;
  try {
    data = (await res.json()) as T;
  } catch {
    // 204s and empty bodies
  }
  return { status: res.status, data };
}
