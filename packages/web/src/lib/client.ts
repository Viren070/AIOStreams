import { storage } from './storage';
import { currentHost } from './hosts';
import { reached, unreachable } from './connection';
import { appBridge } from './hosts/shell/bridge';

// The apps are their own clients, on the device they run on.
const shell = appBridge();
const CLIENT_NAME = clientName();
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

function clientName(): string {
  if (!shell) return 'AIOStreams Web';
  if (shell.platform !== 'android') return 'AIOStreams Desktop';
  return shell.tv ? 'AIOStreams Android TV' : 'AIOStreams Android';
}

function deviceId(): string {
  const app = currentHost().device?.()?.id;
  if (app) return app;
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
  const app = currentHost().device?.()?.name;
  if (app) return app;
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
    message: string,
    /** How long the server asks to wait before trying again, where it says. */
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

/** No answer from the server itself: offline, or a proxy in front of it says it is down. */
export class ConnectionError extends Error {
  constructor() {
    super("Can't reach the server");
  }
}

const GATEWAY_DOWN = new Set([502, 504, 520, 521, 522, 523, 524, 530]);

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
    let res: Response;
    try {
      res = await fetch(this.url(path, init.query), {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        keepalive: init.keepalive,
      });
    } catch {
      unreachable();
      throw new ConnectionError();
    }
    if (GATEWAY_DOWN.has(res.status)) {
      unreachable();
      throw new ConnectionError();
    }
    reached();
    if (!res.ok) {
      const message = await res
        .json()
        .then((body: { Message?: string }) => body?.Message)
        .catch(() => undefined);
      const retryAfter = Number(res.headers.get('Retry-After') ?? NaN);
      throw new JellyfinError(
        res.status,
        message || `Request failed (${res.status})`,
        Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined
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
