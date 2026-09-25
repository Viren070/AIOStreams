import { storage } from './storage';

// The desktop app is its own client, on the computer it runs on.
const shell = window.aiostreamsDesktop;
const CLIENT_NAME = shell ? 'AIOStreams Desktop' : 'AIOStreams Web';
const CLIENT_VERSION = shell?.version ?? '1.0.0';
const DEVICE_KEY = 'aiostreams-web-device';

type QueryValue = string | number | boolean | string[] | null | undefined;
export type Query = Record<string, QueryValue>;

/** Everything before `/web`, so the app works under any mount of the API. */
export function apiBase(): string {
  const { origin, pathname } = window.location;
  const mount = pathname.replace(/\/web(\/(index\.html)?)?$/i, '');
  return origin + (mount && mount !== pathname ? mount : '/jellyfin');
}

function deviceId(): string {
  const stored = storage.get<string>(DEVICE_KEY);
  if (stored) return stored;
  // randomUUID needs a secure context, which a LAN http address is not.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  storage.set(DEVICE_KEY, id);
  return id;
}

function deviceName(): string {
  if (shell?.device) return shell.device;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export class JellyfinError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** A minimal client for the Jellyfin API this server speaks. */
export class JellyfinClient {
  readonly deviceId = deviceId();
  readonly deviceName = deviceName();

  constructor(
    readonly base: string,
    readonly token: string | null = null
  ) {}

  withToken(token: string): JellyfinClient {
    return new JellyfinClient(this.base, token);
  }

  get authorization(): string {
    const parts = [
      `Client="${CLIENT_NAME}"`,
      `Device="${encodeURIComponent(this.deviceName)}"`,
      `DeviceId="${this.deviceId}"`,
      `Version="${CLIENT_VERSION}"`,
    ];
    if (this.token) parts.push(`Token="${this.token}"`);
    return `MediaBrowser ${parts.join(', ')}`;
  }

  url(path: string, query?: Query): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    const qs = params.toString();
    return `${this.base}${path}${qs ? `?${qs}` : ''}`;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    init: { query?: Query; body?: unknown; keepalive?: boolean } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: this.authorization,
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(this.url(path, init.query), {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      keepalive: init.keepalive,
    });
    if (!res.ok) {
      const message = await res
        .json()
        .then((body: { Message?: string }) => body?.Message)
        .catch(() => undefined);
      throw new JellyfinError(
        res.status,
        message || `Request failed (${res.status})`
      );
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>('POST', path, { body, query });
  }

  delete<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('DELETE', path, { query });
  }
}
